import { prisma } from "@/lib/prisma";
import { composeDevoteeSummary, DEVOTEE_SUMMARY_INCLUDE } from "@/lib/devoteeProfile";
import { getMemberOfferingHistory } from "@/lib/offeringClaims";
import { getDevoteeTagsForMember } from "@/lib/devoteeTags";
import { listDevoteeInteractions } from "@/lib/devoteeInteractions";
import type { Prisma, ReceivableSourceType } from "@prisma/client";

/**
 * P2024 修正（指令三）：捐款統計與活動統計都需要「這位信眾的普渡活動」與
 * 「祭改明細」。過去兩支各查一次（同一 request 對同兩張表重複四次查詢），
 * 現在由 getDevotee360Overview 一次查好、共用給兩支，型別即這兩個共用查詢
 * 的回傳形狀。
 */
type MemberRitualForStats = Prisma.RitualRecordGetPayload<{ include: { universalSalvation: true } }>;
type MemberPurificationForStats = Prisma.PurificationEntryGetPayload<{ include: { ritualRecord: true } }>;

/**
 * V12.0「360°信眾總覽」（對應指令「六」）。
 *
 * 這支檔案「只讀取」既有模組的資料組成畫面需要的格式，不修改、不複製
 * 任何一筆既有的 RitualRecord/OfferingClaim/PaymentTransaction/Receipt/
 * PurificationEntry 資料（對應工作原則「四、不得修改既有...邏輯」與
 * 指令「二十、不得修改既有財務計算邏輯」）。
 *
 * 【誠實揭露：捐款統計的類別涵蓋範圍】
 * 指令「六、8」要求依「添油香/贊普/普渡/宮慶/補庫/年度燈/祭改/花果/
 * 福壽龜/其他」分類統計，但依 src/lib/receivableAdapters.ts 的
 * RESERVED_SOURCE_NOTES 記載，這套系統目前「真正有收款資料」的來源只有
 * 四種：供品認捐（花果/福壽龜/其他供品）、普渡贊普、祭改、收款中心自建
 * 臨時應收。添油香、補庫、太歲燈類單獨收費、宮慶獨立應收（宮慶本身的
 * 費用已經透過供品認捐串接，不是另一筆獨立資料）目前完全沒有對應的
 * 登記或收費資料表——這裡「不會」為了湊滿十個分類而虛構這些類別的金額，
 * 沒有資料來源的類別一律顯示 0 並標示「系統目前無此類別的登記/收費資料」，
 * 不得假裝有資料。
 */

const ROC_OFFSET = 1911;

function toRocYear(date: Date): number {
  return date.getFullYear() - ROC_OFFSET;
}

/** (sourceType, sourceId) → 唯一鍵字串，供分組使用。 */
function receiptSourceKey(sourceType: ReceivableSourceType, sourceId: string): string {
  return `${sourceType}::${sourceId}`;
}

/**
 * V13.4 驗收（P2024 修正，指令六）：批次查詢多筆應收來源的有效收據號碼。
 *
 * 舊寫法在每一筆活動／祭改／供品的迴圈裡各呼叫一次 getReceiptNumbersForSource，
 * 一位信眾有 N 筆紀錄就打 N 次 paymentAllocation.findMany（N+1 查詢，正是
 * 日誌裡 paymentAllocation.findMany／receipt 大量重複的來源）。這裡改成
 * 「先收集全部 (sourceType, sourceId)，用一次 findMany（OR）撈回，再分組」，
 * 把 N 次併成 1 次。結果與逐筆查完全相同，不改任何金額或收據判斷。
 *
 * 空陣列 → 直接回傳空 Map，不打 DB。
 */
