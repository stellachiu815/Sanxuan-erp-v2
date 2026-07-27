-- V22 財務中心（正式版）。
-- 單一帳本：沿用既有 FinanceRecord（先前僅預留、從未寫入），擴充為財務中心流水帳。
-- 活動收款不重複寫入本表（由 PaymentTransaction 衍生為收入）。不建立第二套帳務。

-- 一、列舉型別
CREATE TYPE "FinanceAccount" AS ENUM ('BANK', 'CASH');
CREATE TYPE "FinanceEntryKind" AS ENUM ('OPENING', 'INCOME', 'EXPENSE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT');
CREATE TYPE "FinanceDirection" AS ENUM ('IN', 'OUT');

-- 二、擴充 finance_records
--   createdById 由 NOT NULL 改為可空（相容期初/系統匯入）。
ALTER TABLE "finance_records" ALTER COLUMN "createdById" DROP NOT NULL;

ALTER TABLE "finance_records"
  ADD COLUMN "account"          "FinanceAccount",
  ADD COLUMN "entryKind"        "FinanceEntryKind",
  ADD COLUMN "direction"        "FinanceDirection",
  ADD COLUMN "year"             INTEGER,
  ADD COLUMN "templeEventId"    TEXT,
  ADD COLUMN "transferGroupId"  TEXT,
  ADD COLUMN "reconciliationId" TEXT,
  ADD COLUMN "correctsRecordId" TEXT,
  ADD COLUMN "isHistorical"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "createdByName"    TEXT,
  ADD COLUMN "voidedByName"     TEXT;

ALTER TABLE "finance_records"
  ADD CONSTRAINT "finance_records_templeEventId_fkey"
  FOREIGN KEY ("templeEventId") REFERENCES "temple_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "finance_records_account_idx" ON "finance_records"("account");
CREATE INDEX "finance_records_entryKind_idx" ON "finance_records"("entryKind");
CREATE INDEX "finance_records_year_idx" ON "finance_records"("year");
CREATE INDEX "finance_records_occurredOn_idx" ON "finance_records"("occurredOn");
CREATE INDEX "finance_records_templeEventId_idx" ON "finance_records"("templeEventId");
CREATE INDEX "finance_records_transferGroupId_idx" ON "finance_records"("transferGroupId");

-- 三、現金盤點／銀行對帳
CREATE TABLE "finance_reconciliations" (
  "id"                 TEXT NOT NULL,
  "account"            "FinanceAccount" NOT NULL,
  "occurredOn"         DATE NOT NULL,
  "systemAmount"       DECIMAL(12,2) NOT NULL,
  "countedAmount"      DECIMAL(12,2) NOT NULL,
  "difference"         DECIMAL(12,2) NOT NULL,
  "note"               TEXT,
  "adjustmentRecordId" TEXT,
  "createdById"        TEXT,
  "createdByName"      TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_reconciliations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "finance_reconciliations_account_idx" ON "finance_reconciliations"("account");
CREATE INDEX "finance_reconciliations_occurredOn_idx" ON "finance_reconciliations"("occurredOn");

-- 四、正式期初餘額（正式啟用日 民國115/07/31＝西元 2026-07-31）。
--     之後年度以累計餘額自動承接，不需重新輸入。冪等：固定 id + ON CONFLICT DO NOTHING。
INSERT INTO "finance_records"
  ("id","type","category","amount","occurredOn","description","status","account","entryKind","direction","year","isHistorical","createdByName","createdAt","updatedAt")
VALUES
  ('fin_opening_bank_115','INCOME','期初餘額－銀行',1742325,DATE '2026-07-31','正式啟用期初餘額（民國115/07/31）','CONFIRMED','BANK','OPENING','IN',115,false,'系統（V22 期初）',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('fin_opening_cash_115','INCOME','期初餘額－現金',25778,DATE '2026-07-31','正式啟用期初餘額（民國115/07/31，34,010－7/29雜支8,232）','CONFIRMED','CASH','OPENING','IN',115,false,'系統（V22 期初）',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- 五、7/29 一般支出（合計 8,232）。期初現金已內含扣除，故此五筆設 isHistorical=true：
--     保留在流水帳供備查，但不再計入帳戶餘額與收入/支出報表合計（避免重複扣款）。
INSERT INTO "finance_records"
  ("id","type","category","amount","occurredOn","description","status","account","entryKind","direction","year","isHistorical","createdByName","createdAt","updatedAt")
VALUES
  ('fin_hist_0729_flower','EXPENSE','花',800,DATE '2026-07-29','7/29 一般支出（啟用前，期初已內含）','CONFIRMED','CASH','EXPENSE','OUT',115,true,'系統（V22 期初）',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('fin_hist_0729_rice','EXPENSE','米',289,DATE '2026-07-29','7/29 一般支出（啟用前，期初已內含）','CONFIRMED','CASH','EXPENSE','OUT',115,true,'系統（V22 期初）',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('fin_hist_0729_paper','EXPENSE','紙碗紙杯衛生紙',6340,DATE '2026-07-29','7/29 一般支出（啟用前，期初已內含）','CONFIRMED','CASH','EXPENSE','OUT',115,true,'系統（V22 期初）',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('fin_hist_0729_water','EXPENSE','水費',593,DATE '2026-07-29','7/29 一般支出（啟用前，期初已內含）','CONFIRMED','CASH','EXPENSE','OUT',115,true,'系統（V22 期初）',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('fin_hist_0729_poster','EXPENSE','普渡海報',210,DATE '2026-07-29','7/29 一般支出（啟用前，期初已內含）','CONFIRMED','CASH','EXPENSE','OUT',115,true,'系統（V22 期初）',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
