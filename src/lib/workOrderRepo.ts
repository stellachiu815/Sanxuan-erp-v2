/**
 * V32 workOrder 正式作業編號資料存取（raw SQL；欄位已由 migration 部署，sandbox 無法 prisma generate
 * 故沿用 registrationOrder 的 raw SQL 慣例，不依賴 typed client）。
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { printNumberOf } from "@/lib/workOrder";
import { resolveRitualDisplayName, categoryFromItemKey } from "@/lib/ritualDisplayName";

/** 一批 item 的 registrationOrder 與 workOrder（供各輸出以 printNumberOf 統一取號）。 */
export async function getOrderNumbers(itemIds: string[]): Promise<Map<string, { registrationOrder: number | null; workOrder: number | null }>> {
  if (itemIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ id: string; ro: number | null; wo: number | null }[]>`
    SELECT "id", "registrationOrder" AS ro, "workOrder" AS wo
    FROM "ritual_registration_items" WHERE "id" = ANY(${itemIds})`;
  return new Map(rows.map((r) => [r.id, { registrationOrder: r.ro, workOrder: r.wo }]));
}

/** 正式列印號（單一入口）：workOrder 優先，NULL 回退 registrationOrder。 */
export async function printNumberFor(itemId: string): Promise<number | null> {
  const m = await getOrderNumbers([itemId]);
  const r = m.get(itemId);
  return printNumberOf(r?.workOrder ?? null, r?.registrationOrder ?? null);
}

export type WorkOrderRow = {
  id: string;
  registrationOrder: number | null;
  workOrder: number | null;
  itemKey: string;
  itemName: string;
  subject: string; // 牌位名／認購人
  household: string;
  yangshang: string;
  status: string; // 報名狀態
  printCount: number;
  printedAt: string | null;
};

/** 管理頁列表：某年度、某項目的所有未刪除報名（含取消，取消於歷史區、不占新號）。 */
export async function listWorkOrderRows(year: number, itemKey: string): Promise<WorkOrderRow[]> {
  const rows = await prisma.$queryRaw<{
    id: string; ro: number | null; wo: number | null; key: string; name: string;
    displayName: string | null; customName: string | null; member: string | null;
    household: string; yang: string[] | null; yang1: string | null; status: string; printcount: number; printedat: Date | null;
  }[]>`
    SELECT rri."id", rri."registrationOrder" AS ro, rri."workOrder" AS wo,
           rit."key", rit."name", e."displayName", rri."customName", m."name" AS member,
           h."name" AS household, e."yangshangNames" AS yang, e."yangshangName" AS yang1,
           rri."status", rri."printCount" AS printcount, rri."printedAt" AS printedat
    FROM "ritual_registration_items" rri
    JOIN "registration_item_types" rit ON rit."id" = rri."registrationItemTypeId"
    JOIN "ritual_records" rr ON rr."id" = rri."ritualRecordId"
    JOIN "households" h ON h."id" = rr."householdId"
    LEFT JOIN "members" m ON m."id" = rri."memberId"
    LEFT JOIN "universal_salvation_entries" e ON e."id" = rri."universalSalvationEntryId"
    WHERE rr."activityType" = 'UNIVERSAL_SALVATION' AND rr."year" = ${year} AND rr."deletedAt" IS NULL
      AND rri."deletedAt" IS NULL AND rit."key" = ${itemKey}
    ORDER BY (rri."workOrder" IS NULL), rri."workOrder", rri."registrationOrder", rri."createdAt"`;
  return rows.map((r) => ({
    id: r.id,
    registrationOrder: r.ro,
    workOrder: r.wo,
    itemKey: r.key,
    itemName: r.name,
    // V33.1：完整顯示名稱經共用 resolver（type 依 registration item key 欄位，不猜名稱）。
    subject: resolveRitualDisplayName(categoryFromItemKey(r.key) ?? "", r.displayName ?? "") || r.customName || r.member || "",
    household: r.household,
    yangshang: (r.yang && r.yang.length > 0 ? r.yang : r.yang1 ? [r.yang1] : []).join("、"),
    status: r.status,
    printCount: r.printcount ?? 0,
    printedAt: r.printedat ? r.printedat.toISOString() : null,
  }));
}

/**
 * V38：正式作業編號改「照列印批次」合併——
 *   祖先組（黃紙）＝歷代祖先＋乙位正魂＋本宅地基主；冤親組（粉紅）＝累世冤親債主＋無緣子女。
 * UNBORN_CHILD 依主文分流（含「地基主」→祖先組；其餘無緣子女→冤親組），與列印 batchOf 一致。
 * 回傳時把整批的 itemKey 設為 batchKey → 管理頁把整批當「同一條 1..N」自動帶號／重編（每項目在
 * 資料庫仍各自存 workOrder，但整批號碼全域唯一，儲存的同項目唯一性檢查照樣通過）。
 * 排序：workOrder 有值優先，其餘照建立先後（＝Excel 匯入在前、ERP 新增往後）。
 */
