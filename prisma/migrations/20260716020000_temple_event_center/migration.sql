-- V8.1「宮務活動中心」（交付版本 V10.0）：所有宮務活動（普渡、祭改、光明燈、
-- 太歲燈、全家燈、補庫、宮慶、其他）統一使用同一套 TempleEvent + RitualRecord
-- 架構建立，不再各自重新開發一套資料表。
--
-- 本次遷移把 V9.0「祭改管理」原本獨立的 purification_years /
-- purification_registrations / purification_print_batches 三張表，整個搬進
-- 通用架構：purification_years 的角色由新的 temple_events 取代（一般化成所有
-- 活動類型都可用）；purification_registrations 改名為 purification_entries，
-- 掛在既有的 ritual_records 底下（而不是自己存 householdId）；
-- purification_print_batches 改名為通用的 temple_event_print_batches。
--
-- purification_banned_numbers（全域禁用號碼）與 PurificationPaymentStatus
-- 枚舉維持不變，繼續沿用，不需要重建。

-- ============================================================
-- 第一步：移除 V9.0 舊架構（祭改專用、即將被通用架構取代的三張表）
-- ============================================================

-- DropTable
DROP TABLE "purification_registrations";

-- DropTable
DROP TABLE "purification_print_batches";

-- DropTable
DROP TABLE "purification_years";

-- DropEnum
DROP TYPE "PurificationRegistrationStatus";

-- ============================================================
-- 第二步：擴充 ActivityType，讓所有宮務活動類型都能共用同一套架構
-- ============================================================

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'PURIFICATION';
ALTER TYPE "ActivityType" ADD VALUE 'GUANGMING_LANTERN';
ALTER TYPE "ActivityType" ADD VALUE 'TAISUI_LANTERN';
ALTER TYPE "ActivityType" ADD VALUE 'FAMILY_LANTERN';
ALTER TYPE "ActivityType" ADD VALUE 'STORAGE_REPAYMENT';
ALTER TYPE "ActivityType" ADD VALUE 'OTHER';

-- ============================================================
-- 第三步：新增通用「宮務活動中心」與「模板中心」資料模型
-- ============================================================

-- CreateEnum
CREATE TYPE "TempleEventStatus" AS ENUM ('PREPARING', 'ONGOING', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurificationEntryStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'SUPPLEMENTARY');

-- CreateEnum
CREATE TYPE "TemplateCategory" AS ENUM ('PRINT', 'EXCEL', 'CSV', 'WORD', 'PDF');

