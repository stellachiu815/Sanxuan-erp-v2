-- V37 信眾自動報名：兩張全新表 + 一個 enum。純新增，不改動任何既有表/資料。
DO $$ BEGIN
  CREATE TYPE "PublicRegStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "public_reg_forms" (
  "id" TEXT NOT NULL,
  "templeEventId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "fieldsConfig" JSONB NOT NULL DEFAULT '[]',
  "isOpen" BOOLEAN NOT NULL DEFAULT true,
  "headerNote" TEXT,
  "createdByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "public_reg_forms_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "public_reg_forms_slug_key" ON "public_reg_forms"("slug");
CREATE INDEX IF NOT EXISTS "public_reg_forms_templeEventId_idx" ON "public_reg_forms"("templeEventId");

CREATE TABLE IF NOT EXISTS "public_registrations" (
  "id" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "status" "PublicRegStatus" NOT NULL DEFAULT 'PENDING',
  "payload" JSONB NOT NULL,
  "submitterHash" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "confirmedByName" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "public_registrations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "public_registrations_formId_idx" ON "public_registrations"("formId");
CREATE INDEX IF NOT EXISTS "public_registrations_status_idx" ON "public_registrations"("status");

DO $$ BEGIN
  ALTER TABLE "public_registrations"
    ADD CONSTRAINT "public_registrations_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "public_reg_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