async function getReceiptNumbersForSources(
  pairs: readonly { sourceType: ReceivableSourceType; sourceId: string }[]
): Promise<Map<string, string[]>> {
  const grouped = new Map<string, Set<string>>();
  if (pairs.length === 0) return new Map();

  // 去重，避免 OR 條件塞入重複組合。
  const uniquePairs = Array.from(
    new Map(pairs.map((p) => [receiptSourceKey(p.sourceType, p.sourceId), p])).values()
  );

  const allocations = await prisma.paymentAllocation.findMany({
    where: { OR: uniquePairs.map((p) => ({ sourceType: p.sourceType, sourceId: p.sourceId })) },
    include: { receiptLines: { include: { receipt: true } } },
  });

  for (const alloc of allocations) {
    const key = receiptSourceKey(alloc.sourceType, alloc.sourceId);
    let set = grouped.get(key);
    if (!set) {
      set = new Set<string>();
      grouped.set(key, set);
    }
    for (const line of alloc.receiptLines) {
      if (line.receipt.status === "ISSUED" && line.receipt.receiptNumber) {
        set.add(line.receipt.receiptNumber);
      }
    }
  }

  const result = new Map<string, string[]>();
  for (const [key, set] of grouped) result.set(key, Array.from(set));
  return result;
}

