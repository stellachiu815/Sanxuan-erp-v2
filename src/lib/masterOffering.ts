import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * V38 供師活動資料層（**不進財務流程**）。
 *
 * 只記 姓名／金額（自填）／繳費（勾選 boolean）。沙盒不跑遷移，一律 raw SQL（同 publicReg）。
 * 表 master_offerings 由 ensureMasterOfferingTable 建立。金額純記錄、繳費純手動勾選；
 * 不開收據、不進收款中心、不算應收，也不影響任何既有帳務。
 */

export type MasterOfferingRow = {
  id: string;
  year: number;
  name: string;
  amount: number;
  paid: boolean;
  householdId: string | null;
  memberId: string | null;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
};

async function tableReady(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'master_offerings') AS "exists"`
  );
  return !!rows?.[0]?.exists;
}

/** 找某年度的普渡活動 id（供師掛在普渡底下）。 */
export async function resolveUniversalSalvationEventId(year: number): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "temple_events" WHERE "activityType" = 'UNIVERSAL_SALVATION' AND "year" = ${year} ORDER BY "createdAt" ASC LIMIT 1`;
  return rows[0]?.id ?? null;
}

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** 新增一筆供師（姓名＋金額；繳費預設未繳）。 */
export async function addMasterOffering(input: {
  year: number;
  name: string;
  amount: number;
  householdId?: string | null;
  memberId?: string | null;
  paid?: boolean;
  note?: string | null;
  operatorName?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  if (!(await tableReady())) return { ok: false, status: 409, error: "供師資料表尚未建立，請先到系統管理頁按「建立供師資料表」。" };
  const name = s(input.name);
  if (!name) return { ok: false, status: 400, error: "請填寫供師姓名" };
  const amount = Math.max(0, Math.round(Number(input.amount) || 0));
  const eventId = await resolveUniversalSalvationEventId(input.year);
  if (!eventId) return { ok: false, status: 400, error: `找不到 ${input.year} 年的普渡活動` };

  const id = `mof_${randomUUID()}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "master_offerings" ("id","templeEventId","year","householdId","memberId","name","amount","paid","note","createdByName","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    id, eventId, input.year, input.householdId ?? null, input.memberId ?? null, name, amount, input.paid ?? false, s(input.note), input.operatorName ?? null
  );
  return { ok: true, id };
}

/** 某年度供師名單（未刪除；照建立先後）。 */
export async function listMasterOfferings(year: number): Promise<{ ready: boolean; rows: MasterOfferingRow[]; totalAmount: number; paidCount: number }> {
  if (!(await tableReady())) return { ready: false, rows: [], totalAmount: 0, paidCount: 0 };
  const rows = await prisma.$queryRaw<{ id: string; year: number; name: string; amount: number; paid: boolean; householdId: string | null; memberId: string | null; note: string | null; createdByName: string | null; createdAt: Date }[]>`
    SELECT "id","year","name","amount","paid","householdId","memberId","note","createdByName","createdAt"
    FROM "master_offerings" WHERE "year" = ${year} AND "deletedAt" IS NULL ORDER BY "createdAt" ASC`;
  const mapped = rows.map((r) => ({
    id: r.id, year: r.year, name: r.name, amount: Number(r.amount), paid: !!r.paid,
    householdId: r.householdId, memberId: r.memberId, note: r.note, createdByName: r.createdByName,
    createdAt: r.createdAt.toISOString(),
  }));
  return {
    ready: true,
    rows: mapped,
    totalAmount: mapped.reduce((sum, r) => sum + r.amount, 0),
    paidCount: mapped.filter((r) => r.paid).length,
  };
}

/** 勾選／取消繳費（純手動狀態，不動財務）。 */
export async function setMasterOfferingPaid(id: string, paid: boolean): Promise<{ ok: boolean }> {
  await prisma.$executeRawUnsafe(
    `UPDATE "master_offerings" SET "paid"=$1, "paidAt"=${paid ? "CURRENT_TIMESTAMP" : "NULL"}, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2 AND "deletedAt" IS NULL`,
    paid, id
  );
  return { ok: true };
}

/** 修改姓名／金額。 */
export async function updateMasterOffering(id: string, patch: { name?: string; amount?: number }): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = s(patch.name);
  const sets: string[] = [];
  const args: unknown[] = [];
  if (name) { args.push(name); sets.push(`"name"=$${args.length}`); }
  if (patch.amount !== undefined) { args.push(Math.max(0, Math.round(Number(patch.amount) || 0))); sets.push(`"amount"=$${args.length}`); }
  if (!sets.length) return { ok: false, error: "沒有要修改的內容" };
  args.push(id);
  await prisma.$executeRawUnsafe(
    `UPDATE "master_offerings" SET ${sets.join(", ")}, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$${args.length} AND "deletedAt" IS NULL`,
    ...args
  );
  return { ok: true };
}

/** 軟刪除一筆供師（可保留紀錄）。 */
export async function deleteMasterOffering(id: string, operatorName: string | null): Promise<{ ok: boolean }> {
  await prisma.$executeRawUnsafe(
    `UPDATE "master_offerings" SET "deletedAt"=CURRENT_TIMESTAMP, "deletedByName"=$1, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2 AND "deletedAt" IS NULL`,
    operatorName, id
  );
  return { ok: true };
}
