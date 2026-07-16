-- V11.0.1「全宮共用收款中心」整合驗收修正輪
-- 本次新增：贊普（普渡）與祭改的正式收款分錄、收款編號安全產生機制、
-- 退款/轉款/作廢的財務來源識別碼。全部是加法變更，沒有刪除任何既有欄位
-- 或資料表，舊資料（paymentStatus/paymentAmount）全部保留。

-- ============================================================
-- 第一步：贊普（UniversalSalvationDetail）正式接上收款
-- ============================================================

ALTER TABLE "universal_salvation_details"
  ADD COLUMN "amountDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "amountUnpaid" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- 資料轉換：贊普的應收金額 = 登記當下的 sponsorAmount。目前系統完全沒有
-- 任何贊普收款紀錄（這是本輪才新增的功能），所以 amountPaid 全部從 0
-- 開始、狀態一律是「未收款」，不是假造已收款資料。
UPDATE "universal_salvation_details"
SET "amountDue" = COALESCE("sponsorAmount", 0),
    "amountUnpaid" = COALESCE("sponsorAmount", 0)
WHERE "isSponsor" = true;

CREATE TABLE "universal_salvation_payments" (
    "id" TEXT NOT NULL,
    "universalSalvationDetailId" TEXT NOT NULL,
    "kind" "OfferingPaymentKind" NOT NULL DEFAULT 'PAYMENT',
    "amount" DECIMAL(12,2) NOT NULL,
    "paidOn" DATE NOT NULL,
    "method" TEXT,
    "collectedByName" TEXT,
    "receiptNumber" TEXT,
    "reprintCount" INTEGER NOT NULL DEFAULT 0,
    "lastReprintAt" TIMESTAMP(3),
    "reason" TEXT,
    "relatedDetailId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "universal_salvation_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "universal_salvation_payments_universalSalvationDetailId_idx" ON "universal_salvation_payments"("universalSalvationDetailId");
CREATE INDEX "universal_salvation_payments_kind_idx" ON "universal_salvation_payments"("kind");

ALTER TABLE "universal_salvation_payments"
  ADD CONSTRAINT "universal_salvation_payments_universalSalvationDetailId_fkey"
  FOREIGN KEY ("universalSalvationDetailId") REFERENCES "universal_salvation_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 第二步：祭改（PurificationEntry）正式接上收款
-- ============================================================

CREATE TYPE "PurificationFeeStatus" AS ENUM ('UNSET', 'CHARGEABLE', 'WAIVED');

ALTER TABLE "purification_entries"
  ADD COLUMN "feeStatus" "PurificationFeeStatus" NOT NULL DEFAULT 'UNSET',
  ADD COLUMN "amountDue" DECIMAL(12,2),
  ADD COLUMN "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "amountUnpaid" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE "purification_payments" (
    "id" TEXT NOT NULL,
    "purificationEntryId" TEXT NOT NULL,
    "kind" "OfferingPaymentKind" NOT NULL DEFAULT 'PAYMENT',
    "amount" DECIMAL(12,2) NOT NULL,
    "paidOn" DATE NOT NULL,
    "method" TEXT,
    "collectedByName" TEXT,
    "receiptNumber" TEXT,
    "reprintCount" INTEGER NOT NULL DEFAULT 0,
    "lastReprintAt" TIMESTAMP(3),
    "reason" TEXT,
    "relatedEntryId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purification_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "purification_payments_purificationEntryId_idx" ON "purification_payments"("purificationEntryId");
CREATE INDEX "purification_payments_kind_idx" ON "purification_payments"("kind");

ALTER TABLE "purification_payments"
  ADD CONSTRAINT "purification_payments_purificationEntryId_fkey"
  FOREIGN KEY ("purificationEntryId") REFERENCES "purification_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 資料轉換（誠實處理舊資料，不假造應收金額）：
-- 1) 舊制 paymentStatus='PAID' 且 paymentAmount 有值：視為「收費且已收清」，
--    amountDue=amountPaid=paymentAmount，並補一筆歷史收款分錄，讓新舊
--    資料在收款中心裡呈現一致，不是只改彙總數字、沒有分錄佐證。
UPDATE "purification_entries"
SET "feeStatus" = 'CHARGEABLE',
    "amountDue" = "paymentAmount",
    "amountPaid" = "paymentAmount",
    "amountUnpaid" = 0
