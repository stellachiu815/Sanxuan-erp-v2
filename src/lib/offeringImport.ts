import { prisma } from "@/lib/prisma";
import { createOfferingClaim, recordOfferingPayment } from "@/lib/offeringClaims";

/**
 * V10.1「供品認捐中心」需求「八、Excel/CSV 匯入」核心邏輯。
 *
 * 比照 V9.1 附加列印項目的既有慣例：只重用 src/lib/smartImport.ts 裡
 * 「讀檔／欄位對應記憶／猜欄位對應」這幾支通用函式（跟 templeEventId 無關，
 * 純粹是檔案解析與欄位對應），不重用 analyzeImport／commitImport（那兩支
 * 是綁定「家戶報名參加某個活動」邏輯，跟供品認捐的資料形狀不同），改用這裡
 * 獨立的 analyzeOfferingClaimImport／commitOfferingClaimImport。
 *
 * 支援需求「八」的方式一（固定欄位）與方式二（專屬工作表）：兩種只是
 * Excel 檔案的排版方式不同，實際欄位定義都是
 * src/lib/importFieldSuggestion.ts 的 OFFERING_CLAIM_FIELDS，不需要
 * 兩套邏輯。
 */

export type OfferingImportRowStatus = "OK" | "NEEDS_CONFIRMATION" | "ERROR";

export type OfferingImportRow = {
  rowNumber: number;
  raw: Record<string, unknown>;
  status: OfferingImportRowStatus;
  message: string | null;
  resolved?: {
    householdId: string;
    sponsorMemberId: string;
    activityOfferingId: string;
    floralSlotId: string | null;
    quantity: number;
    unitPrice: number | null;
    paidAmount: number;
    note: string | null;
  };
};

