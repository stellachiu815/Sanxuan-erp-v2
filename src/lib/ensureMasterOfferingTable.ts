import { prisma } from "@/lib/prisma";

/**
 * V38 供師活動「一鍵建立資料表」（純新增、可重複執行、不動既有資料）。
 *
 * 供師是普渡底下一份**獨立、不進財務流程**的名單：只記 姓名／金額（自填）／繳費（勾選）。
 * 不開收據、不進收款中心、不算應收。與 public_reg 同做法：沙盒不跑遷移，改由系統管理頁
 * 一顆按鈕以 CREATE TABLE IF NOT EXISTS 建表；冪等、只新增不 DROP、對現有資料零風險。
 */

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "master_offerings" (
     "id" TEXT NOT NULL,
     "templeEventId" TEXT NOT NULL,
     "year" INTEGER NOT NULL,
     "householdId" VARCHAR(10),
     "memberId" TEXT,
     "name" TEXT NOT NULL,
     "amount" INTEGER NOT NULL DEFAULT 0,
     "paid" BOOLEAN NOT NULL DEFAULT false,
     "paidAt" TIMESTAMP(3),
     "note" TEXT,
     "createdByName" TEXT,
     "deletedAt" TIMESTAMP(3),
     "deletedByName" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "master_offerings_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "master_offerings_year_idx" ON "master_offerings"("year")`,
  `CREATE INDEX IF NOT EXISTS "master_offerings_templeEventId_idx" ON "master_offerings"("templeEventId")`,
  `CREATE INDEX IF NOT EXISTS "master_offerings_householdId_idx" ON "master_offerings"("householdId")`,
];

export type EnsureMasterOfferingReport = { ok: boolean; created: boolean; error?: string };

async function tableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS "exists"`, name
  );
  return !!rows?.[0]?.exists;
}

export async function ensureMasterOfferingTable(): Promise<EnsureMasterOfferingReport> {
  try {
    const before = await tableExists("master_offerings");
    for (const sql of STATEMENTS) await prisma.$executeRawUnsafe(sql);
    const after = await tableExists("master_offerings");
    return { ok: after, created: !before && after };
  } catch (e) {
    return { ok: false, created: false, error: e instanceof Error ? e.message : "建立供師資料表時發生錯誤" };
  }
}
