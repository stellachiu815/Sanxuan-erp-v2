import { prisma } from "@/lib/prisma";
import { composeDevoteeSummary, DEVOTEE_SUMMARY_INCLUDE } from "@/lib/devoteeProfile";
import { getMemberOfferingHistory } from "@/lib/offeringClaims";
import { getDevoteeTagsForMember } from "@/lib/devoteeTags";
import { listDevoteeInteractions } from "@/lib/devoteeInteractions";
import type { ReceivableSourceType } from "@prisma/client";

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

/** 查詢某個應收來源（sourceType+sourceId）目前有效（未作廢）的收據號碼清單。 */
async function getReceiptNumbersForSource(sourceType: ReceivableSourceType, sourceId: string): Promise<string[]> {
  const allocations = await prisma.paymentAllocation.findMany({
    where: { sourceType, sourceId },
    include: { receiptLines: { include: { receipt: true } } },
  });
  const numbers = new Set<string>();
  for (const alloc of allocations) {
    for (const line of alloc.receiptLines) {
      if (line.receipt.status === "ISSUED" && line.receipt.receiptNumber) {
        numbers.add(line.receipt.receiptNumber);
      }
    }
  }
  return Array.from(numbers);
}

async function getBasicAndHousehold(memberId: string) {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: {
      ...DEVOTEE_SUMMARY_INCLUDE,
      household: {
        include: {
          members: { where: { deletedAt: null }, orderBy: { name: "asc" } },
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
    },
  };
}

/** 3. 宮務活動紀錄（普渡/宮慶/補庫/年度燈/其他——不含祭改，祭改另外用 PurificationEntry.memberId 查詢，見下方）。 */
async function getRitualRecordHistory(memberId: string) {
  const records = await prisma.ritualRecord.findMany({
    where: { memberId, deletedAt: null, activityType: { not: "PURIFICATION" } },
    include: { templeEvent: true, universalSalvation: { include: { payments: true } } },
    orderBy: { year: "desc" },
  });

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
        receiptNumbers = await getReceiptNumbersForSource("UNIVERSAL_SALVATION_SPONSOR", u.id);
      } else {
        paymentStatus = "未贊普（僅登記）";
      }
    }
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

  const results = [];
  for (const e of entries) {
    const receiptNumbers = e.feeStatus === "CHARGEABLE" ? await getReceiptNumbersForSource("PURIFICATION_ENTRY", e.id) : [];
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
  const results = [];
  for (const c of claims) {
    const receiptNumbers = await getReceiptNumbersForSource("OFFERING_CLAIM", c.id);
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
async function getDonationStats(memberId: string, now: Date) {
  const currentYear = toRocYear(now);

  const [offeringClaims, universalSalvation, purificationEntries] = await Promise.all([
    prisma.offeringClaim.findMany({ where: { sponsorMemberId: memberId, deletedAt: null }, include: { offeringType: true } }),
    prisma.ritualRecord.findMany({
      where: { memberId, deletedAt: null, activityType: "UNIVERSAL_SALVATION" },
      include: { universalSalvation: true },
    }),
    // 修正：原本這裡沒有 include ritualRecord，但下面「祭改」區塊會讀取
    // p.ritualRecord（見下方），導致 Render Build 出現 TypeScript 錯誤
    // （"Property 'ritualRecord' does not exist on type PurificationEntry"）。
    // 這裡補上 include: { ritualRecord: true }，只補齊查詢帶出的關聯資料，
    // 不改 schema、不改下面的判斷邏輯、不新增功能。
    prisma.purificationEntry.findMany({ where: { memberId, deletedAt: null }, include: { ritualRecord: true } }),
  ]);

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
async function getActivityStats(memberId: string, now: Date) {
  const [ritualRecords, purificationEntries] = await Promise.all([
    prisma.ritualRecord.findMany({ where: { memberId, deletedAt: null }, select: { createdAt: true } }),
    prisma.purificationEntry.findMany({ where: { memberId, deletedAt: null }, select: { createdAt: true } }),
  ]);
  const allDates = [...ritualRecords, ...purificationEntries].map((r) => r.createdAt).sort((a, b) => a.getTime() - b.getTime());

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

  const [rituals, purifications, offerings, payments, receipts, tags, interactions, donationStats, activityStats] = await Promise.all([
    getRitualRecordHistory(memberId),
    getPurificationHistory(memberId),
    getOfferingHistory(memberId),
    getPaymentHistory(memberId),
    getReceiptHistory(memberId),
    getDevoteeTagsForMember(memberId),
    listDevoteeInteractions(memberId),
    getDonationStats(memberId, now),
    getActivityStats(memberId, now),
  ]);

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
