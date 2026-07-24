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
import { recordVersion } from "@/lib/recordVersion";
import { parseSpreadsheetBuffer } from "@/lib/smartImport";
import {
  resolveColumnMapping,
  parseYangshangNames,
  extractRiceKgFromImport,
  classifyMatch,
  isRowConfirmable,
  type DevoteeCandidate,
  type ImportRowInput,
  type MatchStatus,
} from "@/lib/purificationImportRules";
import {
  createUniversalSalvationEntry,
  createBlankUniversalSalvationRecord,
} from "@/lib/ritual";
import { registerRice } from "@/lib/whiteRiceService";
import { createHousehold } from "@/lib/householdManagement";
import { createMemberForHousehold } from "@/lib/memberCreate";
import { createAdditionalPrintItem } from "@/lib/additionalPrintItems";
import type { Role } from "@/lib/whiteRice";
import type { UniversalSalvationEntryCategory } from "@prisma/client";

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
  冤親債主: "DEBT_CREDITOR", 累世冤親債主: "DEBT_CREDITOR", DEBT_CREDITOR: "DEBT_CREDITOR",
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
}): Promise<{ ok: true; batchId: string; summary: Record<string, number>; detectedColumns: Record<string, string> } | { ok: false; status: number; error: string }> {
  const { columns, rows } = parseSpreadsheetBuffer(input.buffer);
  if (rows.length === 0) return { ok: false, status: 400, error: "Excel 沒有可匯入的資料列" };
  const map = resolveColumnMapping(columns);

  // 候選查詢（保守）：先取本批出現過的姓名，查既有信眾（Member）＋家戶。
  const normalized = rows.map((r) => normalizeRow(r, map));
  const names = [...new Set(normalized.map((n) => n.devoteeName).filter((x): x is string => !!x))];
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

  const seen = new Set<string>();
  const summary: Record<string, number> = { totalRows: rows.length, matchedCount: 0, newCount: 0, ambiguousCount: 0, conflictCount: 0, invalidCount: 0, duplicateCount: 0, confirmableCount: 0 };

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
      const rowInput: ImportRowInput = { householdCode: n.householdCode, devoteeName: n.devoteeName, phone: n.phone, address: n.address, tabletCategory: n.tabletCategory, tabletName: n.tabletName };
      const cands = n.devoteeName ? candidatesByName.get(n.devoteeName) ?? [] : [];
      const m = classifyMatch(rowInput, cands, seen, householdCandidates);
      seen.add(`${n.householdCode ?? ""}|${n.devoteeName ?? ""}|${n.tabletName ?? ""}|${n.phone ?? ""}`);

      const confirmable = isRowConfirmable(m.status, m.matchedDevoteeId, false) || (m.status === "MATCHED" && !!m.matchedHouseholdId);
      summary[`${m.status.toLowerCase()}Count`] = (summary[`${m.status.toLowerCase()}Count`] ?? 0) + 1;
      if (confirmable) summary.confirmableCount++;

      // matchedHouseholdId 由 classifyMatch 直接回傳（家戶編號一致或信眾所屬家戶）。
      const matchedHouseholdId = m.matchedHouseholdId ?? (m.matchedDevoteeId ? members.find((x) => x.id === m.matchedDevoteeId)?.householdId ?? null : null);
      await tx.purificationImportRow.create({
        data: {
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
        },
      });
    }

    await tx.purificationImportBatch.update({ where: { id: batch.id }, data: { summary: summary as Prisma.InputJsonValue } });
    return batch.id;
  });

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
  // 原子鎖定：PENDING → PROCESSING，避免併發/重送重複執行。
  const locked = await prisma.purificationImportBatch.updateMany({
    where: { id: batch.id, status: "PENDING" },
    data: { status: "PROCESSING", confirmationKey: input.confirmationKey },
  });
  if (locked.count === 0) {
    return { ok: false, status: 409, error: "此匯入批次已在確認中或已完成，請重新整理查看結果" };
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
    if (!isRowConfirmable(status, resolvedDevoteeId, row.createNewDevoteeConfirmed)) {
      results.push({ rowNumber: row.rowNumber, ok: false, error: "尚未解決匹配（AMBIGUOUS/CONFLICT/INVALID 或未確認建新）" });
      continue;
    }
    try {
      // ── 單列一個 transaction：任一步失敗整列 rollback，不留半套正式資料。
      //    所有寫入 service 都傳同一個 tx（tx-aware）——新家戶/信眾/牌位/linked item/
      //    TABLET・POCKET/白米/額外寶袋/贊普/應收/帳本/row 更新全在同一交易。
      const recordId = await prisma.$transaction(async (tx) => {
        // 交易內防重：重新讀 row，已 CONFIRMED 直接回既有結果、不重做。
        const fresh = await tx.purificationImportRow.findUnique({ where: { id: row.id }, select: { confirmationStatus: true, confirmedRecordId: true } });
        if (fresh?.confirmationStatus === "CONFIRMED") return fresh.confirmedRecordId ?? "";

        // 1) 家戶：既有優先；否則明確確認才建（共用 createHousehold，同一 tx）。
        let householdId = row.matchedHouseholdId ?? null;
        let memberId = resolvedDevoteeId ?? null;
        if (!householdId) {
          if (!row.createNewHouseholdConfirmed) throw new Error("尚未指定家戶，且未明確確認建立新家戶");
          const hh = await createHousehold(
            { name: edited.householdName ?? edited.devoteeName ?? "匯入家戶", contactName: edited.primaryContact ?? null, address: edited.address ?? null, phone: edited.phone ?? null, companyName: edited.companyName ?? null },
            input.actor.name, tx
          );
          householdId = hh.household.id;
        }
        // 信眾：既有優先；否則明確確認才建（共用 createMemberForHousehold，同一 tx）。
        if (!memberId && row.createNewDevoteeConfirmed && edited.devoteeName) {
          const mem = await createMemberForHousehold(householdId, { name: edited.devoteeName }, input.actor.name, "Excel 匯入：新增信眾", tx);
          memberId = mem.member.id;
        }

        // 2) 今年 record（DRAFT）＋牌位（共用核心，同一 tx）。
        await createBlankUniversalSalvationRecord(householdId, batch.year, tx).catch(() => null);
        const displayName = edited.tabletName ?? edited.devoteeName ?? "牌位";
        const entryRes = await createUniversalSalvationEntry(
          householdId, batch.year,
          {
            category: (edited.tabletCategory ?? "ANCESTOR_LINE") as UniversalSalvationEntryCategory,
            displayName, yangshangNames: edited.yangshangNames ?? [], tabletAddress: edited.tabletAddress ?? null,
            notes: edited.note ?? null, linkedItemMemberId: memberId ?? null,
          },
          input.actor.name, tx
        );
        if (!entryRes.ok) throw new Error(entryRes.error);
        const ritualRecordId = entryRes.record.id;
        const newEntry = await tx.universalSalvationEntry.findFirst({
          where: { universalSalvation: { ritualRecordId }, displayName, deletedAt: null },
          orderBy: { createdAt: "desc" }, select: { id: true },
        });

        // 3) 白米（只用草稿斤數；價/配額/超額由 registerRice 依今年重算，同一 tx）。
        if (edited.riceKg && edited.riceKg > 0) {
          const rice = await registerRice({ ritualRecordId, memberId: memberId ?? null, kg: edited.riceKg, overageReason: null }, input.actor, tx);
          if (!rice.ok) throw new Error(`白米：${rice.error}`);
        }

        // 4) 額外寶袋（isExtra=true，共用 createAdditionalPrintItem，同一 tx）。
        if (edited.extraPocketCount > 0 && newEntry) {
          const p = await createAdditionalPrintItem(
            householdId, batch.year, newEntry.id,
            { itemType: "POCKET", usesSourceName: true, quantity: edited.extraPocketCount, isExtra: true, isChargeable: true },
            input.actor.name, tx
          );
          if (!p.ok) throw new Error(`額外寶袋：${p.error}`);
        }

        // 5) 贊普／隨喜贊普（共用 RitualRegistrationItem＋receivableAdapters，同一 tx）。
        await materializeSponsors(ritualRecordId, memberId, batch.templeEventId, edited, input.actor.name, tx);

        // 6) row 標成功（同一 tx；失敗會連同上面全部 rollback，不會留半套）。
        await tx.purificationImportRow.update({ where: { id: row.id }, data: { confirmationStatus: "CONFIRMED", confirmedRecordId: ritualRecordId, matchedHouseholdId: householdId, matchedDevoteeId: memberId, resolved: true, errorMessage: null } });
        return ritualRecordId;
      });
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
        amountDue: new Prisma.Decimal(amount), amountUnpaid: new Prisma.Decimal(amount),
        lockedUnitPrice: sponsorUnit !== null ? new Prisma.Decimal(sponsorUnit) : null,
        customName, status: "CONFIRMED",
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
        amountDue: new Prisma.Decimal(amount), amountUnpaid: new Prisma.Decimal(amount),
        customName, status: "CONFIRMED",
      },
    });
    await recordVersion({ entityType: "RitualRegistrationItem", entityId: item.id, action: "CREATE", afterData: item, operatorName, changeNote: "Excel 匯入：隨喜贊普" }, db);
  }
}

// 供 UI 讀取草稿。
export async function getPurificationImportBatch(batchId: string) {
  return prisma.purificationImportBatch.findUnique({ where: { id: batchId }, include: { rows: { orderBy: { rowNumber: "asc" } } } });
}