export type WorkOrderBatchKey = "ancestor-soul" | "creditor";
const BATCH_ITEM_KEYS: Record<WorkOrderBatchKey, string[]> = {
  "ancestor-soul": ["US_ANCESTOR", "US_ZHENGHUN", "US_WUYUAN"],
  creditor: ["US_YUANQIN", "US_WUYUAN"],
};

export async function listWorkOrderRowsForBatch(year: number, batchKey: WorkOrderBatchKey): Promise<WorkOrderRow[]> {
  const keys = BATCH_ITEM_KEYS[batchKey];
  const rows = await prisma.$queryRaw<{
    id: string; ro: number | null; wo: number | null; key: string; name: string;
    displayName: string | null; printMainText: string | null; customName: string | null; member: string | null;
    household: string; yang: string[] | null; yang1: string | null; status: string; printcount: number; printedat: Date | null;
    createdat: Date;
  }[]>`
    SELECT rri."id", rri."registrationOrder" AS ro, rri."workOrder" AS wo,
           rit."key", rit."name", e."displayName", e."printMainText", rri."customName", m."name" AS member,
           h."name" AS household, e."yangshangNames" AS yang, e."yangshangName" AS yang1,
           rri."status", rri."printCount" AS printcount, rri."printedAt" AS printedat, rri."createdAt" AS createdat
    FROM "ritual_registration_items" rri
    JOIN "registration_item_types" rit ON rit."id" = rri."registrationItemTypeId"
    JOIN "ritual_records" rr ON rr."id" = rri."ritualRecordId"
    JOIN "households" h ON h."id" = rr."householdId"
    LEFT JOIN "members" m ON m."id" = rri."memberId"
    LEFT JOIN "universal_salvation_entries" e ON e."id" = rri."universalSalvationEntryId"
    WHERE rr."activityType" = 'UNIVERSAL_SALVATION' AND rr."year" = ${year} AND rr."deletedAt" IS NULL
      AND h."deletedAt" IS NULL
      AND rri."deletedAt" IS NULL AND rit."key" = ANY(${keys})
    ORDER BY (rri."workOrder" IS NULL), rri."workOrder", rri."createdAt"`;

  // UNBORN_CHILD（US_WUYUAN）依主文分流：含「地基主」→祖先組；其餘→冤親組。
  const inBatch = (r: { key: string; printMainText: string | null; displayName: string | null }): boolean => {
    if (r.key !== "US_WUYUAN") return true; // 其餘 key 已由 SQL 限定屬於本批
    const main = `${r.printMainText ?? ""}${r.displayName ?? ""}`;
    const isEarthGod = main.includes("地基主");
    return batchKey === "ancestor-soul" ? isEarthGod : !isEarthGod;
  };

  return rows.filter(inBatch).map((r) => ({
    id: r.id,
    registrationOrder: r.ro,
    workOrder: r.wo,
    // 整批視為同一條序列：itemKey 設為 batchKey（供管理頁把整批一起編 1..N）。
    itemKey: batchKey,
    itemName: r.name,
    subject: resolveRitualDisplayName(categoryFromItemKey(r.key) ?? "", r.displayName ?? "") || r.customName || r.member || "",
    household: r.household,
    yangshang: (r.yang && r.yang.length > 0 ? r.yang : r.yang1 ? [r.yang1] : []).join("、"),
    status: r.status,
    printCount: r.printcount ?? 0,
    printedAt: r.printedat ? r.printedat.toISOString() : null,
  }));
}

/** 依 registrationOrder 產生初始號碼（同項目 1..N；已有 workOrder 不覆蓋）。回傳需寫入 {id, workOrder}。 */
export async function proposeInitialFromRegistrationOrder(year: number, itemKey: string): Promise<{ id: string; workOrder: number }[]> {
  const rows = await listWorkOrderRows(year, itemKey);
  const active = rows.filter((r) => r.status !== "CANCELLED");
  const maxExisting = active.reduce((mx, r) => (r.workOrder != null ? Math.max(mx, r.workOrder) : mx), 0);
  let n = maxExisting;
  const out: { id: string; workOrder: number }[] = [];
  for (const r of active.sort((a, b) => (a.registrationOrder ?? 1e9) - (b.registrationOrder ?? 1e9))) {
    if (r.workOrder != null) continue;
    out.push({ id: r.id, workOrder: ++n });
  }
  return out;
}

export type SaveResult = { ok: true; saved: number } | { ok: false; status: number; error: string };

/**
 * 批次儲存 workOrder（transaction）：同活動同項目不得重號；衝突整批 rollback。
 * updates：只含要變更的 {id, workOrder|null}。以 raw SQL 逐筆 UPDATE。
 */
