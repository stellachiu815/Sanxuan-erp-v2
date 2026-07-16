-- V11.0.2「正式建置、錯誤清理與封版」需求九：重複送出防護。
-- 新增 payment_transactions.idempotencyKey，允許 NULL（既有收款交易沒有這組
-- 識別碼），並建立 unique 索引，讓「相同 idempotencyKey 只能對應一筆真正的
-- PaymentTransaction」這件事由資料庫本身保證，不是只靠應用程式邏輯。

ALTER TABLE "payment_transactions" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "payment_transactions_idempotencyKey_key" ON "payment_transactions"("idempotencyKey");