async function getBasicAndHousehold(memberId: string) {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: {
      ...DEVOTEE_SUMMARY_INCLUDE,
      household: {
        include: {
          members: { where: { deletedAt: null }, orderBy: { name: "asc" } },
          // V12「信眾資料中心正式建置」指令「四」：編輯頁需要顯示並可新增
          // 歷代祖先／乙位正魂（既有的 WorshipRecord），跟既有 /household/[id]
          // 頁面顯示的資料來源完全相同，不重複建立第二份查詢邏輯以外的資料。
          worshipRecords: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!member || member.deletedAt) return null;

  const summary = composeDevoteeSummary(member as Parameters<typeof composeDevoteeSummary>[0]);

  return {
    summary,
    household: {
      id: member.household.id,
      name: member.household.name,
      contactName: member.household.contactName,
      phone: member.household.phone,
      companyName: member.household.companyName,
      address: member.household.address,
      members: member.household.members.map((m) => ({
        memberId: m.id,
        name: m.name,
        role: m.role,
        isPrimaryContact: m.isPrimaryContact,
        isDeceased: m.isDeceased,
      })),
      worshipRecords: member.household.worshipRecords.map((w) => ({
        id: w.id,
        type: w.type,
        displayName: w.displayName,
        location: w.location,
        yangshangName: w.yangshangName,
        notes: w.notes,
      })),
    },
  };
}

/**
 * 3. 宮務活動紀錄（普渡／宮慶／年度燈／其他——不含祭改，祭改另外用
 *    PurificationEntry.memberId 查詢，見下方）。
 *
 * ── V13.4：三段合併查詢 ─────────────────────────────────────
 * 舊版只查 `where: { memberId }`，但 `RitualRecord.memberId` **全專案
 * 從未被寫入**——結果這個分頁對普渡永遠是空的。
 *
 * 現在改為三個來源合併，並明確標示每一筆的歸屬方式：
 *
 *   ① RitualParticipant.memberId = 此人   → 「個人報名」（V13.4 之後的新資料）
 *   ② RitualRecord.memberId = 此人        → 「個人報名（舊版關聯）」（若有殘留資料）
 *   ③ 同家戶、且完全沒有 participant       → 「家戶報名」（V13.4 之前的舊資料）
 *
 * ⚠️ ③ 絕不宣稱是「這位信眾的個人報名」——那是整戶的活動，
 * 我們只知道他在這一戶，不知道當初有沒有納入他。
 */
async function getRitualRecordHistory(memberId: string) {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { householdId: true },
  });
  if (!member) return [];

  const records = await prisma.ritualRecord.findMany({
    where: {
      deletedAt: null,
      activityType: { not: "PURIFICATION" },
      OR: [
        // ① 新資料：報名成員明細
        { participants: { some: { memberId, deletedAt: null } } },
        // ② 舊版個人關聯（deprecated 欄位，可能有殘留資料）
        { memberId },
        // ③ 同家戶且無任何 participant → 家戶報名
        { householdId: member.householdId, participants: { none: {} } },
      ],
    },
    include: {
      templeEvent: true,
      universalSalvation: { include: { payments: true } },
      lanternRegistration: true,
      participants: { where: { deletedAt: null }, select: { memberId: true } },
    },
    orderBy: { year: "desc" },
  });

  // P2024 修正：先收集所有需要查收據的 (來源, id)，一次批次撈回，取代
  // 迴圈內逐筆查 paymentAllocation（N+1）。分組與金額判斷邏輯完全不變。
  const receiptPairs: { sourceType: ReceivableSourceType; sourceId: string }[] = [];
  for (const r of records) {
    if (r.universalSalvation?.isSponsor) {
      receiptPairs.push({ sourceType: "UNIVERSAL_SALVATION_SPONSOR", sourceId: r.universalSalvation.id });
    }
    if (r.lanternRegistration) {
      receiptPairs.push({ sourceType: "LANTERN_REGISTRATION", sourceId: r.lanternRegistration.id });
    }
  }
  const receiptMap = await getReceiptNumbersForSources(receiptPairs);

  const results = [];
  for (const r of records) {
    let amount = 0;
    let paymentStatus = "無需收費";
    let receiptNumbers: string[] = [];
    if (r.universalSalvation) {
      const u = r.universalSalvation;
      if (u.isSponsor) {
        amount = Number(u.amountDue);
        paymentStatus = Number(u.amountUnpaid) <= 0 ? "已收訖" : Number(u.amountPaid) > 0 ? "部分收款" : "未收款";
        receiptNumbers = receiptMap.get(receiptSourceKey("UNIVERSAL_SALVATION_SPONSOR", u.id)) ?? [];
      } else {
        paymentStatus = "未贊普（僅登記）";
      }
    }
    // V13.4：年度燈的金額由 LanternRegistration 提供
    if (r.lanternRegistration) {
      const lr = r.lanternRegistration;
      amount = Number(lr.amountDue);
      paymentStatus =
        Number(lr.amountUnpaid) <= 0 && amount > 0
          ? "已收訖"
          : Number(lr.amountPaid) > 0
            ? "部分收款"
            : "未收款";
      receiptNumbers = receiptMap.get(receiptSourceKey("LANTERN_REGISTRATION", lr.id)) ?? [];
    }

    /**
     * V13.4：歸屬方式標記。
     * 讓畫面清楚區分「這位信眾被納入報名」與「這是他家戶的活動」，
     * 不把舊的家戶活動誤標成個人報名。
     */
    const isPersonal = r.participants.some((p) => p.memberId === memberId);
    const isLegacyPersonal = !isPersonal && r.memberId === memberId;
    const participationType: "PERSONAL" | "LEGACY_PERSONAL" | "HOUSEHOLD" = isPersonal
      ? "PERSONAL"
      : isLegacyPersonal
        ? "LEGACY_PERSONAL"
        : "HOUSEHOLD";
    const participationLabel =
      participationType === "PERSONAL"
        ? "個人報名"
        : participationType === "LEGACY_PERSONAL"
          ? "個人報名（舊版關聯）"
          : "家戶報名";

    results.push({
      ritualRecordId: r.id,
      activityName: r.templeEvent?.name ?? `${r.activityType}（無對應活動主檔）`,
      activityType: r.activityType,
      year: r.year,
      registeredAt: r.createdAt.toISOString().slice(0, 10),
      registeredItem: r.activityType === "UNIVERSAL_SALVATION" ? "普渡登記" : r.activityType,
      amount,
      paymentStatus,
      receiptNumbers,
      notes: r.notes,
      // V13.4 新增
      status: r.status,
      participantCount: r.participants.length,
      participationType,
      participationLabel,
      editorUrl: `/registration/${r.id}`,
    });
  }
  return results;
}

