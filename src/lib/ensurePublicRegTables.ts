import { prisma } from "@/lib/prisma";

/**
 * V37 信眾自動報名「一鍵建立資料表」（純新增、可重複執行、不動任何既有資料）。
 *
 * 為什麼用 raw SQL：這系統部署時不會自動跑資料庫遷移，且為了不用終端機，
 * 由「系統管理」頁一顆按鈕觸發本函式，直接以 CREATE TABLE IF NOT EXISTS
 * 建立兩張全新表。全部語句都是冪等（IF NOT EXISTS／DO 例外吞掉），
 * 重複按也安全；只新增、不 DROP、不 ALTER 既有表，對現有資料零風險。
 */

const STATEMENTS: string[] = [
  `DO $$ BEGIN
     CREATE TYPE "PublicRegStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');
   EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `CREATE TABLE IF NOT EXISTS "public_reg_forms" (
     "id" TEXT NOT NULL,
     "templeEventId" TEXT NOT NULL,
     "slug" TEXT NOT NULL,
     "fieldsConfig" JSONB NOT NULL DEFAULT '[]',
     "isOpen" BOOLEAN NOT NULL DEFAULT true,
     "headerNote" TEXT,
     "createdByName" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "public_reg_forms_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "public_reg_forms_slug_key" ON "public_reg_forms"("slug")`,
  `CREATE INDEX IF NOT EXISTS "public_reg_forms_templeEventId_idx" ON "public_reg_forms"("templeEventId")`,
  `CREATE TABLE IF NOT EXISTS "public_registrations" (
     "id" TEXT NOT NULL,
     "formId" TEXT NOT NULL,
     "status" "PublicRegStatus" NOT NULL DEFAULT 'PENDING',
     "payload" JSONB NOT NULL,
     "submitterHash" TEXT,
     "confirmedAt" TIMESTAMP(3),
     "confirmedByName" TEXT,
     "note" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "public_registrations_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "public_registrations_formId_idx" ON "public_registrations"("formId")`,
  `CREATE INDEX IF NOT EXISTS "public_registrations_status_idx" ON "public_registrations"("status")`,
  `DO $$ BEGIN
     ALTER TABLE "public_registrations"
       ADD CONSTRAINT "public_registrations_formId_fkey"
       FOREIGN KEY ("formId") REFERENCES "public_reg_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN null; END $$`,
];

export type EnsurePublicRegReport = { ok: boolean; created: boolean; tables: { public_reg_forms: boolean; public_registrations: boolean }; error?: string };

async function tableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS "exists"`, name
  );
  return !!rows?.[0]?.exists;
}

export async function ensurePublicRegTables(): Promise<EnsurePublicRegReport> {
  try {
    const before = await tableExists("public_registrations");
    for (const sql of STATEMENTS) {
      await prisma.$executeRawUnsafe(sql);
    }
    const forms = await tableExists("public_reg_forms");
    const regs = await tableExists("public_registrations");
    return { ok: forms && regs, created: !before && regs, tables: { public_reg_forms: forms, public_registrations: regs } };
  } catch (e) {
    return { ok: false, created: false, tables: { public_reg_forms: false, public_registrations: false }, error: e instanceof Error ? e.message : "建立資料表時發生錯誤" };
  }
}