WHERE "paymentStatus" = 'PAID' AND "paymentAmount" IS NOT NULL;

INSERT INTO "purification_payments" ("id", "purificationEntryId", "kind", "amount", "paidOn", "note", "createdAt")
SELECT
  'PP_MIGRATE_' || "id",
  "id",
  'PAYMENT',
  "paymentAmount",
  "registeredAt"::date,
  '[V11.0.1 資料轉換：舊制付款金額搬移，原始 paymentStatus=PAID]',
  "createdAt"
FROM "purification_entries"
WHERE "paymentStatus" = 'PAID' AND "paymentAmount" IS NOT NULL;

-- 2) 舊制 paymentStatus='PARTIAL' 且 paymentAmount 有值：只知道「已收多少」，
--    不知道真正的應收金額（舊制從來沒有這個概念）——誠實地把 amountDue
--    留白（NULL，意即「尚待行政人員補填正確應收金額」），不假造一個等於
--    已收金額的應收金額（那樣會讓畫面誤判成「已收清」）。feeStatus 設為
--    CHARGEABLE 讓行政人員知道這筆需要補填，amountPaid 先誠實登記已收
--    金額並補一筆歷史收款分錄。
UPDATE "purification_entries"
SET "feeStatus" = 'CHARGEABLE',
    "amountPaid" = "paymentAmount"
WHERE "paymentStatus" = 'PARTIAL' AND "paymentAmount" IS NOT NULL;

INSERT INTO "purification_payments" ("id", "purificationEntryId", "kind", "amount", "paidOn", "note", "createdAt")
SELECT
  'PP_MIGRATE_' || "id",
  "id",
  'PAYMENT',
  "paymentAmount",
  "registeredAt"::date,
  '[V11.0.1 資料轉換：舊制付款金額搬移，原始 paymentStatus=PARTIAL，應收金額尚待行政人員補填]',
  "createdAt"
FROM "purification_entries"
WHERE "paymentStatus" = 'PARTIAL' AND "paymentAmount" IS NOT NULL;

-- 3) paymentStatus='UNPAID' 的資料：不論 paymentAmount 是否有值，一律
--    維持 feeStatus='UNSET'（尚未設定），不自動當成免收或零元已付款。

-- ============================================================
-- 第三步：收款序號安全產生機制
-- ============================================================

CREATE TABLE "payment_sequence_counters" (
    "year" INTEGER NOT NULL,
    "currentValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payment_sequence_counters_pkey" PRIMARY KEY ("year")
);

-- 從既有 transactionNo（格式 PT-{年度}-{6位數流水號}）回推每個年度目前
-- 最大的流水號，讓新的安全產生機制接續下去，不會跟舊資料的編號衝突。
INSERT INTO "payment_sequence_counters" ("year", "currentValue")
SELECT
  split_part("transactionNo", '-', 2)::int AS year,
  MAX(split_part("transactionNo", '-', 3)::int) AS max_seq
FROM "payment_transactions"
WHERE "transactionNo" ~ '^PT-[0-9]+-[0-9]+$'
GROUP BY split_part("transactionNo", '-', 2)::int
ON CONFLICT ("year") DO UPDATE SET "currentValue" = EXCLUDED."currentValue";

-- ============================================================
-- 第四步：退款/轉款/作廢的財務來源識別碼
-- ============================================================

ALTER TABLE "payment_adjustments" ADD COLUMN "financeSourceKey" TEXT;
CREATE UNIQUE INDEX "payment_adjustments_financeSourceKey_key" ON "payment_adjustments"("financeSourceKey");