/** 7（部分）. 祭改紀錄——PurificationEntry 有自己的 memberId，跟 RitualRecord.memberId 分開查。 */
async function getPurificationHistory(memberId: string) {
  const entries = await prisma.purificationEntry.findMany({
    where: { memberId, deletedAt: null },
    include: { ritualRecord: { include: { templeEvent: true } } },
    orderBy: { createdAt: "desc" },
  });

  // P2024 修正：一次批次撈回所有可收費祭改的收據，取代迴圈內逐筆查詢。
  const receiptMap = await getReceiptNumbersForSources(
    entries.filter((e) => e.feeStatus === "CHARGEABLE").map((e) => ({ sourceType: "PURIFICATION_ENTRY" as const, sourceId: e.id }))
  );

  const results = [];
  for (const e of entries) {
    const receiptNumbers = e.feeStatus === "CHARGEABLE" ? receiptMap.get(receiptSourceKey("PURIFICATION_ENTRY", e.id)) ?? [] : [];
    results.push({
      entryId: e.id,
      year: e.ritualRecord.year,
      type: "祭改",
      registeredName: e.isTemporaryName ? e.manualDisplayName ?? "（臨時登記，未填姓名）" : undefined,
      amount: e.feeStatus === "CHARGEABLE" ? Number(e.amountDue ?? 0) : 0,
      paymentStatus:
        e.feeStatus === "WAIVED"
          ? "免收"
          : e.feeStatus !== "CHARGEABLE"
            ? "未設定收費"
            : Number(e.amountUnpaid) <= 0
              ? "已收訖"
              : Number(e.amountPaid) > 0
                ? "部分收款"
                : "未收款",
      receiptNumbers,
      notes: e.notes,
    });
  }
  return results;
}

/** 4. 供品認捐紀錄（沿用既有 getMemberOfferingHistory()，不重寫查詢邏輯）。 */
async function getOfferingHistory(memberId: string) {
  const claims = await getMemberOfferingHistory(memberId);
  // P2024 修正：一次批次撈回所有供品認捐的收據，取代迴圈內逐筆查詢。
  const receiptMap = await getReceiptNumbersForSources(
    claims.map((c) => ({ sourceType: "OFFERING_CLAIM" as const, sourceId: c.id }))
  );
  const results = [];
  for (const c of claims) {
    const receiptNumbers = receiptMap.get(receiptSourceKey("OFFERING_CLAIM", c.id)) ?? [];
    results.push({
      claimId: c.id,
      year: c.year,
      date: c.createdAt.toISOString().slice(0, 10),
      offeringName: c.offeringType.name,
      claimantName: c.sponsorNameSnapshot,
      amount: Number(c.amountDue),
      paymentStatus: c.paymentStatus,
      receiptNumbers,
      // 誠實揭露：系統目前沒有追蹤供品「是否已實際領取（物理取貨）」的欄位，
      // 見本檔案開頭說明，不得假裝有這筆資料。
      isCollected: "系統未追蹤此欄位",
      notes: c.note,
    });
  }
  return results;
}

/** 5. 收款紀錄——PaymentTransaction.payerMemberId = 這位信眾。 */
async function getPaymentHistory(memberId: string) {
  const transactions = await prisma.paymentTransaction.findMany({
    where: { payerMemberId: memberId },
    include: { allocations: true },
    orderBy: { paidOn: "desc" },
  });

  return transactions.map((t) => ({
    transactionId: t.id,
    transactionNo: t.transactionNo,
    paidOn: t.paidOn.toISOString().slice(0, 10),
    items: t.allocations.map((a) => a.sourceLabel).join("、"),
    totalAmount: Number(t.totalAmount),
    methodType: t.methodType,
    collectedByName: t.isAgentCollected ? t.agentName : t.collectedByName,
    isAgentCollected: t.isAgentCollected,
    remittanceStatus: t.isAgentCollected ? t.agentRemittanceStatus : "不適用（非代收）",
    status: t.status,
  }));
}