export async function saveWorkOrders(updates: { id: string; workOrder: number | null }[]): Promise<SaveResult> {
  if (updates.length === 0) return { ok: true, saved: 0 };
  const ids = updates.map((u) => u.id);
  // 取這批 item 的 (templeEventId, registrationItemTypeId) 與現況，計算「儲存後」各範圍是否重號。
  const ctx = await prisma.$queryRaw<{ id: string; ev: string | null; type: string; wo: number | null }[]>`
    SELECT "id", "templeEventId" AS ev, "registrationItemTypeId" AS type, "workOrder" AS wo
    FROM "ritual_registration_items" WHERE "id" = ANY(${ids})`;
  const ctxById = new Map(ctx.map((c) => [c.id, c]));
  const updById = new Map(updates.map((u) => [u.id, u.workOrder]));
  // 檢查重號：對每個受影響 (ev,type)，撈全部 item 的最終 workOrder（既有 + 本批覆寫）。
  const scopes = new Map<string, { ev: string | null; type: string }>();
  for (const c of ctx) scopes.set(`${c.ev}::${c.type}`, { ev: c.ev, type: c.type });
  for (const { ev, type } of scopes.values()) {
    const all = await prisma.$queryRaw<{ id: string; wo: number | null }[]>`
      SELECT rri."id", rri."workOrder" AS wo FROM "ritual_registration_items" rri
      JOIN "ritual_records" rr ON rr."id" = rri."ritualRecordId"
      WHERE rri."deletedAt" IS NULL AND rri."status" <> 'CANCELLED'
        AND rri."registrationItemTypeId" = ${type}
        AND ${ev === null ? Prisma.sql`rr."templeEventId" IS NULL` : Prisma.sql`rr."templeEventId" = ${ev}`}`;
    const seen = new Set<number>();
    for (const a of all) {
      const finalWo = updById.has(a.id) ? updById.get(a.id)! : a.wo;
      if (finalWo == null) continue;
      if (finalWo < 1) return { ok: false, status: 400, error: "作業號碼必須 ≥ 1" };
      if (seen.has(finalWo)) return { ok: false, status: 409, error: `同項目作業號碼重複：No.${finalWo}（同活動同項目不得重號）` };
      seen.add(finalWo);
    }
  }
  const saved = await prisma.$transaction(async (tx) => {
    let n = 0;
    for (const u of updates) {
      if (!ctxById.has(u.id)) continue;
      // V32 §5：workOrder 變更亦更新 updatedAt，讓「已列印後改號」能被 needsReprint 偵測。
      await tx.$executeRaw`UPDATE "ritual_registration_items" SET "workOrder" = ${u.workOrder}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${u.id}`;
      n += 1;
    }
    return n;
  });
  return { ok: true, saved };
}

/** 讀鎖定狀態（容錯：workorder_locks 表尚未部署時視為未鎖定，不拋錯）。 */
export async function isWorkOrderLocked(templeEventId: string, registrationItemTypeId: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ locked: boolean }[]>`
      SELECT "locked" FROM "workorder_locks"
      WHERE "templeEventId" = ${templeEventId} AND "registrationItemTypeId" = ${registrationItemTypeId}`;
    return rows[0]?.locked ?? false;
  } catch {
    return false; // 表尚未部署 → 未鎖定
  }
}

/** 設定鎖定／解除（upsert；表未部署則回明確訊息，不影響其他功能）。 */
export async function setWorkOrderLock(templeEventId: string, registrationItemTypeId: string, locked: boolean, byName: string | null): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.$executeRaw`
      INSERT INTO "workorder_locks" ("templeEventId", "registrationItemTypeId", "locked", "lockedByName", "lockedAt")
      VALUES (${templeEventId}, ${registrationItemTypeId}, ${locked}, ${byName}, CURRENT_TIMESTAMP)
      ON CONFLICT ("templeEventId", "registrationItemTypeId")
      DO UPDATE SET "locked" = ${locked}, "lockedByName" = ${byName}, "lockedAt" = CURRENT_TIMESTAMP`;
    return { ok: true };
  } catch {
    return { ok: false, error: "鎖定資料表尚未部署（需部署 20260822 migration）；本次未持久化鎖定。" };
  }
}

/** 取某年度中元普渡的 templeEventId（供鎖定範圍）。 */
export async function templeEventIdForYear(year: number): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "temple_events" WHERE "activityType" = 'UNIVERSAL_SALVATION' AND "year" = ${year} LIMIT 1`;
  return rows[0]?.id ?? null;
}

/** 取某項目 key 的 registrationItemTypeId。 */
export async function itemTypeIdForKey(key: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT "id" FROM "registration_item_types" WHERE "key" = ${key} LIMIT 1`;
  return rows[0]?.id ?? null;
}
