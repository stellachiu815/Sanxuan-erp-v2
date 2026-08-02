/**
 * V30.3 普渡報名順序（registrationOrder）併發安全取號。
 *
 * 範圍＝(templeEventId, registrationItemTypeId)，每個範圍各自從 1 遞增。
 * 併發安全：必須在**同一個 transaction** 內：
 *   1. 取得 PostgreSQL transaction advisory lock（依範圍 key，交易結束自動釋放）
 *   2. 查該範圍目前最大 registrationOrder
 *   3. 新號 = 最大值 + 1（無資料時 1）
 * 資料庫 unique index `rri_event_item_order_key` 為最後防線（不得只依賴 max+1）。
 *
 * ⚠️ 全部用 raw SQL，不依賴 Prisma client 是否已 regenerate（欄位剛加）。
 * templeEventId 為 null（無活動歸屬）時不取號、回傳 null，不占用正式順序。
 *
 * 注意：本規則**不套用**祭改「跳過含連續 44」規則——普渡順序正常包含 44（1..N 連續）。
 */
import type { DbClient } from "@/lib/prisma";

export async function assignRegistrationOrder(
  tx: DbClient,
  templeEventId: string | null | undefined,
  registrationItemTypeId: string
): Promise<number | null> {
  if (!templeEventId) return null; // 無活動歸屬不取號
  const key = `${templeEventId}:${registrationItemTypeId}`;
  // 依範圍序列化取號（同 (活動,項目) 的並發報名會排隊，避免讀到相同 max）。
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  const rows = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT MAX("registrationOrder") AS max
    FROM "ritual_registration_items"
    WHERE "templeEventId" = ${templeEventId}
      AND "registrationItemTypeId" = ${registrationItemTypeId}
  `;
  const max = rows[0]?.max ?? 0;
  return max + 1;
}

/**
 * 建立報名後套用順序：由 ritualRecordId 查出活動，取號並回填 templeEventId + registrationOrder。
 * 全 raw SQL（不依賴 client regenerate）。必須在建立該 item 的同一 transaction 內呼叫（advisory
 * lock 才有意義，unique index 才是同交易保護）。活動為 null（如尚未指定活動）時不取號、不回填。
 */
export async function applyRegistrationOrder(
  tx: DbClient,
  itemId: string,
  ritualRecordId: string,
  registrationItemTypeId: string
): Promise<number | null> {
  const rr = await tx.$queryRaw<{ templeEventId: string | null }[]>`
    SELECT "templeEventId" FROM "ritual_records" WHERE "id" = ${ritualRecordId}
  `;
  const templeEventId = rr[0]?.templeEventId ?? null;
  if (!templeEventId) return null; // 無活動歸屬不取號
  const order = await assignRegistrationOrder(tx, templeEventId, registrationItemTypeId);
  await tx.$executeRaw`
    UPDATE "ritual_registration_items"
    SET "templeEventId" = ${templeEventId}, "registrationOrder" = ${order}
    WHERE "id" = ${itemId}
  `;
  return order;
}

/**
 * 純函式：既有資料補號的「排序＋編號」規則（供 backfill 與測試共用）。
 * 依 createdAt ASC、相同再 id ASC，回傳每筆的 registrationOrder（1..N，含取消，取消保留原位）。
 * **不**跳過任何號碼（普渡順序連續，含 44）。
 */
export function computeBackfillOrders<T extends { id: string; createdAt: Date }>(
  rows: readonly T[]
): { id: string; registrationOrder: number }[] {
  const sorted = [...rows].sort((a, b) => {
    const t = a.createdAt.getTime() - b.createdAt.getTime();
    return t !== 0 ? t : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted.map((r, i) => ({ id: r.id, registrationOrder: i + 1 }));
}
