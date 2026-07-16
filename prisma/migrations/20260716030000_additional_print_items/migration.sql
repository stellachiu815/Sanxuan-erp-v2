-- V9.1「建立附加列印項目與多寶袋管理機制」：修正普渡（歷代祖先／個人乙位
-- 正魂／冤親債主／無緣子女）過去「是否有寶袋（是/否）＋寶袋數量（單一
-- 數字）」這種簡化設計，改為每一個寶袋（或牌位/疏文/燈牌/其他列印項目）
-- 都是一筆獨立的 AdditionalPrintItem，各自可以有自己的列印名稱、數量、
-- 模板、狀態——不會被簡化成一個數字或一個布林值。

-- ============================================================
-- 第一步：temple_event_print_batches.templeEventId 改為可為空
-- ============================================================
--
-- 原因：祭改（PurificationEntry）一律會有 templeEventId，但普渡的附加
-- 列印項目（本次新增）不是每一筆都掛在活動精靈建立的 TempleEvent 底下
-- ——很多是 V10.0 之前就存在、從沒進過活動精靈的既有普渡登記資料，這種
-- 情況下 templeEventId 允許是空的，列印批次照樣可以建立。

ALTER TABLE "temple_event_print_batches" DROP CONSTRAINT "temple_event_print_batches_templeEventId_fkey";

ALTER TABLE "temple_event_print_batches" ALTER COLUMN "templeEventId" DROP NOT NULL;

ALTER TABLE "temple_event_print_batches" ADD CONSTRAINT "temple_event_print_batches_templeEventId_fkey" FOREIGN KEY ("templeEventId") REFERENCES "temple_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 第二步：新增附加列印項目資料表
-- ============================================================

-- CreateEnum
CREATE TYPE "AdditionalPrintItemType" AS ENUM ('POCKET', 'TABLET', 'PETITION', 'LANTERN_TABLET', 'OTHER');

-- CreateEnum
CREATE TYPE "AdditionalPrintItemStatus" AS ENUM ('PENDING_CONFIRMATION', 'PENDING_PRINT', 'PRINTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "additional_print_items" (
    "id" TEXT NOT NULL,
    "activityId" TEXT,
    "ritualRecordId" TEXT NOT NULL,
    "sourceEntryId" TEXT NOT NULL,
    "sourceEntryType" TEXT NOT NULL DEFAULT 'UNIVERSAL_SALVATION_ENTRY',
    "householdId" TEXT NOT NULL,
    "memberId" TEXT,
    "itemType" "AdditionalPrintItemType" NOT NULL,
    "printName" TEXT NOT NULL,
    "usesSourceName" BOOLEAN NOT NULL DEFAULT true,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "templateId" TEXT,
    "status" "AdditionalPrintItemStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "note" TEXT,
    "isExtra" BOOLEAN NOT NULL DEFAULT false,
    "isPrinted" BOOLEAN NOT NULL DEFAULT false,
    "printedQuantity" INTEGER NOT NULL DEFAULT 0,
    "printedAt" TIMESTAMP(3),
    "printedByName" TEXT,
    "reprintCount" INTEGER NOT NULL DEFAULT 0,
    "printBatchId" TEXT,
    "templateVersionId" TEXT,
    "isChargeable" BOOLEAN NOT NULL DEFAULT false,
    "unitPrice" DECIMAL(12,2),
    "subtotal" DECIMAL(12,2),
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paymentId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByName" TEXT,

    CONSTRAINT "additional_print_items_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- 第三步：索引
-- ============================================================

-- CreateIndex
CREATE INDEX "additional_print_items_ritualRecordId_idx" ON "additional_print_items"("ritualRecordId");

-- CreateIndex
CREATE INDEX "additional_print_items_sourceEntryId_idx" ON "additional_print_items"("sourceEntryId");

-- CreateIndex
CREATE INDEX "additional_print_items_householdId_idx" ON "additional_print_items"("householdId");

-- CreateIndex
CREATE INDEX "additional_print_items_activityId_idx" ON "additional_print_items"("activityId");

-- CreateIndex
CREATE INDEX "additional_print_items_status_idx" ON "additional_print_items"("status");

-- CreateIndex
CREATE INDEX "additional_print_items_printBatchId_idx" ON "additional_print_items"("printBatchId");

-- CreateIndex
CREATE INDEX "additional_print_items_deletedAt_idx" ON "additional_print_items"("deletedAt");

-- ============================================================
-- 第四步：外鍵
-- ============================================================

-- AddForeignKey
ALTER TABLE "additional_print_items" ADD CONSTRAINT "additional_print_items_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "temple_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_print_items" ADD CONSTRAINT "additional_print_items_ritualRecordId_fkey" FOREIGN KEY ("ritualRecordId") REFERENCES "ritual_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_print_items" ADD CONSTRAINT "additional_print_items_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_print_items" ADD CONSTRAINT "additional_print_items_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_print_items" ADD CONSTRAINT "additional_print_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "template_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_print_items" ADD CONSTRAINT "additional_print_items_printBatchId_fkey" FOREIGN KEY ("printBatchId") REFERENCES "temple_event_print_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_print_items" ADD CONSTRAINT "additional_print_items_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
