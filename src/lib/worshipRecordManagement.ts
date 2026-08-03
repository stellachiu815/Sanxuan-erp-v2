import { WorshipType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveRitualDisplayName, categoryFromWorshipType } from "@/lib/ritualDisplayName";
import { recordVersion } from "@/lib/recordVersion";
import { normalizeYangshangName } from "@/lib/printChinese";

/**
 * V28：家戶「祭祀永久資料」（歷代祖先／乙位正魂 WorshipRecord）的正式維護——
 * 編輯、封存（軟刪除）、恢復。沿用既有 deletedAt/deletedByName 軟刪除慣例與
 * recordVersion 稽核，不建第二套刪除架構。
 *
 * ⚠️ 只影響「目前永久資料」與「未來帶入」：封存/編輯**不回溯**已建立的年度普渡
 * 報名、列印快照、收款、收據或帳務（那些都是各自獨立的快照/紀錄，與 WorshipRecord
 * 沒有回溯關聯）。有效查詢一律 deletedAt: null；封存區為 deletedAt 非 null。
 *
 * 陽上人維持自由輸入多位姓名（頓號分隔、normalizeYangshangName 清理），不加親屬稱謂。
 */

export type WorshipResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export type UpdateWorshipRecordInput = {
  displayName?: string;
  /** 安奉地址 */
  location?: string | null;
  /** 陽上人：多位以頓號分隔，自由文字（不加親屬稱謂）。 */
  yangshangName?: string | null;
  notes?: string | null;
  type?: WorshipType;
};

/** 編輯一筆有效（未封存）的祭祀永久資料。 */
export async function updateWorshipRecord(
  id: string,
  input: UpdateWorshipRecordInput,
  operatorName: string | null
): Promise<WorshipResult<{ id: string }>> {
  const existing = await prisma.worshipRecord.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return { ok: false, status: 404, error: "找不到這筆祭祀資料，或已封存" };

  const data: {
    displayName?: string;
    location?: string | null;
    yangshangName?: string | null;
    notes?: string | null;
    type?: WorshipType;
  } = {};
  if (input.displayName !== undefined) {
    const n = input.displayName.trim();
    if (!n) return { ok: false, status: 400, error: "請輸入牌位名稱" };
    // V33.1：歷代祖先／乙位正魂 儲存前正規化為完整顯示名稱（防重、姓非府；type 依既有 WorshipType 欄位）。
    const cat = categoryFromWorshipType(input.type ?? existing.type);
    data.displayName = cat === "ANCESTOR_LINE" || cat === "INDIVIDUAL_SOUL" ? resolveRitualDisplayName(cat, n) : n;
  }
  if (input.location !== undefined) data.location = input.location?.trim() || null;
  if (input.yangshangName !== undefined) {
    data.yangshangName = input.yangshangName && input.yangshangName.trim() ? normalizeYangshangName(input.yangshangName) : null;
  }
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
  if (input.type !== undefined) data.type = input.type;

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.worshipRecord.update({ where: { id }, data });
    await recordVersion(
      {
        entityType: "WorshipRecord",
        entityId: id,
        action: "UPDATE",
        beforeData: existing,
        afterData: u,
        operatorName,
        changeNote: "家戶祭祀資料：編輯（只影響未來帶入，不回溯既有年度快照/收款/收據/列印）",
      },
      tx
    );
    return u;
  });
  return { ok: true, data: { id: updated.id } };
}

/** 封存（軟刪除）一筆有效的祭祀永久資料。 */
export async function archiveWorshipRecord(
  id: string,
  operatorName: string | null
): Promise<WorshipResult<{ id: string }>> {
  const existing = await prisma.worshipRecord.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return { ok: false, status: 404, error: "找不到這筆祭祀資料，或已封存" };

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.worshipRecord.update({
      where: { id },
      data: { deletedAt: new Date(), deletedByName: operatorName },
    });
    await recordVersion(
      {
        entityType: "WorshipRecord",
        entityId: id,
        action: "DELETE",
        beforeData: existing,
        afterData: u,
        operatorName,
        changeNote: "家戶祭祀資料：封存（僅影響未來帶入，不回溯既有年度報名/列印快照/收款/收據/帳務）",
      },
      tx
    );
    return u;
  });
  return { ok: true, data: { id: updated.id } };
}

/** 恢復一筆已封存的祭祀永久資料。 */
export async function restoreWorshipRecord(
  id: string,
  operatorName: string | null
): Promise<WorshipResult<{ id: string }>> {
  const existing = await prisma.worshipRecord.findFirst({ where: { id, deletedAt: { not: null } } });
  if (!existing) return { ok: false, status: 404, error: "找不到已封存的祭祀資料" };

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.worshipRecord.update({ where: { id }, data: { deletedAt: null, deletedByName: null } });
    await recordVersion(
      {
        entityType: "WorshipRecord",
        entityId: id,
        action: "RESTORE",
        beforeData: existing,
        afterData: u,
        operatorName,
        changeNote: "家戶祭祀資料：恢復封存",
      },
      tx
    );
    return u;
  });
  return { ok: true, data: { id: updated.id } };
}

/** 列出某家戶「已封存」的祭祀永久資料（封存區）。 */
export async function listArchivedWorshipRecords(householdId: string) {
  return prisma.worshipRecord.findMany({
    where: { householdId, deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
  });
}