/** 6. 收據紀錄——Receipt.memberId = 這位信眾。 */
async function getReceiptHistory(memberId: string) {
  const receipts = await prisma.receipt.findMany({
    where: { memberId },
    include: { lines: true },
    orderBy: { receiptDate: "desc" },
  });

  return receipts.map((r) => ({
    receiptId: r.id,
    receiptNumber: r.receiptNumber,
    issuedDate: r.receiptDate.toISOString().slice(0, 10),
    payerName: r.payerName,
    items: r.lines.map((l) => l.itemName).join("、"),
    amount: Number(r.totalAmount),
    status: r.status,
    isVoided: r.status === "VOIDED",
    printCount: r.printCount,
  }));
}

/**
 * 8. 捐款統計——依「真實收款資料」統計，不得把未付款算入實收（指令
 * 「六、8」「二十一、13/14」）。分類方式見本檔案開頭的誠實揭露說明。
 */
async function getDonationStats(
  memberId: string,
  now: Date,
  // P2024 修正（指令三）：ritual／purification 由呼叫端一次查好共用，
  // 不再由 donation 與 activity 各查一次（同一 request 重複查詢）。
  sharedRituals: MemberRitualForStats[],
  sharedPurifications: MemberPurificationForStats[]
) {
  const currentYear = toRocYear(now);

  const offeringClaims = await prisma.offeringClaim.findMany({
    where: { sponsorMemberId: memberId, deletedAt: null },
    include: { offeringType: true },
  });
  // 贊普只可能出現在普渡活動；沿用既有判斷，只是資料來自共用查詢。
  const universalSalvation = sharedRituals.filter((r) => r.activityType === "UNIVERSAL_SALVATION");
  const purificationEntries = sharedPurifications;

  type YearAmount = { year: number; received: number; due: number };
  const byCategory: Record<string, YearAmount[]> = {
    添油香: [],
    贊普: [],
    普渡: [],
    宮慶: [],
    補庫: [],
    年度燈: [],
    祭改: [],
    花果: [],
    福壽龜: [],
    其他: [],
  };

  // 花果/福壽龜/其他供品：直接依 OfferingType.behaviorKind 分類
  // （TURTLE→福壽龜, FLORAL→花果, 其餘→其他），只計算 amountPaid（實收），
  // 不把 amountDue（應收）誤算成實收。
  for (const c of offeringClaims) {
    const category = c.offeringType.behaviorKind === "TURTLE" ? "福壽龜" : c.offeringType.behaviorKind === "FLORAL" ? "花果" : "其他";
    byCategory[category].push({ year: c.year, received: Number(c.amountPaid), due: Number(c.amountDue) });
  }

  // 贊普/普渡：這套系統裡「普渡」唯一的金額面向就是「贊普」（見本檔案
  // 開頭誠實揭露），這裡兩個類別填入同一組真實數字，不是複製兩份、也
  // 不是憑空多算一次——只是同一筆資料同時滿足「普渡」與「贊普」兩個
  // 指令要求的分類名稱。
  for (const r of universalSalvation) {
    if (r.universalSalvation?.isSponsor) {
      const entry = { year: r.year, received: Number(r.universalSalvation.amountPaid), due: Number(r.universalSalvation.amountDue) };
      byCategory.贊普.push(entry);
      byCategory.普渡.push(entry);
    }
  }

  // 祭改
  for (const p of purificationEntries) {
    if (p.feeStatus === "CHARGEABLE") {
      byCategory.祭改.push({ year: p.ritualRecord ? toRocYear(p.createdAt) : currentYear, received: Number(p.amountPaid), due: Number(p.amountDue ?? 0) });
    }
  }

  // 添油香/補庫/年度燈/宮慶（獨立應收）：系統目前沒有對應的登記或收費
  // 資料表（見 RESERVED_SOURCE_NOTES），一律維持空陣列（＝0），不虛構。

  function sumInYears(entries: YearAmount[], years: number[] | null): { received: number; due: number; unpaid: number } {
    const filtered = years ? entries.filter((e) => years.includes(e.year)) : entries;
    const received = filtered.reduce((s, e) => s + e.received, 0);
    const due = filtered.reduce((s, e) => s + e.due, 0);
    return { received, due, unpaid: Math.max(0, due - received) };
  }

  const last5Years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  const byCategoryTotals = Object.fromEntries(
    Object.entries(byCategory).map(([k, v]) => [
      k,
      {
        thisYear: sumInYears(v, [currentYear]),
        allTime: sumInYears(v, null),
        hasData: v.length > 0,
      },
    ])
  );

  const allEntries = Object.values(byCategory).flat();

  return {
    thisYearTotal: sumInYears(allEntries, [currentYear]),
    lastYearTotal: sumInYears(allEntries, [currentYear - 1]),
    last5YearsTotal: sumInYears(allEntries, last5Years),
    allTimeTotal: sumInYears(allEntries, null),
    byCategory: byCategoryTotals,
    note: "添油香／補庫／年度燈單獨收費／宮慶獨立應收：系統目前無對應的登記或收費資料表，以上類別金額固定為 0（不是「已確認零元」，是「沒有資料可統計」）。「普渡」與「贊普」在此系統中是同一組真實收款資料（普渡本身沒有另外的獨立收費項目），並非重複計算。",
  };
}

