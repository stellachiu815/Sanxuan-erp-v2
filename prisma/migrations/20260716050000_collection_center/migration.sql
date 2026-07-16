-- V11.0「全宮共用收款中心」
-- 只做加法變更：不修改、不刪除 OfferingClaim／OfferingPayment 任何欄位或資料，
-- 新增 PaymentTransaction／PaymentAllocation／ManualReceivable／
-- PaymentAdjustment／AgentReconciliationRecord 等模型，詳細設計原則見
-- schema.prisma 本段落上方的長註解。

-- ============================================================
-- 第一步：新增 Enum
-- ============================================================

-- CreateEnum
CREATE TYPE "ReceivableSourceType" AS ENUM (
  'OFFERING_CLAIM',
  'MANUAL',
  'UNIVERSAL_SALVATION_SPONSOR',
  'PURIFICATION_ENTRY',
  'PEACE_LANTERN',
  'TAISUI_LANTERN',
  'TREASURY_REPAYMENT',
  'TEMPLE_CELEBRATION_OTHER',
  'DEITY_BIRTHDAY',
  'OIL_INCENSE_DONATION',
  'MERIT_DONATION',
  'DHARMA_ASSEMBLY',
  'SUTRA_CHANTING',
  'OTHER_TEMPLE_ACTIVITY'
);

-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('CASH', 'BANK_TRANSFER', 'MOBILE_PAYMENT', 'CHECK', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "AgentRemittanceStatus" AS ENUM ('PENDING', 'PARTIALLY_REMITTED', 'REMITTED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "PaymentAdjustmentType" AS ENUM ('REFUND', 'TRANSFER_TO_OTHER', 'RETAIN_AS_OVERPAYMENT', 'VOID_INCOMPLETE');

-- CreateEnum
CREATE TYPE "ReceivableReceiptLinkStatus" AS ENUM ('NOT_LINKED', 'LINKED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ManualReceivableStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'WAIVED', 'CANCELLED');

-- ============================================================
-- 第二步：新增資料表
-- ============================================================

-- CreateTable
CREATE TABLE "manual_receivables" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "payerMemberId" TEXT,
    "payerHouseholdId" TEXT,
    "payerNameSnapshot" TEXT NOT NULL,
    "payerPhoneSnapshot" TEXT,
    "amountDue" DECIMAL(12,2) NOT NULL,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountUnpaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "ManualReceivableStatus" NOT NULL DEFAULT 'UNPAID',
    "note" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByName" TEXT,

    CONSTRAINT "manual_receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" TEXT NOT NULL,
    "transactionNo" TEXT NOT NULL,
    "paidOn" DATE NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "methodType" "PaymentMethodType" NOT NULL,
    "methodNote" TEXT,
    "bankName" TEXT,
    "bankAccountLast5" TEXT,
    "checkNumber" TEXT,
    "payerMemberId" TEXT,
    "payerHouseholdId" TEXT,
    "payerNameSnapshot" TEXT NOT NULL,
    "payerPhoneSnapshot" TEXT,
    "collectedByName" TEXT,
    "isAgentCollected" BOOLEAN NOT NULL DEFAULT false,
    "agentName" TEXT,
    "agentRemittanceStatus" "AgentRemittanceStatus",
    "agentReconciliationRecordId" TEXT,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "voidedAt" TIMESTAMP(3),
    "voidedByName" TEXT,
    "voidReason" TEXT,
    "note" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    "sourceType" "ReceivableSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceOfferingPaymentId" TEXT,
    "manualReceivableId" TEXT,
    "sourceLabel" TEXT NOT NULL,
    "sourceYear" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "receiptStatus" "ReceivableReceiptLinkStatus" NOT NULL DEFAULT 'NOT_LINKED',
    "receiptNumber" TEXT,
    "financeSourceKey" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_adjustments" (
    "id" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    "sourceAllocationId" TEXT,
    "adjustmentType" "PaymentAdjustmentType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "targetSourceType" "ReceivableSourceType",
    "targetSourceId" TEXT,
    "targetOfferingPaymentId" TEXT,
    "operatorName" TEXT,
    "approvedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_reconciliation_records" (
    "id" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "expectedAmount" DECIMAL(12,2) NOT NULL,
    "actualAmount" DECIMAL(12,2) NOT NULL,
    "differenceAmount" DECIMAL(12,2) NOT NULL,
    "differenceReason" TEXT,
    "reconciledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconciledByName" TEXT,
    "note" TEXT,

    CONSTRAINT "agent_reconciliation_records_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- 第三步：Unique / Index
-- ============================================================

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_transactionNo_key" ON "payment_transactions"("transactionNo");
CREATE INDEX "manual_receivables_status_idx" ON "manual_receivables"("status");
CREATE INDEX "manual_receivables_year_idx" ON "manual_receivables"("year");
CREATE INDEX "manual_receivables_deletedAt_idx" ON "manual_receivables"("deletedAt");

CREATE INDEX "payment_transactions_paidOn_idx" ON "payment_transactions"("paidOn");
CREATE INDEX "payment_transactions_isAgentCollected_idx" ON "payment_transactions"("isAgentCollected");
CREATE INDEX "payment_transactions_agentRemittanceStatus_idx" ON "payment_transactions"("agentRemittanceStatus");
CREATE INDEX "payment_transactions_agentReconciliationRecordId_idx" ON "payment_transactions"("agentReconciliationRecordId");
CREATE INDEX "payment_transactions_status_idx" ON "payment_transactions"("status");

CREATE UNIQUE INDEX "payment_allocations_financeSourceKey_key" ON "payment_allocations"("financeSourceKey");
CREATE INDEX "payment_allocations_paymentTransactionId_idx" ON "payment_allocations"("paymentTransactionId");
CREATE INDEX "payment_allocations_sourceType_sourceId_idx" ON "payment_allocations"("sourceType", "sourceId");

CREATE INDEX "payment_adjustments_paymentTransactionId_idx" ON "payment_adjustments"("paymentTransactionId");
CREATE INDEX "payment_adjustments_adjustmentType_idx" ON "payment_adjustments"("adjustmentType");

CREATE INDEX "agent_reconciliation_records_agentName_idx" ON "agent_reconciliation_records"("agentName");
CREATE INDEX "agent_reconciliation_records_reconciledAt_idx" ON "agent_reconciliation_records"("reconciledAt");

-- ============================================================
-- 第四步：Foreign Keys
-- ============================================================

ALTER TABLE "manual_receivables" ADD CONSTRAINT "manual_receivables_payerMemberId_fkey" FOREIGN KEY ("payerMemberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "manual_receivables" ADD CONSTRAINT "manual_receivables_payerHouseholdId_fkey" FOREIGN KEY ("payerHouseholdId") REFERENCES "households"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payerMemberId_fkey" FOREIGN KEY ("payerMemberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payerHouseholdId_fkey" FOREIGN KEY ("payerHouseholdId") REFERENCES "households"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "payment_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_manualReceivableId_fkey" FOREIGN KEY ("manualReceivableId") REFERENCES "manual_receivables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_adjustments" ADD CONSTRAINT "payment_adjustments_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "payment_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_adjustments" ADD CONSTRAINT "payment_adjustments_sourceAllocationId_fkey" FOREIGN KEY ("sourceAllocationId") REFERENCES "payment_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