function readString(mapped: Record<string, unknown>, key: string): string | null {
  const v = mapped[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

function readNumber(mapped: Record<string, unknown>, key: string): number | null {
  const v = mapped[key];
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 分析（預覽，不寫入）：mappedRows 是「已經依欄位對應轉換過 key」的資料列
 * （key 是 OFFERING_CLAIM_FIELDS 的 key，例如 householdId/sponsorName/
 * offeringTypeName……），mapping 是「原始 Excel 欄位名稱 → 目標欄位 key」
 * 的對應表（由 API route 先用 smartImport.ts 的 parseSpreadsheetBuffer +
 * suggestColumnMapping/getFieldMapping 準備好），比照
 * additionalPrintItems.ts 的 analyzeAdditionalPrintItemImport() 同一套
 * applyMapping 慣例，在這裡統一套用，不假設呼叫端已經轉換過欄位名稱。
 */
export async function analyzeOfferingClaimImport(
  templeEventId: string,
  rows: Record<string, unknown>[],
  mapping: Record<string, string | null>
): Promise<OfferingImportRow[]> {
  const activityOfferings = await prisma.activityOffering.findMany({
    where: { templeEventId },
    include: { offeringType: true, floralSlots: true },
  });

  function applyMapping(row: Record<string, unknown>): Record<string, unknown> {
    const mapped: Record<string, unknown> = {};
    for (const [col, value] of Object.entries(row)) {
      const target = mapping[col];
      if (target) mapped[target] = value;
    }
    return mapped;
  }

  const results: OfferingImportRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // Excel 第 2 列開始（第 1 列是標題列），比照既有慣例
    const mapped = applyMapping(rows[i]);
    const householdId = readString(mapped, "householdId");
    const sponsorName = readString(mapped, "sponsorName");
    const offeringTypeName = readString(mapped, "offeringTypeName");

    if (!householdId || !sponsorName || !offeringTypeName) {
      results.push({
        rowNumber,
        raw: mapped,
        status: "ERROR",
        message: "家戶編號／認捐人姓名／供品名稱為必填欄位",
      });
      continue;
    }

    const household = await prisma.household.findUnique({
      where: { id: householdId },
      include: { members: true },
    });
    if (!household || household.deletedAt) {
      results.push({ rowNumber, raw: mapped, status: "ERROR", message: `找不到家戶編號「${householdId}」` });
      continue;
    }

    const member = household.members.find((m) => !m.deletedAt && m.name === sponsorName);
    if (!member) {
      results.push({
        rowNumber,
        raw: mapped,
        status: "NEEDS_CONFIRMATION",
        message: `這一戶查無信眾「${sponsorName}」，請先確認或新增信眾資料`,
      });
      continue;
    }

    const activityOffering = activityOfferings.find((o) => o.offeringType.name === offeringTypeName);
    if (!activityOffering) {
      results.push({
        rowNumber,
        raw: mapped,
        status: "NEEDS_CONFIRMATION",
        message: `這個活動尚未設定供品「${offeringTypeName}」，請先到供品認捐中心加入這個供品`,
      });
      continue;
    }

    let floralSlotId: string | null = null;
    if (activityOffering.offeringType.behaviorKind === "FLORAL") {
      const month = readNumber(mapped, "floralLunarMonth");
      const day = readNumber(mapped, "floralLunarDay");
      if (!month || !day) {
        results.push({
          rowNumber,
          raw: mapped,
          status: "ERROR",
          message: "花果供品必須填寫農曆月與農曆日",
        });
        continue;
      }
      const slot = activityOffering.floralSlots.find((s) => s.lunarMonth === month && s.lunarDay === day && !s.isLeapMonth);
      if (!slot) {
        results.push({ rowNumber, raw: mapped, status: "ERROR", message: `找不到農曆 ${month} 月 ${day} 日的花果供品名額` });
        continue;
      }
      const alreadyClaimed = await prisma.offeringClaim.count({
        where: { floralSlotId: slot.id, status: "ACTIVE", deletedAt: null },
      });
      if (alreadyClaimed > 0) {
        results.push({
          rowNumber,
          raw: mapped,
          status: "NEEDS_CONFIRMATION",
          message: `農曆 ${month} 月 ${day} 日已經有人認捐，請確認是否要改成其他日期`,
        });
        continue;
      }
      floralSlotId = slot.id;
    }

    const quantity = readNumber(mapped, "quantity") ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      results.push({ rowNumber, raw: mapped, status: "ERROR", message: "數量請輸入正整數" });
      continue;
    }

    results.push({
      rowNumber,
      raw: mapped,
      status: "OK",
      message: null,
      resolved: {
        householdId,
        sponsorMemberId: member.id,
        activityOfferingId: activityOffering.id,
        floralSlotId,
        quantity,
        unitPrice: readNumber(mapped, "unitPrice"),
        paidAmount: readNumber(mapped, "paidAmount") ?? 0,
        note: readString(mapped, "notes"),
      },
    });
  }

  return results;
}

export type CommitOfferingClaimImportResult = {
  importedCount: number;
  skippedCount: number;
  errors: { rowNumber: number; error: string }[];
};

/** 確認匯入：只有 status=OK 的列會真正寫入，其餘（ERROR/NEEDS_CONFIRMATION）一律跳過，不會被匯入。 */
export async function commitOfferingClaimImport(
  rows: OfferingImportRow[],
  createdBy?: string | null
): Promise<CommitOfferingClaimImportResult> {
  let importedCount = 0;
  let skippedCount = 0;
  const errors: { rowNumber: number; error: string }[] = [];

  for (const row of rows) {
    if (row.status !== "OK" || !row.resolved) {
      skippedCount += 1;
      continue;
    }
    const result = await createOfferingClaim(
      {
        activityOfferingId: row.resolved.activityOfferingId,
        sponsorMemberId: row.resolved.sponsorMemberId,
        floralSlotId: row.resolved.floralSlotId,
        quantity: row.resolved.quantity,
        unitPrice: row.resolved.unitPrice,
        note: row.resolved.note,
        createdBy,
      },
      createdBy
    );
    if (!result.ok) {
      errors.push({ rowNumber: row.rowNumber, error: result.error });
      continue;
    }
    importedCount += 1;

    if (row.resolved.paidAmount > 0) {
      await recordOfferingPayment(
        result.data.id,
        { amount: row.resolved.paidAmount, paidOn: new Date(), method: "Excel匯入", note: "匯入時一併登錄的已收金額" },
        createdBy
      );
    }
  }

  return { importedCount, skippedCount, errors };
}