/** 9. 活動統計。 */
function getActivityStats(
  now: Date,
  // P2024 修正（指令三）：沿用共用查詢，不再另外查一次 ritual／purification。
  sharedRituals: MemberRitualForStats[],
  sharedPurifications: MemberPurificationForStats[]
) {
  const allDates = [...sharedRituals, ...sharedPurifications]
    .map((r) => r.createdAt)
    .sort((a, b) => a.getTime() - b.getTime());

  if (allDates.length === 0) {
    return {
      firstActivityAt: null,
      lastActivityAt: null,
      totalCount: 0,
      last1YearCount: 0,
      last3YearsCount: 0,
      last5YearsCount: 0,
      inactiveOver1Year: true,
    };
  }

  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const threeYearsAgo = new Date(now.getTime() - 3 * 365 * 24 * 60 * 60 * 1000);
  const fiveYearsAgo = new Date(now.getTime() - 5 * 365 * 24 * 60 * 60 * 1000);

  return {
    firstActivityAt: allDates[0].toISOString().slice(0, 10),
    lastActivityAt: allDates[allDates.length - 1].toISOString().slice(0, 10),
    totalCount: allDates.length,
    last1YearCount: allDates.filter((d) => d >= oneYearAgo).length,
    last3YearsCount: allDates.filter((d) => d >= threeYearsAgo).length,
    last5YearsCount: allDates.filter((d) => d >= fiveYearsAgo).length,
    inactiveOver1Year: allDates[allDates.length - 1] < oneYearAgo,
  };
}

/** 10. 時間軸——把上面各區塊已經查到的真實資料依日期倒序整合，不另外複製一份資料（指令「六、10」）。 */
type TimelineItem = { date: string; type: string; description: string };

