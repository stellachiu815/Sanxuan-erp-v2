-- V8.0「資料版本紀錄與刪除保護」：備份/還原/版本管理系統的第一個子模組。
-- 純粹附加，不修改任何既有欄位的型別或既有資料。

-- AlterTable：households 新增軟刪除欄位
ALTER TABLE "households" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "households" ADD COLUMN "deletedByName" TEXT;

-- AlterTable：members 新增軟刪除欄位
ALTER TABLE "members" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "members" ADD COLUMN "deletedByName" TEXT;

-- AlterTable：ritual_records 新增軟刪除欄位
ALTER TABLE "ritual_records" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "ritual_records" ADD COLUMN "deletedByName" TEXT;

-- AlterTable：universal_salvation_entries 新增軟刪除欄位
ALTER TABLE "universal_salvation_entries" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "universal_salvation_entries" ADD COLUMN "deletedByName" TEXT;

-- CreateIndex（供回收區查詢使用）
CREATE INDEX "households_deletedAt_idx" ON "households"("deletedAt");
CREATE INDEX "members_deletedAt_idx" ON "members"("deletedAt");
CREATE INDEX "ritual_records_deletedAt_idx" ON "ritual_records"("deletedAt");
CREATE INDEX "universal_salvation_entries_deletedAt_idx" ON "universal_salvation_entries"("deletedAt");

-- CreateEnum
CREATE TYPE "RecordVersionAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'PURGE');

-- CreateTable
CREATE TABLE "record_versions" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "RecordVersionAction" NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "operatorName" TEXT,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "record_versions_entityType_entityId_idx" ON "record_versions"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "record_versions_entityType_entityId_createdAt_idx" ON "record_versions"("entityType", "entityId", "createdAt");
