/**
 * V14.4 Part 6B：普渡 Excel 匯入「資料庫服務」層。
 *
 * analyze：解析 Excel → 保守匹配 → 建立草稿 batch/rows（**不建任何正式資料**）。
 * confirm：對可確認列，**共用既有正式核心**（createUniversalSalvationEntry →
 *   ensureLinkedTabletItem + ensureTabletPrintObjects；registerRice）逐列物化，
 *   逐列隔離 transaction、DB 唯一鍵防重。不另寫第二套建立/匹配/資料表。
 */

import { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/prisma";
import { normalizeRitualNameForStore } from "@/lib/ritualDisplayName";
import { recordVersion } from "@/lib/recordVersion";
import { parseSpreadsheetBuffer } from "@/lib/smartImport";
import {
  resolveColumnMapping,
  parseYangshangNames,
  extractRiceKgFromImport,
  classifyMatch,
  buildImportDupKey,
  resolveImportAddress,
  isRowConfirmable,
  type DevoteeCandidate,
  type ImportRowInput,
  type MatchStatus,
} from "@/lib/purificationImportRules";
import {
  createUniversalSalvationEntry,
  createBlankUniversalSalvationRecord,
} from "@/lib/ritual";
import { registerRice, getRiceQuotaSummary } from "@/lib/whiteRiceService";
import { createHousehold } from "@/lib/householdManagement";
import { createMemberForHousehold } from "@/lib/memberCreate";
import { createAdditionalPrintItem } from "@/lib/additionalPrintItems";
import { tabletIdentityKey, normalizeTabletText } from "@/lib/tabletIdentity";
import { syncEntryToHouseholdWorshipRecord, isSyncableWorshipCategory } from "@/lib/householdWorshipSync";
import type { Role } from "@/lib/whiteRice";
import type { UniversalSalvationEntryCategory } from "@prisma/client";

/** V15R7：需要建立 UniversalSalvationEntry（牌位）並納入 DB 去重的類別。 */
const TABLET_CATEGORIES = new Set(["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "DEBT_CREDITOR", "UNBORN_CHILD"]);
/** V15R7：預設會同步家戶永久名單的類別（只有祖先／正魂）。 */
const SYNCABLE_CATEGORIES = new Set(["ANCESTOR_LINE", "INDIVIDUAL_SOUL"]);

/** V15R7：匯入列新增的每列旗標／DB 去重欄位（Prisma 生成型別更新前，以此型別讀寫）。 */
type ImportRowExtra = {
  syncToHousehold: boolean;
  existingMatchStatus: string | null;
  existingRecordId: string | null;
  resolutionAction: string | null;
};

/** 這一列的牌位顯示名稱／類別（與 confirm 物化一致）。 */
function rowTabletIdentity(n: NormalizedRow): { category: string; displayName: string } {
  const category = n.tabletCategory ?? "ANCESTOR_LINE";
  const displayName = n.tabletName ?? n.devoteeName ?? "牌位";
  return { category, displayName };
}

type NormalizedRow = {
  householdCode: string | null;
  householdName: string | null;
  primaryContact: string | null;
  devoteeName: string | null;
  phone: string | null;
  address: string | null;
  tabletCategory: string | null;
  tabletName: string | null;
  yangshangNames: string[];
  tabletAddress: string | null;
  riceKg: number | null;
  extraPocketCount: number;
  sponsor: number | null;
  sponsorDonation: number | null;
  sponsorName: string | null;
  companyName: string | null;
  note: string | null;
};

const CATEGORY_ALIAS: Record<string, UniversalSalvationEntryCategory> = {
  歷代祖先: "ANCESTOR_LINE", 祖先: "ANCESTOR_LINE", ANCESTOR_LINE: "ANCESTOR_LINE",
  乙位正魂: "INDIVIDUAL_SOUL", 正魂: "INDIVIDUAL_SOUL", INDIVIDUAL_SOUL: "INDIVIDUAL_SOUL",
  // 累世冤親債主：辨識相容三種常見輸入（含舊資料錯字「歷世」），正式輸出一律「累世冤親債主」。
  冤親債主: "DEBT_CREDITOR", 累世冤親債主: "DEBT_CREDITOR", 歷世冤親債主: "DEBT_CREDITOR",
  歷世: "DEBT_CREDITOR", 冤親: "DEBT_CREDITOR", DEBT_CREDITOR: "DEBT_CREDITOR",
  無緣子女: "UNBORN_CHILD", UNBORN_CHILD: "UNBORN_CHILD",
};

function normalizeCategory(raw: string | null): string | null {
  if (!raw) return null;
  return CATEGORY_ALIAS[raw.trim()] ?? raw.trim();
}

function pick(row: Record<string, unknown>, col: string | undefined): string | null {
  if (!col) return null;
  const v = row[col];
  return v === null || v === undefined || v === "" ? null : String(v).trim();
}

function normalizeRow(row: Record<string, unknown>, map: Partial<Record<string, string>>): NormalizedRow {
  return {
    householdCode: pick(row, map.householdCode),
    householdName: pick(row, map.householdName),
    primaryContact: pick(row, map.primaryContact),
    devoteeName: pick(row, map.devoteeName),
    phone: pick(row, map.phone),
    address: pick(row, map.address),
    tabletCategory: normalizeCategory(pick(row, map.tabletCategory)),
    tabletName: pick(row, map.tabletName),
    yangshangNames: parseYangshangNames(pick(row, map.yangshang)),
    tabletAddress: pick(row, map.tabletAddress),
    riceKg: extractRiceKgFromImport(map.riceKg ? row[map.riceKg] : null),
    extraPocketCount: Math.max(0, Math.floor(Number(pick(row, map.extraPocketQty) ?? 0)) || 0),
    sponsor: map.sponsor && Number.isFinite(Number(row[map.sponsor])) ? Number(row[map.sponsor]) : null,
    sponsorDonation: map.sponsorDonation && Number.isFinite(Number(row[map.sponsorDonation])) ? Number(row[map.sponsorDonation]) : null,
    sponsorName: pick(row, map.sponsorCustomName),
    companyName: pick(row, map.companyName),
    note: pick(row, map.note),
  };
}

// ── analyze ────────────────────────────────────────────────
export async function analyzePurificationImport(input: {
  buffer: Buffer;
  year: number;
  templeEventId: string | null;
  originalFilename?: string | null;
  createdByUserId: string;
  /** V15R3（P0-4）：匯入類別強制指定（自動判斷＝不帶）。冤親名單只有報名姓名、無類別欄時必用。 */
  forcedCategory?: string | null;
}): Promise<{ ok: true; batchId: string; summary: Record<string, number>; detectedColumns: Record<string, string> } | { ok: false; status: number; error: string }> {
  const { columns, rows } = parseSpreadsheetBuffer(input.buffer);
  if (rows.length === 0) return { ok: false, status: 400, error: "Excel 沒有可匯入的資料列" };
  const map = resolveColumnMapping(columns);

  // V15R3（P0-4）：若指定匯入類別，覆蓋每列的 tabletCategory（供 classifyMatch 與 confirm 一致使用）。
  //   累世冤親債主：名單只有姓名（多對應到「姓名」欄＝tabletName），classifyMatch 會以報名姓名配對信眾，
  //   不要求祖先牌位格式；祖先／正魂維持既有格式。自動判斷則沿用 Excel 類別欄。
  const forced = input.forcedCategory ? normalizeCategory(input.forcedCategory) : null;

  // 候選查詢（保守）：取本批出現過的「配對用姓名」——報名姓名（devoteeName）＋
  // 全部陽上人姓名（祖先／正魂 Excel 只有牌位名稱＋陽上人，需靠陽上人配對信眾）。
  const normalized = rows.map((r) => {
    const n = normalizeRow(r, map);
    if (forced) {
      n.tabletCategory = forced;
      // 冤親名單常把報名姓名放在「姓名」欄（對應 tabletName）；補到 devoteeName 供配對。
      if (forced === "DEBT_CREDITOR" && !n.devoteeName && n.tabletName) n.devoteeName = n.tabletName;
    }
    return n;
  });
  const names = [
    ...new Set(
      normalized
        .flatMap((n) => [n.devoteeName ?? "", ...(n.yangshangNames ?? [])])
        .map((s) => s.trim())
        .filter((x) => x.length > 0)
    ),
  ];
  const members = names.length
    ? await prisma.member.findMany({
        where: { name: { in: names }, deletedAt: null },
        select: { id: true, name: true, householdId: true, household: { select: { id: true, phone: true, mobile: true, address: true } } },
      })
    : [];
  const candidatesByName = new Map<string, DevoteeCandidate[]>();
  for (const m of members) {
    // 家戶編號＝Household.id（例如 F00009）；電話取家戶市話/手機（Member 無獨立電話欄）。
    const c: DevoteeCandidate = { id: m.id, name: m.name, householdId: m.householdId, householdCode: m.household?.id ?? null, phone: m.household?.phone ?? m.household?.mobile ?? null, address: m.household?.address ?? null };
    const arr = candidatesByName.get(m.name) ?? [];
    arr.push(c);
    candidatesByName.set(m.name, arr);
  }

  // 家戶候選（正式普渡 Excel 常以家戶編號辨識，未必有信眾姓名欄）。
  const householdCodes = [...new Set(normalized.map((n) => n.householdCode).filter((x): x is string => !!x))];
  const households = householdCodes.length
    ? await prisma.household.findMany({ where: { id: { in: householdCodes }, deletedAt: null }, select: { id: true, name: true, phone: true, mobile: true, address: true } })
    : [];
  const householdCandidates = households.map((h) => ({ id: h.id, name: h.name, phone: h.phone ?? h.mobile ?? null, address: h.address ?? null }));

  // V15R7：預取本批可能命中的家戶「本年度既有普渡牌位」，供 DB 去重（已存在略過／可更新；同名不同址不合併）。
  const possibleHhIds = [...new Set<string>([...householdCodes, ...members.map((m) => m.householdId)])];
  const existingEntries = possibleHhIds.length
    ? await prisma.universalSalvationEntry.findMany({
        where: { deletedAt: null, universalSalvation: { ritualRecord: { year: input.year, householdId: { in: possibleHhIds } } } },
        select: { id: true, category: true, displayName: true, tabletAddress: true, universalSalvation: { select: { ritualRecord: { select: { householdId: true } } } } },
      })
    : [];
  const existingByHh = new Map<string, { byKey: Map<string, string>; byCatName: Set<string> }>();
  for (const e of existingEntries) {
    const hh = e.universalSalvation?.ritualRecord?.householdId;
    if (!hh) continue;
    let bucket = existingByHh.get(hh);
    if (!bucket) { bucket = { byKey: new Map(), byCatName: new Set() }; existingByHh.set(hh, bucket); }
    bucket.byKey.set(tabletIdentityKey({ category: e.category, displayName: e.displayName, tabletAddress: e.tabletAddress }), e.id);
    bucket.byCatName.add(`${e.category}::${normalizeTabletText(e.displayName)}`);
  }
  function existingMatchFor(hhId: string | null, n: NormalizedRow): { status: string; recordId: string | null } {
    const { category, displayName } = rowTabletIdentity(n);
    if (!hhId || !TABLET_CATEGORIES.has(category)) return { status: "NONE", recordId: null };
    const bucket = existingByHh.get(hhId);
    if (!bucket) return { status: "NONE", recordId: null };
    const hit = bucket.byKey.get(tabletIdentityKey({ category, displayName, tabletAddress: n.tabletAddress }));
    if (hit) return { status: "EXISTS", recordId: hit };
    if (bucket.byCatName.has(`${category}::${normalizeTabletText(displayName)}`)) return { status: "SAME_NAME_DIFF_ADDR", recordId: null };
    return { status: "NONE", recordId: null };
  }

  const seen = new Set<string>();
  const summary: Record<string, number> = { totalRows: rows.length, matchedCount: 0, newCount: 0, ambiguousCount: 0, conflictCount: 0, invalidCount: 0, duplicateCount: 0, confirmableCount: 0, existsCount: 0 };

  const created = await prisma.$transaction(async (tx) => {
    const batch = await tx.purificationImportBatch.create({
      data: {
        templeEventId: input.templeEventId,
        year: input.year,
        originalFilename: input.originalFilename ?? null,
        status: "PENDING",
        detectedColumns: map as Prisma.InputJsonValue,
        createdByUserId: input.createdByUserId,
      },
    });

    for (let i = 0; i < normalized.length; i++) {
      const n = normalized[i];
      const rowInput: ImportRowInput = { householdCode: n.householdCode, devoteeName: n.devoteeName, phone: n.phone, address: n.address, tabletCategory: n.tabletCategory, tabletName: n.tabletName, yangshangNames: n.yangshangNames };
      // 候選＝這一列可能用到的所有配對姓名（報名姓名＋全部陽上人）對應的既有信眾（去重）。
      const rowNames = [n.devoteeName ?? "", ...(n.yangshangNames ?? [])].map((s) => s.trim()).filter((s) => s.length > 0);
      const candMap = new Map<string, DevoteeCandidate>();
      for (const nm of rowNames) for (const c of candidatesByName.get(nm) ?? []) candMap.set(c.id, c);
      const cands = [...candMap.values()];
      const m = classifyMatch(rowInput, cands, seen, householdCandidates);
      seen.add(buildImportDupKey(rowInput, m.matchedDevoteeId, m.matchedHouseholdId));

      const confirmable = isRowConfirmable(m.status, m.matchedDevoteeId, false) || (m.status === "MATCHED" && !!m.matchedHouseholdId);
      summary[`${m.status.toLowerCase()}Count`] = (summary[`${m.status.toLowerCase()}Count`] ?? 0) + 1;
      if (confirmable) summary.confirmableCount++;

      // matchedHouseholdId 由 classifyMatch 直接回傳（家戶編號一致或信眾所屬家戶）。
      const matchedHouseholdId = m.matchedHouseholdId ?? (m.matchedDevoteeId ? members.find((x) => x.id === m.matchedDevoteeId)?.householdId ?? null : null);

      // V15R7：DB 去重＋每列旗標。已存在 → 預設 SKIP；否則 CREATE。祖先／正魂預設同步永久名單。
      const ex = existingMatchFor(matchedHouseholdId, n);
      if (ex.status === "EXISTS") summary.existsCount++;
      const category = n.tabletCategory ?? "ANCESTOR_LINE";
      const extra: ImportRowExtra = {
        syncToHousehold: SYNCABLE_CATEGORIES.has(category),
        existingMatchStatus: ex.status,
        existingRecordId: ex.recordId,
        resolutionAction: ex.status === "EXISTS" ? "SKIP" : "CREATE",
      };

      await tx.purificationImportRow.create({
        data: ({
          batchId: batch.id,
          rowNumber: i + 1,
          rawData: rows[i] as Prisma.InputJsonValue,
          normalizedData: n as unknown as Prisma.InputJsonValue,
          matchingStatus: m.status,
          matchedDevoteeId: m.matchedDevoteeId,
          matchedHouseholdId,
          candidateIds: m.candidateIds as Prisma.InputJsonValue,
          issueCodes: m.basis as Prisma.InputJsonValue,
          issueMessages: m.issues as Prisma.InputJsonValue,
          resolved: m.status === "MATCHED",
          ...extra,
        } as unknown as Prisma.PurificationImportRowUncheckedCreateInput),
      });
    }

    await tx.purificationImportBatch.update({ where: { id: batch.id }, data: { summary: summary as Prisma.InputJsonValue } });
    return batch.id;
  });

  // V16：白米匯入預覽——顯示本批總斤數、年度單價、預計應收與「預估剩餘」（預覽階段不寫入，
  // 僅供人工判斷；正式配額檢查於確認匯入時、在同一 transaction 內重新彙總把關）。
  const riceRequestedKg = normalized.reduce((sum, n) => sum + (n.riceKg && n.riceKg > 0 ? Math.round(n.riceKg) : 0), 0);
  if (riceRequestedKg > 0) {
    const riceTempleEventId =
      input.templeEventId ??
      (await prisma.templeEvent.findUnique({ where: { activityType_year: { activityType: "UNIVERSAL_SALVATION", year: input.year } }, select: { id: true } }))?.id ??
      null;
    if (riceTempleEventId) {
      const riceSummary = await getRiceQuotaSummary(riceTempleEventId);
      const unitPrice = riceSummary?.unitPrice ?? null;
      summary.riceRequestedKg = riceRequestedKg;
      summary.riceUnitPrice = unitPrice ?? 0;
      summary.riceEstimatedAmountDue = unitPrice != null ? Math.round(riceRequestedKg * unitPrice * 100) / 100 : 0;
      summary.riceProjectedRemainingKg = riceSummary ? Math.round((riceSummary.remainingKg - riceRequestedKg) * 100) / 100 : 0;
    }
  }

  return { ok: true, batchId: created, summary, detectedColumns: map as Record<string, string> };
}

// ── confirm（逐列隔離 transaction、共用正式核心、DB 唯一鍵防重）────────
export async function confirmPurificationImportBatch(input: {
  batchId: string;
  confirmationKey: string;
  actor: { role: Role; userId: string; name: string };
}): Promise<{ ok: true; results: { rowNumber: number; ok: boolean; recordId?: string; error?: string }[]; deduplicated: boolean } | { ok: false; status: number; error: string }> {
  const batch = await prisma.purificationImportBatch.findUnique({ where: { id: input.batchId }, include: { rows: true } });
  if (!batch) return { ok: false, status: 404, error: "找不到匯入批次" };

  // 冪等：同一 confirmationKey 已確認 → 回既有結果（不重複物化）。
  if (batch.confirmationKey === input.confirmationKey && batch.status === "CONFIRMED") {
    return {
      ok: true,
      results: batch.rows.map((r: { rowNumber: number; confirmationStatus: string; confirmedRecordId: string | null; errorMessage: string | null }) => ({
        rowNumber: r.rowNumber,
        ok: r.confirmationStatus === "CONFIRMED",
        recordId: r.confirmedRecordId ?? undefined,
        error: r.errorMessage ?? undefined,
      })),
      deduplicated: true,
    };
  }
  // 原子鎖定：PENDING/PROCESSING → PROCESSING，避免併發/重送重複執行。
  // ⚠️ V15R2：也接受既有 PROCESSING（先前確認中途中斷會卡在 PROCESSING，
  //   造成「確認並正式建立」永遠鎖死）。逐列 transaction 內會重讀 row、已 CONFIRMED
  //   直接略過，故重入不會重複建立；只把未完成的列補做完。已 CONFIRMED 的整批
  //   由上方冪等分支處理，不會進到這裡。
  const locked = await prisma.purificationImportBatch.updateMany({
    where: { id: batch.id, status: { in: ["PENDING", "PROCESSING"] } },
    data: { status: "PROCESSING", confirmationKey: input.confirmationKey },
  });
  if (locked.count === 0) {
    return { ok: false, status: 409, error: "此匯入批次已完成，請重新整理查看結果" };
  }

  // ── V15R7 效能：批次層一次預建（逐列交易外），避免每列重做 ──
  // 已明確配對到既有家戶且待確認的列，其今年普渡 RitualRecord 先在**逐列交易外**建立（冪等）。
  // 讓每列 interactive transaction 不必再跑 createBlankUniversalSalvationRecord（省 3～4 個查詢／列，
  // 遠端 DB 每個 round-trip 都昂貴，是 5000ms timeout 的主因）。新家戶的 record 於交易內才建。
  const preResolvedHhIds = [
    ...new Set(
      batch.rows
        .filter((r) => !r.excluded && r.confirmationStatus !== "CONFIRMED" && r.matchedHouseholdId)
        .map((r) => r.matchedHouseholdId as string)
    ),
  ];
  for (const hhId of preResolvedHhIds) {
    // V15R8：標記來源＝EXCEL_IMPORT（供列印中心「資料來源」篩選；不影響計價/交易/防重/同步/財務）。
    await createBlankUniversalSalvationRecord(hhId, batch.year, undefined, "EXCEL_IMPORT").catch(() => null);
  }

  const results: { rowNumber: number; ok: boolean; recordId?: string; error?: string }[] = [];
  for (const row of batch.rows) {
    if (row.excluded || row.confirmationStatus === "CONFIRMED") {
      if (row.confirmationStatus === "CONFIRMED") results.push({ rowNumber: row.rowNumber, ok: true, recordId: row.confirmedRecordId ?? undefined });
      continue;
    }
    const edited = (row.editedData ?? row.normalizedData) as unknown as NormalizedRow;
    const status = row.matchingStatus as MatchStatus;
    const resolvedDevoteeId = row.matchedDevoteeId;
    // V15R7：牌位（祖先／正魂／無緣）通常只有牌位資料、沒有信眾——只要已明確配對到既有家戶
    // （matchedHouseholdId）或已明確確認建立新家戶，即可確認建草稿（不需信眾）。
    // 仍不放寬「未確認就自動建家戶／信眾」——沒有家戶且未確認建新，交易內會擋下並整列 rollback。
    const rowConfirmable =
      isRowConfirmable(status, resolvedDevoteeId, row.createNewDevoteeConfirmed) ||
      !!row.matchedHouseholdId ||
      row.createNewHouseholdConfirmed;
    if (!rowConfirmable) {
      results.push({ rowNumber: row.rowNumber, ok: false, error: "尚未解決匹配（請先指定既有家戶／信眾，或明確確認建立新家戶／新信眾）" });
      continue;
    }

    const ext = row as unknown as ImportRowExtra;
    const category = (edited.tabletCategory ?? "ANCESTOR_LINE") as UniversalSalvationEntryCategory;
    const displayName = edited.tabletName ?? edited.devoteeName ?? "牌位";
    const doSync = ext.syncToHousehold && isSyncableWorshipCategory(category);
    const existingHouseholdId = row.matchedHouseholdId ?? null;

    try {
      // ══ Phase A（interactive transaction 外，純唯讀）：地址解析＋DB 去重決策 ══
      // 只在家戶已知（既有配對）時可先算；需建新家戶的列，家戶於交易內才建立、其既有牌位必為空（→ CREATE）。
      let precomputedAddress: string | null = null;
      let decisionHit: { id: string; ritualRecordId: string } | null = null;
      if (existingHouseholdId) {
        const hhAddr = (await prisma.household.findUnique({ where: { id: existingHouseholdId }, select: { address: true } }))?.address ?? null;
        precomputedAddress = resolveImportAddress({
          rowTabletAddress: edited.tabletAddress ?? null,
          rowAddress: edited.address ?? null,
          matchedHouseholdAddress: hhAddr,
          devoteeHouseholdAddress: hhAddr,
        }).address;
        if (TABLET_CATEGORIES.has(category)) {
          const sameCat = await prisma.universalSalvationEntry.findMany({
            where: { deletedAt: null, category, universalSalvation: { ritualRecord: { householdId: existingHouseholdId, year: batch.year } } },
            select: { id: true, displayName: true, tabletAddress: true, universalSalvation: { select: { ritualRecordId: true } } },
          });
          const wantKey = tabletIdentityKey({ category, displayName, tabletAddress: precomputedAddress });
          const e = sameCat.find((x) => tabletIdentityKey({ category, displayName: x.displayName, tabletAddress: x.tabletAddress }) === wantKey);
          if (e) decisionHit = { id: e.id, ritualRecordId: e.universalSalvation?.ritualRecordId ?? "" };
        }
      }
      // V15R7：處理語意明確分開（不用「預設 SKIP 再猜」）：
      //   無既有同一牌位（NONE／同名不同址）→ CREATE；有既有 → 預設 SKIP，僅明確 UPDATE 才更新。
      const action: "CREATE" | "UPDATE" | "SKIP" = !decisionHit ? "CREATE" : ext.resolutionAction === "UPDATE" ? "UPDATE" : "SKIP";

      // ══ SKIP：已存在且未選更新 → 不需 interactive transaction，只更新草稿列（單一寫入）══
      if (action === "SKIP") {
        await prisma.purificationImportRow.update({
          where: { id: row.id },
          data: ({ confirmationStatus: "CONFIRMED", confirmedRecordId: decisionHit!.ritualRecordId, resolved: true, errorMessage: null, existingMatchStatus: "EXISTS", existingRecordId: decisionHit!.id, resolutionAction: "SKIP" } as unknown as Prisma.PurificationImportRowUncheckedUpdateInput),
        });
        results.push({ rowNumber: row.rowNumber, ok: true, recordId: decisionHit!.ritualRecordId });
        continue;
      }

      // ══ Phase B（interactive transaction，只保留真正需要 ACID 的寫入）══
      const recordId = await prisma.$transaction(
        async (tx) => {
          // 交易內防重：已 CONFIRMED 直接回既有結果、不重做（與批次鎖定雙重保護，避免重入重複物化）。
          const fresh = await tx.purificationImportRow.findUnique({ where: { id: row.id }, select: { confirmationStatus: true, confirmedRecordId: true } });
          if (fresh?.confirmationStatus === "CONFIRMED") return fresh.confirmedRecordId ?? "";

          // 家戶：既有優先；否則明確確認才建（同一 tx）。
          let householdId = existingHouseholdId;
          let memberId = resolvedDevoteeId ?? null;
          let resolvedTabletAddress = precomputedAddress;
          if (!householdId) {
            if (!row.createNewHouseholdConfirmed) throw new Error("尚未指定家戶，且未明確確認建立新家戶");
            const hh = await createHousehold(
              { name: edited.householdName ?? edited.devoteeName ?? "匯入家戶", contactName: edited.primaryContact ?? null, address: edited.address ?? null, phone: edited.phone ?? null, companyName: edited.companyName ?? null },
              input.actor.name, tx
            );
            householdId = hh.household.id;
            // 新家戶：其今年 record 交易外未預建，於交易內建立；來源＝EXCEL_IMPORT；地址＝Excel 該列地址。
            await createBlankUniversalSalvationRecord(householdId, batch.year, tx, "EXCEL_IMPORT").catch(() => null);
            resolvedTabletAddress = resolveImportAddress({ rowTabletAddress: edited.tabletAddress ?? null, rowAddress: edited.address ?? null, matchedHouseholdAddress: edited.address ?? null, devoteeHouseholdAddress: edited.address ?? null }).address;
          }
          // 信眾：既有優先；否則明確確認才建（同一 tx）。
          if (!memberId && row.createNewDevoteeConfirmed && edited.devoteeName) {
            const mem = await createMemberForHousehold(householdId, { name: edited.devoteeName }, input.actor.name, "Excel 匯入：新增信眾", tx);
            memberId = mem.member.id;
          }

          if (action === "UPDATE") {
            // 使用者明確更新既有牌位：只更新牌位欄位，不重建寶袋/白米/贊普以免重複。
            // V33.2：歷代祖先／乙位正魂 只存核心名稱（去後綴、依 category）；同步進家戶亦同。
            const storeDisplayName = normalizeRitualNameForStore(category, displayName);
            await tx.universalSalvationEntry.update({
              where: { id: decisionHit!.id },
              data: { displayName: storeDisplayName, tabletAddress: resolvedTabletAddress, yangshangNames: edited.yangshangNames ?? [], yangshangName: edited.yangshangNames?.[0] ?? null, notes: edited.note ?? null },
            });
            if (doSync) await syncEntryToHouseholdWorshipRecord(tx, { householdId, category, displayName: storeDisplayName, tabletAddress: resolvedTabletAddress, yangshangNames: edited.yangshangNames ?? [], operatorName: input.actor.name });
            await tx.purificationImportRow.update({
              where: { id: row.id },
              data: ({ confirmationStatus: "CONFIRMED", confirmedRecordId: decisionHit!.ritualRecordId, matchedHouseholdId: householdId, matchedDevoteeId: memberId, resolved: true, errorMessage: null } as unknown as Prisma.PurificationImportRowUncheckedUpdateInput),
            });
            return decisionHit!.ritualRecordId;
          }

          // CREATE：共用核心（祖先/正魂依 syncToHousehold 於同一交易同步永久名單並回填 worshipRecordId）。
          const entryRes = await createUniversalSalvationEntry(
            householdId, batch.year,
            { category, displayName, yangshangNames: edited.yangshangNames ?? [], tabletAddress: resolvedTabletAddress, notes: edited.note ?? null, linkedItemMemberId: memberId ?? null, syncToHousehold: doSync },
            input.actor.name, tx
          );
          if (!entryRes.ok) throw new Error(entryRes.error);
          const ritualRecordId = entryRes.record.id;
          // 額外寶袋需要 entry id；僅有額外寶袋時才查（一般祖先/正魂列 extraPocketCount=0，不查）。
          const newEntry = edited.extraPocketCount > 0
            ? await tx.universalSalvationEntry.findFirst({ where: { universalSalvation: { ritualRecordId }, displayName, deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true } })
            : null;

          // 白米（只用草稿斤數；價/配額由 registerRice 依今年重算）。
          if (edited.riceKg && edited.riceKg > 0) {
            const rice = await registerRice({ ritualRecordId, memberId: memberId ?? null, kg: edited.riceKg, overageReason: null }, input.actor, tx);
            if (!rice.ok) throw new Error(`白米：${rice.error}`);
          }
          // 額外寶袋（isExtra=true，共用 createAdditionalPrintItem）。
          if (edited.extraPocketCount > 0 && newEntry) {
            const p = await createAdditionalPrintItem(
              householdId, batch.year, newEntry.id,
              { itemType: "POCKET", usesSourceName: true, quantity: edited.extraPocketCount, isExtra: true, isChargeable: true },
              input.actor.name, tx
            );
            if (!p.ok) throw new Error(`額外寶袋：${p.error}`);
          }
          // 贊普／隨喜贊普（共用 RitualRegistrationItem；一律 DRAFT、amountPaid=0）。
          await materializeSponsors(ritualRecordId, memberId, batch.templeEventId, edited, input.actor.name, tx);

          await tx.purificationImportRow.update({ where: { id: row.id }, data: { confirmationStatus: "CONFIRMED", confirmedRecordId: ritualRecordId, matchedHouseholdId: householdId, matchedDevoteeId: memberId, resolved: true, errorMessage: null } });
          return ritualRecordId;
        },
        // 已把唯讀（地址/去重/決策）與 record 預建移出交易；交易內只剩必要寫入。仍給合理上限
        // 以容忍遠端 DB 高延遲下的多筆寫入（與本專案其他多筆寫入交易相同上限），非以 timeout 掩蓋。
        { timeout: 20000, maxWait: 15000 }
      );
      results.push({ rowNumber: row.rowNumber, ok: true, recordId });
    } catch (e) {
      // transaction 已整列 rollback（無正式殘留）；transaction 外把 row 標 FAILED 供修正後重試。
      const msg = e instanceof Error ? e.message : "物化失敗";
      await prisma.purificationImportRow.update({ where: { id: row.id }, data: { confirmationStatus: "FAILED", errorMessage: msg } });
      results.push({ rowNumber: row.rowNumber, ok: false, error: msg });
    }
  }

  const anyFail = results.some((r) => !r.ok);
  await prisma.purificationImportBatch.update({
    where: { id: batch.id },
    data: { status: anyFail ? "PENDING" : "CONFIRMED", confirmedByUserId: input.actor.userId, confirmedAt: anyFail ? null : new Date() },
  });
  return { ok: true, results, deduplicated: false };
}

/**
 * 贊普／隨喜贊普物化：共用既有 RitualRegistrationItem（US_SPONSOR＝FIXED、
 * US_SPONSOR_DONATION＝CUSTOM）＋既有 receivableAdapters／帳本（status=CONFIRMED
 * 即進待收）。不另建 sponsor service。金額以年度 sponsorUnitPrice / 草稿自訂金額為準。
 */
async function materializeSponsors(
  ritualRecordId: string,
  memberId: string | null,
  templeEventId: string | null,
  edited: NormalizedRow,
  operatorName: string,
  db: DbClient
): Promise<void> {
  const hasSponsor = !!edited.sponsor && edited.sponsor > 0;
  const hasDonation = !!edited.sponsorDonation && edited.sponsorDonation > 0;
  if (!hasSponsor && !hasDonation) return;

  const types = await db.registrationItemType.findMany({ where: { key: { in: ["US_SPONSOR", "US_SPONSOR_DONATION"] } }, select: { id: true, key: true } });
  const sponsorType = types.find((t: { id: string; key: string }) => t.key === "US_SPONSOR");
  const donationType = types.find((t: { id: string; key: string }) => t.key === "US_SPONSOR_DONATION");
  const event = templeEventId ? await db.templeEvent.findUnique({ where: { id: templeEventId }, select: { sponsorUnitPrice: true } }) : null;
  const sponsorUnit = event?.sponsorUnitPrice ? Number(event.sponsorUnitPrice) : null;
  const customName = edited.sponsorName ?? edited.companyName ?? null;

  if (hasSponsor && sponsorType) {
    const qty = Math.floor(edited.sponsor!);
    const amount = sponsorUnit !== null ? Math.round(sponsorUnit * qty * 100) / 100 : 0;
    const item = await db.ritualRegistrationItem.create({
      data: {
        ritualRecordId, registrationItemTypeId: sponsorType.id, memberId: memberId ?? null,
        quantity: qty, feeChoice: "FIXED",
        // V15R7：匯入一律建**草稿**、amountPaid=0（Prisma 預設）、不建收款交易、不進已收；
        // 由操作人員之後手動確認報名／收費才進帳本。
        amountDue: new Prisma.Decimal(amount), amountUnpaid: new Prisma.Decimal(amount),
        lockedUnitPrice: sponsorUnit !== null ? new Prisma.Decimal(sponsorUnit) : null,
        customName, status: "DRAFT",
      },
    });
    await recordVersion({ entityType: "RitualRegistrationItem", entityId: item.id, action: "CREATE", afterData: item, operatorName, changeNote: "Excel 匯入：贊普" }, db);
  }
  if (hasDonation && donationType) {
    const amount = Math.round(edited.sponsorDonation! * 100) / 100;
    const item = await db.ritualRegistrationItem.create({
      data: {
        ritualRecordId, registrationItemTypeId: donationType.id, memberId: memberId ?? null,
        quantity: 1, feeChoice: "CUSTOM",
        // V15R7：隨喜贊普可讀 Excel 隨喜金額，但一律建**草稿**、amountPaid=0、不進已收。
        amountDue: new Prisma.Decimal(amount), amountUnpaid: new Prisma.Decimal(amount),
        customName, status: "DRAFT",
      },
    });
    await recordVersion({ entityType: "RitualRegistrationItem", entityId: item.id, action: "CREATE", afterData: item, operatorName, changeNote: "Excel 匯入：隨喜贊普" }, db);
  }
}

// 供 UI 讀取草稿。
export async function getPurificationImportBatch(batchId: string) {
  return prisma.purificationImportBatch.findUnique({ where: { id: batchId }, include: { rows: { orderBy: { rowNumber: "asc" } } } });
}

/** 預檢卡片顯示用的補齊資料（配對信眾/電話/家戶編號/戶名/地址/地址來源/候選）。 */
export type RowEnrichment = {
  matchedDevoteeName: string | null;
  householdCode: string | null;
  householdName: string | null;
  phone: string | null;
  address: string | null;
  addressSource: "Excel" | "家戶" | "信眾" | null;
  candidates: { id: string; name: string; householdCode: string | null; householdName: string | null }[];
};

/**
 * V15R2：讀取草稿並「從信眾管理／家戶管理補齊」每列顯示資料。
 * Excel 只有最少必要欄位（祖先＝牌位名稱＋陽上人；冤親＝報名姓名）；配對信眾/家戶後，
 * 地址、家戶編號、戶名、電話一律讀既有資料，不寫回草稿、不改匯入核心，純讀時補齊。
 */
export async function getPurificationImportBatchEnriched(batchId: string) {
  const batch = await getPurificationImportBatch(batchId);
  if (!batch) return null;

  const memberIds = new Set<string>();
  const householdIds = new Set<string>();
  for (const r of batch.rows) {
    if (r.matchedDevoteeId) memberIds.add(r.matchedDevoteeId);
    if (r.matchedHouseholdId) householdIds.add(r.matchedHouseholdId);
    for (const c of ((r.candidateIds as string[] | null) ?? [])) memberIds.add(c);
  }

  const [members, households] = await Promise.all([
    memberIds.size
      ? prisma.member.findMany({
          where: { id: { in: [...memberIds] } },
          select: { id: true, name: true, household: { select: { id: true, name: true, address: true, phone: true, mobile: true } } },
        })
      : [],
    householdIds.size
      ? prisma.household.findMany({ where: { id: { in: [...householdIds] } }, select: { id: true, name: true, address: true, phone: true, mobile: true } })
      : [],
  ]);
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const hhMap = new Map(households.map((h) => [h.id, h]));

  const rows = batch.rows.map((r) => {
    const md = r.matchedDevoteeId ? memberMap.get(r.matchedDevoteeId) ?? null : null;
    const mh = r.matchedHouseholdId ? hhMap.get(r.matchedHouseholdId) ?? null : null;
    // 預覽地址＝正式寫入用的同一套解析（Excel該筆→配對信眾→配對家戶），避免預覽/正式不一致。
    const nd = (r.editedData ?? r.normalizedData) as Partial<NormalizedRow> | null;
    const { address, source } = resolveImportAddress({
      rowTabletAddress: nd?.tabletAddress ?? null,
      rowAddress: nd?.address ?? null,
      matchedHouseholdAddress: mh?.address ?? null,
      devoteeHouseholdAddress: md?.household?.address ?? null,
      devoteeOwnAddress: null, // 現行 schema：Member 無獨立地址欄
    });
    const candidates = ((r.candidateIds as string[] | null) ?? []).map((id) => {
      const m = memberMap.get(id);
      return { id, name: m?.name ?? id, householdCode: m?.household?.id ?? null, householdName: m?.household?.name ?? null };
    });
    const enrichment: RowEnrichment = {
      matchedDevoteeName: md?.name ?? null,
      householdCode: mh?.id ?? md?.household?.id ?? null,
      householdName: mh?.name ?? md?.household?.name ?? null,
      phone: md?.household?.phone ?? md?.household?.mobile ?? mh?.phone ?? mh?.mobile ?? null,
      address,
      addressSource: source,
      candidates,
    };
    return { ...r, enrichment };
  });

  return { ...batch, rows };
}
