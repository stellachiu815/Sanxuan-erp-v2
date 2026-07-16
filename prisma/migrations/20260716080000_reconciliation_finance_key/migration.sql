-- V11.0.2 需求「八、再次驗證財務防重複識別」：代收對帳批次新增自己的財務
-- 識別碼命名空間（資金移轉事件，不是收入事件），跟 PaymentAllocation／
-- PaymentAdjustment 各自的 financeSourceKey 分開、互不衝突。

ALTER TABLE "agent_reconciliation_records" ADD COLUMN "financeSourceKey" TEXT;

CREATE UNIQUE INDEX "agent_reconciliation_records_financeSourceKey_key" ON "agent_reconciliation_records"("financeSourceKey");
