-- V11.1「全宮共用收據中心」正式開發：新增收據主資料、收據明細、收據列印
-- 紀錄、收據號碼設定與流水號安全產生機制。
--
-- 這支 migration 純粹「新增」：不修改、不刪除任何既有欄位或資料表，
-- PaymentAllocation.receiptStatus/receiptNumber（V11.0 就已建立）維持原樣，
-- 只是從這一輪開始才真正有程式碼會寫入。

-- ============================================================
-- 一、擴充既有 RecordVersionAction enum（純附加列舉值）
-- ============================================================
ALTER TYPE "RecordVersionAction" ADD VALUE IF NOT EXISTS 'PRINT';
ALTER TYPE "RecordVersionAction" ADD VALUE IF NOT EXISTS 'VOID';
ALTER TYPE "RecordVersionAction" ADD VALUE IF NOT EXISTS 'REISSUE';

-- ============================================================
-- 二、新增列舉型別
-- ============================================================
CREATE TYPE "ReceiptStatus" AS ENUM ('DRAFT', 'ISSUED', 'VOIDED', 'REPLACED', 'NO_RECEIPT_REQUIRED');
CREATE TYPE "ReceiptType" AS ENUM ('MERGED', 'SPLIT_ITEM');
CREATE TYPE "ReceiptPrintKind" AS ENUM ('ORIGINAL_PRINT', 'REPRINT');
CREATE TYPE "ReceiptNumberYearMode" AS ENUM ('ROC', 'WESTERN');
CREATE TYPE "ReceiptNumberResetPolicy" AS ENUM ('YEARLY', 'CONTINUOUS');

-- ============================================================
-- 三、收據號碼設定（全系統僅一列，id 固定 'SINGLETON'）
-- ============================================================
CREATE TABLE "receipt_numbering_configs" (
    "id" TEXT NOT NULL DEFAULT 'SINGLETON',
    "prefix" TEXT NOT NULL DEFAULT 'R',
    "yearMode" "ReceiptNumberYearMode" NOT NULL DEFAULT 'WESTERN',
    "digits" INTEGER NOT NULL DEFAULT 6,
    "resetPolicy" "ReceiptNumberResetPolicy" NOT NULL DEFAULT 'YEARLY',
    "startNumber" INTEGER NOT NULL DEFAULT 1,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_numbering_configs_pkey" PRIMARY KEY ("id")
);

-- 預先塞入唯一一列預設設定，避免第一次開立收據時還要判斷「表是空的」這種
-- 額外分支（src/lib/receipt.ts 的 getReceiptNumberingConfig() 一律假設
-- 這一列一定存在）。
INSERT INTO "receipt_numbering_configs" ("id", "prefix", "yearMode", "digits", "resetPolicy", "startNumber", "updatedAt")
VALUES ('SINGLETON', 'R', 'WESTERN', 6, 'YEARLY', 1, CURRENT_TIMESTAMP);

-- ============================================================
-- 四、收據流水號安全產生機制（比照 payment_sequence_counters 既有慣例）
-- ============================================================
CREATE TABLE "receipt_sequence_counters" (
    "yearKey" TEXT NOT NULL,
    "currentValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "receipt_sequence_counters_pkey" PRIMARY KEY ("yearKey")
);

-- ============================================================
-- 五、收據主資料
-- ============================================================
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT,
    "idempotencyKey" TEXT,
    "receiptDate" DATE NOT NULL,
    "receiptTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payerName" TEXT NOT NULL,
    "householdId" TEXT,
    "memberId" TEXT,
    "paymentTransactionId" TEXT NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "receiptType" "ReceiptType" NOT NULL DEFAULT 'MERGED',
    "status" "ReceiptStatus" NOT NULL DEFAULT 'ISSUED',
    "printCount" INTEGER NOT NULL DEFAULT 0,
    "originalReceiptId" TEXT,
    "voidReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedByName" TEXT,
    "approvedByName" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "receipts_receiptNumber_key" ON "receipts"("receiptNumber");
CREATE UNIQUE INDEX "receipts_idempotencyKey_key" ON "receipts"("idempotencyKey");
CREATE INDEX "receipts_paymentTransactionId_idx" ON "receipts"("paymentTransactionId");
CREATE INDEX "receipts_status_idx" ON "receipts"("status");
CREATE INDEX "receipts_receiptDate_idx" ON "receipts"("receiptDate");
CREATE INDEX "receipts_householdId_idx" ON "receipts"("householdId");
CREATE INDEX "receipts_memberId_idx" ON "receipts"("memberId");
CREATE INDEX "receipts_originalReceiptId_idx" ON "receipts"("originalReceiptId");

ALTER TABLE "receipts" ADD CONSTRAINT "receipts_householdId_fkey"
    FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_paymentTransactionId_fkey"
    FOREIGN KEY ("paymentTransactionId") REFERENCES "payment_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_originalReceiptId_fkey"
    FOREIGN KEY ("originalReceiptId") REFERENCES "receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 六、收據明細
-- ============================================================
CREATE TABLE "receipt_lines" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "paymentAllocationId" TEXT NOT NULL,
    "sourceType" "ReceivableSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "activityId" TEXT,
    "itemName" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "receipt_lines_receiptId_idx" ON "receipt_lines"("receiptId");
CREATE INDEX "receipt_lines_paymentAllocationId_idx" ON "receipt_lines"("paymentAllocationId");

ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_paymentAllocationId_fkey"
    FOREIGN KEY ("paymentAllocationId") REFERENCES "payment_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- 七、收據列印紀錄
-- ============================================================
CREATE TABLE "receipt_print_logs" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "kind" "ReceiptPrintKind" NOT NULL,
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedByName" TEXT,
    "reason" TEXT,
    "deviceInfo" TEXT,
    "note" TEXT,

    CONSTRAINT "receipt_print_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "receipt_print_logs_receiptId_idx" ON "receipt_print_logs"("receiptId");
CREATE INDEX "receipt_print_logs_printedAt_idx" ON "receipt_print_logs"("printedAt");

ALTER TABLE "receipt_print_logs" ADD CONSTRAINT "receipt_print_logs_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