function buildTimeline(parts: {
  summary: ReturnType<typeof composeDevoteeSummary>;
  rituals: Awaited<ReturnType<typeof getRitualRecordHistory>>;
  purifications: Awaited<ReturnType<typeof getPurificationHistory>>;
  offerings: Awaited<ReturnType<typeof getOfferingHistory>>;
  payments: Awaited<ReturnType<typeof getPaymentHistory>>;
  receipts: Awaited<ReturnType<typeof getReceiptHistory>>;
  interactions: Awaited<ReturnType<typeof listDevoteeInteractions>>;
}): TimelineItem[] {
  const items: TimelineItem[] = [];
  items.push({ date: parts.summary.createdAt.slice(0, 10), type: "建立信眾資料", description: `建立信眾資料（${parts.summary.name}）` });
  for (const r of parts.rituals) items.push({ date: r.registeredAt, type: "活動報名", description: `${r.activityName}（${r.year} 年）` });
  for (const p of parts.purifications) items.push({ date: parts.summary.createdAt.slice(0, 10), type: "祭改登記", description: `祭改登記（${p.year} 年）` });
  for (const o of parts.offerings) items.push({ date: o.date, type: "供品認捐", description: `${o.offeringName}（${o.year} 年）` });
  for (const pay of parts.payments) items.push({ date: pay.paidOn, type: "收款", description: `收款 ${pay.totalAmount} 元（${pay.transactionNo}）` });
  for (const rec of parts.receipts) items.push({ date: rec.issuedDate, type: rec.isVoided ? "收據作廢" : "開立收據", description: `${rec.receiptNumber ?? "（尚未編號）"} ${rec.amount} 元` });
  for (const i of parts.interactions) items.push({ date: i.occurredAt.toISOString().slice(0, 10), type: "互動紀錄", description: i.content.slice(0, 40) });

  return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export async function getDevotee360Overview(memberId: string, now: Date = new Date()) {
  const base = await getBasicAndHousehold(memberId);
  if (!base) return null;

  /**
   * P2024 修正（指令一、三、四）：
   *
   * 舊版一次 `Promise.all([...9 個查詢])`，而其中 donation／activity 內部
   * 又各自 `Promise.all`，冷啟動瞬間要 12+ 條連線 → 超過連線池上限 9。
   *
   * 現在改為：
   *  (1) 先一次查好兩支統計共用的 ritual／purification（原本各查一次，共 4 次
   *      → 現在 2 次），避免同一 request 重複查詢。
   *  (2) 其餘讀取分批執行（每批最多 3 個 Promise.all），任何時刻同時在跑的
   *      查詢數都壓在連線池容量以內，不再一次全部啟動十幾個。
   *
   * 全程不改任何金額／收據判斷，不吞錯、不把失敗當 0（指令八）。
   */
  const [sharedRituals, sharedPurifications] = await Promise.all([
    prisma.ritualRecord.findMany({
      where: { memberId, deletedAt: null },
      include: { universalSalvation: true },
    }),
    prisma.purificationEntry.findMany({
      where: { memberId, deletedAt: null },
      include: { ritualRecord: true },
    }),
  ]);

  // 受控並行：每批最多 DEVOTEE_OVERVIEW_DB_CONCURRENCY 個讀取，做完一批再下一批。
  // 各 history 內部已把逐筆收據查詢併成一次批次查詢，故每個任務最多 2 次序列
  // 查詢；一批 3 個 → 尖峰約 3 條連線，遠低於連線池上限 9。
  const [rituals, purifications, offerings] = await Promise.all([
    getRitualRecordHistory(memberId),
    getPurificationHistory(memberId),
    getOfferingHistory(memberId),
  ]);
  const [payments, receipts, tags] = await Promise.all([
    getPaymentHistory(memberId),
    getReceiptHistory(memberId),
    getDevoteeTagsForMember(memberId),
  ]);
  const interactions = await listDevoteeInteractions(memberId);

  // 統計改用上面共用查到的資料計算（不再各自打 DB）。
  const donationStats = await getDonationStats(memberId, now, sharedRituals, sharedPurifications);
  const activityStats = getActivityStats(now, sharedRituals, sharedPurifications);

  const timeline = buildTimeline({ summary: base.summary, rituals, purifications, offerings, payments, receipts, interactions });

  return {
    basic: base.summary,
    household: base.household,
    tags,
    rituals,
    purifications,
    offerings,
    payments,
    receipts,
    donationStats,
    activityStats,
    timeline,
    interactions,
  };
}