-- CreateTable
CREATE TABLE "temple_events" (
    "id" TEXT NOT NULL,
    "activityType" "ActivityType" NOT NULL,
    "year" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "lunarDateYear" INTEGER,
    "lunarDateMonth" INTEGER,
    "lunarDateDay" INTEGER,
    "lunarDateIsLeap" BOOLEAN NOT NULL DEFAULT false,
    "solarDate" DATE,
    "status" "TempleEventStatus" NOT NULL DEFAULT 'PREPARING',
    "note" TEXT,
    "numberingLocked" BOOLEAN NOT NULL DEFAULT false,
    "copiedFromEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "temple_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temple_event_banned_numbers" (
    "id" TEXT NOT NULL,
    "templeEventId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "temple_event_banned_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temple_event_print_batches" (
    "id" TEXT NOT NULL,
    "templeEventId" TEXT NOT NULL,
    "registrationCount" INTEGER NOT NULL,
    "printedByName" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "temple_event_print_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temple_event_checklist_items" (
    "id" TEXT NOT NULL,
    "templeEventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "completedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "temple_event_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temple_event_expenses" (
    "id" TEXT NOT NULL,
    "templeEventId" TEXT NOT NULL,
    "category" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "occurredOn" DATE NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "temple_event_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purification_entries" (
    "id" TEXT NOT NULL,
    "ritualRecordId" TEXT NOT NULL,
    "templeEventId" TEXT NOT NULL,
    "number" INTEGER,
    "memberId" TEXT,
    "isTemporaryName" BOOLEAN NOT NULL DEFAULT false,
    "manualDisplayName" TEXT,
    "manualGender" TEXT,
    "manualSolarBirthDate" DATE,
    "manualLunarBirthYear" INTEGER,
    "manualLunarBirthMonth" INTEGER,
    "manualLunarBirthDay" INTEGER,
    "manualLunarIsLeapMonth" BOOLEAN NOT NULL DEFAULT false,
    "manualAddress" TEXT,
    "manualPhone" TEXT,
    "paymentStatus" "PurificationPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "paymentAmount" DECIMAL(12,2),
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "status" "PurificationEntryStatus" NOT NULL DEFAULT 'ACTIVE',
    "isPrinted" BOOLEAN NOT NULL DEFAULT false,
    "printedAt" TIMESTAMP(3),
    "printBatchId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purification_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_definitions" (
    "id" TEXT NOT NULL,
    "category" "TemplateCategory" NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "activityType" "ActivityType",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_versions" (
    "id" TEXT NOT NULL,
    "templateDefinitionId" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "fileName" TEXT,
    "fileUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "uploadedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_field_mappings" (
    "id" TEXT NOT NULL,
    "importKind" TEXT NOT NULL,
    "sourceColumnName" TEXT NOT NULL,
    "targetField" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_field_mappings_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- 第四步：既有資料表新增欄位，串接到新的 TempleEvent 架構
-- ============================================================

-- AlterTable
ALTER TABLE "ritual_records" ADD COLUMN "templeEventId" TEXT;

-- AlterTable
ALTER TABLE "import_batches" ADD COLUMN "importKind" TEXT NOT NULL DEFAULT 'HOUSEHOLD',
ADD COLUMN "templeEventId" TEXT;

-- ============================================================
-- 第五步：索引
-- ============================================================

-- CreateIndex
CREATE UNIQUE INDEX "temple_events_activityType_year_key" ON "temple_events"("activityType", "year");

-- CreateIndex
CREATE INDEX "temple_events_activityType_year_idx" ON "temple_events"("activityType", "year");

-- CreateIndex
CREATE UNIQUE INDEX "temple_event_banned_numbers_templeEventId_number_key" ON "temple_event_banned_numbers"("templeEventId", "number");

-- CreateIndex
CREATE INDEX "temple_event_banned_numbers_templeEventId_idx" ON "temple_event_banned_numbers"("templeEventId");

-- CreateIndex
CREATE INDEX "temple_event_print_batches_templeEventId_idx" ON "temple_event_print_batches"("templeEventId");

-- CreateIndex
CREATE INDEX "temple_event_checklist_items_templeEventId_idx" ON "temple_event_checklist_items"("templeEventId");

-- CreateIndex
CREATE INDEX "temple_event_expenses_templeEventId_idx" ON "temple_event_expenses"("templeEventId");

-- CreateIndex
CREATE UNIQUE INDEX "purification_entries_templeEventId_number_key" ON "purification_entries"("templeEventId", "number");

-- CreateIndex
CREATE INDEX "purification_entries_templeEventId_status_idx" ON "purification_entries"("templeEventId", "status");

-- CreateIndex
CREATE INDEX "purification_entries_ritualRecordId_idx" ON "purification_entries"("ritualRecordId");

-- CreateIndex
CREATE INDEX "purification_entries_memberId_idx" ON "purification_entries"("memberId");

-- CreateIndex
CREATE INDEX "purification_entries_deletedAt_idx" ON "purification_entries"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "template_definitions_category_key_key" ON "template_definitions"("category", "key");

-- CreateIndex
CREATE INDEX "template_definitions_category_idx" ON "template_definitions"("category");

-- CreateIndex
CREATE INDEX "template_versions_templateDefinitionId_idx" ON "template_versions"("templateDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "import_field_mappings_importKind_sourceColumnName_key" ON "import_field_mappings"("importKind", "sourceColumnName");

-- CreateIndex
CREATE INDEX "import_field_mappings_importKind_idx" ON "import_field_mappings"("importKind");

-- CreateIndex
CREATE INDEX "ritual_records_templeEventId_idx" ON "ritual_records"("templeEventId");

-- CreateIndex
CREATE INDEX "import_batches_importKind_idx" ON "import_batches"("importKind");

-- ============================================================
-- 第六步：外鍵
-- ============================================================

-- AddForeignKey
ALTER TABLE "temple_event_banned_numbers" ADD CONSTRAINT "temple_event_banned_numbers_templeEventId_fkey" FOREIGN KEY ("templeEventId") REFERENCES "temple_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temple_event_print_batches" ADD CONSTRAINT "temple_event_print_batches_templeEventId_fkey" FOREIGN KEY ("templeEventId") REFERENCES "temple_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temple_event_checklist_items" ADD CONSTRAINT "temple_event_checklist_items_templeEventId_fkey" FOREIGN KEY ("templeEventId") REFERENCES "temple_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temple_event_expenses" ADD CONSTRAINT "temple_event_expenses_templeEventId_fkey" FOREIGN KEY ("templeEventId") REFERENCES "temple_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purification_entries" ADD CONSTRAINT "purification_entries_ritualRecordId_fkey" FOREIGN KEY ("ritualRecordId") REFERENCES "ritual_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purification_entries" ADD CONSTRAINT "purification_entries_templeEventId_fkey" FOREIGN KEY ("templeEventId") REFERENCES "temple_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purification_entries" ADD CONSTRAINT "purification_entries_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purification_entries" ADD CONSTRAINT "purification_entries_printBatchId_fkey" FOREIGN KEY ("printBatchId") REFERENCES "temple_event_print_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_templateDefinitionId_fkey" FOREIGN KEY ("templateDefinitionId") REFERENCES "template_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ritual_records" ADD CONSTRAINT "ritual_records_templeEventId_fkey" FOREIGN KEY ("templeEventId") REFERENCES "temple_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
