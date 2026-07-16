\set ON_ERROR_STOP on
\timing off

-- ============================================================
-- V11.0.1 整合驗收：實際操作測試情境（真實 PostgreSQL，手動驅動 SQL，
-- 對應收款中心 collectionCenter.ts / receivableAdapters.ts 實際執行的
-- 語句，見交付報告「實際操作測試」章節）。
-- ============================================================

\echo '=== 情境準備：普渡活動與贊普資料（UNIVERSAL_SALVATION_SPONSOR）==='

INSERT INTO temple_events (id, "activityType", year, name, status, "createdAt", "updatedAt")
VALUES ('TE_V1101_US', 'UNIVERSAL_SALVATION', 115, '民國一一五年度中元普渡', 'ONGOING', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO ritual_records (id, "householdId", year, "activityType", status, "templeEventId", "createdAt", "updatedAt")
VALUES ('RR_V1101_US_1', 'H_TEST001', 115, 'UNIVERSAL_SALVATION', 'CONFIRMED', 'TE_V1101_US', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO universal_salvation_details
  (id, "ritualRecordId", "isRegistered", "isSponsor", "sponsorAmount", "amountDue", "amountPaid", "amountUnpaid", "createdAt", "updatedAt")
VALUES
  ('USD_V1101_1', 'RR_V1101_US_1', true, true, 5000, 5000, 0, 5000, now(), now())
ON CONFLICT (id) DO NOTHING;

\echo '--- 情境 5：普渡贊普分兩次付款（未付款→部分付款→已付款），不得覆蓋前一次付款 ---'

-- 第一次付款 2000（模擬 universalSalvationSponsorAdapter.applyPayment 的原子條件式 UPDATE）
UPDATE universal_salvation_details
SET "amountPaid" = "amountPaid" + 2000,
    "amountUnpaid" = GREATEST("amountDue" - ("amountPaid" + 2000), 0)
WHERE id = 'USD_V1101_1' AND "isSponsor" = true AND "amountUnpaid" >= 2000
RETURNING id, "amountDue", "amountPaid", "amountUnpaid";

INSERT INTO universal_salvation_payments (id, "universalSalvationDetailId", kind, amount, "paidOn", method, "collectedByName", note, "createdAt")
VALUES ('USP_V1101_1', 'USD_V1101_1', 'PAYMENT', 2000, '2026-07-16', 'CASH', '收款測試員', '[V11.0.1情境驗證：第一次付款]', now());

\echo '>>> 預期：amountPaid=2000, amountUnpaid=3000（部分付款）'
SELECT id, "amountDue", "amountPaid", "amountUnpaid" FROM universal_salvation_details WHERE id = 'USD_V1101_1';

-- 第二次付款 3000（收清）
UPDATE universal_salvation_details
SET "amountPaid" = "amountPaid" + 3000,
    "amountUnpaid" = GREATEST("amountDue" - ("amountPaid" + 3000), 0)
WHERE id = 'USD_V1101_1' AND "isSponsor" = true AND "amountUnpaid" >= 3000
RETURNING id, "amountDue", "amountPaid", "amountUnpaid";

INSERT INTO universal_salvation_payments (id, "universalSalvationDetailId", kind, amount, "paidOn", method, "collectedByName", note, "createdAt")
VALUES ('USP_V1101_2', 'USD_V1101_1', 'PAYMENT', 3000, '2026-07-16', 'CASH', '收款測試員', '[V11.0.1情境驗證：第二次付款]', now());

\echo '>>> 預期：amountPaid=5000, amountUnpaid=0（已付款），付款分錄仍有兩筆（歷程保留，沒有覆蓋前一次）'
SELECT id, "amountDue", "amountPaid", "amountUnpaid" FROM universal_salvation_details WHERE id = 'USD_V1101_1';
SELECT id, kind, amount, note FROM universal_salvation_payments WHERE "universalSalvationDetailId" = 'USD_V1101_1' ORDER BY "createdAt";

\echo '--- 情境：超額付款必須被原子條件式 UPDATE 擋下（0 rows）---'
UPDATE universal_salvation_details
SET "amountPaid" = "amountPaid" + 1,
    "amountUnpaid" = GREATEST("amountDue" - ("amountPaid" + 1), 0)
WHERE id = 'USD_V1101_1' AND "isSponsor" = true AND "amountUnpaid" >= 1
RETURNING id;
\echo '>>> 預期：上面這條 UPDATE 沒有任何一列被更新（因為 amountUnpaid 已經是 0，不足以扣款）'

\echo ''
\echo '=== 情境準備：祭改資料（PURIFICATION_ENTRY）==='

INSERT INTO temple_events (id, "activityType", year, name, status, "createdAt", "updatedAt")
VALUES ('TE_V1101_PUR', 'PURIFICATION', 115, '民國一一五年度祭改', 'ONGOING', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO ritual_records (id, "householdId", "memberId", year, "activityType", status, "templeEventId", "createdAt", "updatedAt")
VALUES ('RR_V1101_PUR_1', 'H_TEST002', 'M_TEST002', 115, 'PURIFICATION', 'CONFIRMED', 'TE_V1101_PUR', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO purification_entries
  (id, "ritualRecordId", "templeEventId", number, "memberId", "isTemporaryName", "feeStatus", "amountDue", "amountPaid", "amountUnpaid", "registeredAt", "createdAt", "updatedAt")
VALUES
  ('PE_V1101_1', 'RR_V1101_PUR_1', 'TE_V1101_PUR', 1, 'M_TEST002', false, 'CHARGEABLE', 800, 0, 800, now(), now(), now())
ON CONFLICT (id) DO NOTHING;

\echo '--- 情境 6：祭改分兩次付款，且需同步舊版 paymentStatus/paymentAmount 欄位 ---'

UPDATE purification_entries
SET "amountPaid" = "amountPaid" + 500,
    "amountUnpaid" = GREATEST(COALESCE("amountDue", 0) - ("amountPaid" + 500), 0)
WHERE id = 'PE_V1101_1' AND status = 'ACTIVE' AND "feeStatus" = 'CHARGEABLE' AND "deletedAt" IS NULL AND "amountUnpaid" >= 500
RETURNING id, "amountDue", "amountPaid", "amountUnpaid";

UPDATE purification_entries SET "paymentStatus" = 'PARTIAL', "paymentAmount" = 500 WHERE id = 'PE_V1101_1';

INSERT INTO purification_payments (id, "purificationEntryId", kind, amount, "paidOn", method, "collectedByName", note, "createdAt")
VALUES ('PP_V1101_1', 'PE_V1101_1', 'PAYMENT', 500, '2026-07-16', 'CASH', '收款測試員', '[V11.0.1情境驗證：第一次付款]', now());

\echo '>>> 預期：amountPaid=500, amountUnpaid=300, 舊版 paymentStatus=PARTIAL / paymentAmount=500'
SELECT id, "feeStatus", "amountDue", "amountPaid", "amountUnpaid", "paymentStatus", "paymentAmount" FROM purification_entries WHERE id = 'PE_V1101_1';

\echo ''
\echo '=== 情境 5：祭改與供品認捐合併付款（一筆 PaymentTransaction + 兩筆 PaymentAllocation）==='

-- 先用 PaymentSequenceCounter 安全取號（模擬 createMergedPaymentTransaction 的原子取號）
WITH seq AS (
  INSERT INTO payment_sequence_counters (year, "currentValue")
  VALUES (115, 1)
  ON CONFLICT (year) DO UPDATE SET "currentValue" = payment_sequence_counters."currentValue" + 1
  RETURNING "currentValue"
)
SELECT 'PT-115-' || lpad("currentValue"::text, 6, '0') AS transaction_no FROM seq;

\echo '>>> 上面這個序號應該接續既有 PT-115-000001/PT-115-000002 之後（見交付報告代收/合併收款既有測試資料），此為第 3 號'

INSERT INTO payment_transactions
  (id, "transactionNo", "paidOn", "totalAmount", "methodType", "payerMemberId", "payerHouseholdId", "payerNameSnapshot", "collectedByName", status, "createdAt", "updatedAt")
VALUES
  ('PT_V1101_MERGED', 'PT-115-000003', '2026-07-16', 800, 'CASH', 'M_TEST002', 'H_TEST002', '陳大文', '收款測試員', 'COMPLETED', now(), now());

-- 分配 1：祭改剩餘未收 300
UPDATE purification_entries
SET "amountPaid" = "amountPaid" + 300,
    "amountUnpaid" = GREATEST(COALESCE("amountDue", 0) - ("amountPaid" + 300), 0)
WHERE id = 'PE_V1101_1' AND status = 'ACTIVE' AND "feeStatus" = 'CHARGEABLE' AND "deletedAt" IS NULL AND "amountUnpaid" >= 300
RETURNING id, "amountPaid", "amountUnpaid";
UPDATE purification_entries SET "paymentStatus" = 'PAID', "paymentAmount" = 800 WHERE id = 'PE_V1101_1';
INSERT INTO purification_payments (id, "purificationEntryId", kind, amount, "paidOn", method, "collectedByName", note, "createdAt")
VALUES ('PP_V1101_2', 'PE_V1101_1', 'PAYMENT', 300, '2026-07-16', 'CASH', '收款測試員', '[全宮共用收款中心合併收款 PT-115-000003]', now());
INSERT INTO payment_allocations
  (id, "paymentTransactionId", "sourceType", "sourceId", "sourceLabel", "sourceYear", amount, "financeSourceKey", "createdAt")
VALUES
  ('PA_V1101_1', 'PT_V1101_MERGED', 'PURIFICATION_ENTRY', 'PE_V1101_1', '祭改（編號1）－陳大文（115年度）', 115, 300, 'PURIFICATION_ENTRY:PE_V1101_1:PT_V1101_MERGED', now());

-- 分配 2：供品認捐 OC_SMALL_TURTLE_2 全額 3000？不對，總額要等於 800，這裡改成同一次收款裡的另一項小額供品。
-- 改用 OC_FLORAL_2（1500）會超過 800 的合併總額；為了讓示範情境金額吻合，
-- 這裡改成祭改300 + 供品認捐(部分付款)500，總額800，示範「合併付款可以是部分付款」。
UPDATE offering_claims
SET "amountPaid" = "amountPaid" + 500,
    "amountUnpaid" = GREATEST("amountDue" - ("amountPaid" + 500), 0)
WHERE id = 'OC_FLORAL_2' AND status = 'ACTIVE' AND "deletedAt" IS NULL AND "amountUnpaid" >= 500
RETURNING id, "amountDue", "amountPaid", "amountUnpaid";
UPDATE offering_claims SET "paymentStatus" = 'PARTIAL' WHERE id = 'OC_FLORAL_2';
INSERT INTO offering_payments (id, "offeringClaimId", kind, amount, "paidOn", method, "collectedByName", note, "createdAt")
VALUES ('OP_V1101_1', 'OC_FLORAL_2', 'PAYMENT', 500, '2026-07-16', 'CASH', '收款測試員', '[全宮共用收款中心合併收款 PT-115-000003]', now());
INSERT INTO payment_allocations
  (id, "paymentTransactionId", "sourceType", "sourceId", "sourceOfferingPaymentId", "sourceLabel", "sourceYear", amount, "financeSourceKey", "createdAt")
VALUES
  ('PA_V1101_2', 'PT_V1101_MERGED', 'OFFERING_CLAIM', 'OC_FLORAL_2', 'OP_V1101_1', '花果供品－陳大文（115年度宮慶）', 115, 500, 'OFFERING_CLAIM:OC_FLORAL_2:PT_V1101_MERGED', now());

\echo '>>> 驗證：一筆 PaymentTransaction（PT-115-000003）底下兩筆 PaymentAllocation，加總等於 totalAmount=800，各自來源正確回寫'
SELECT pt."transactionNo", pt."totalAmount",
       sum(pa.amount) AS allocations_sum,
       count(*) AS allocation_count
FROM payment_transactions pt JOIN payment_allocations pa ON pa."paymentTransactionId" = pt.id
WHERE pt.id = 'PT_V1101_MERGED'
GROUP BY pt.id, pt."transactionNo", pt."totalAmount";

SELECT id, "amountDue", "amountPaid", "amountUnpaid", "paymentStatus" FROM purification_entries WHERE id = 'PE_V1101_1';
SELECT id, "amountDue", "amountPaid", "amountUnpaid", "paymentStatus" FROM offering_claims WHERE id = 'OC_FLORAL_2';

\echo ''
\echo '=== 情境：退款（REFUND）——沖銷後 financeSourceKey 不會撞號 ==='

-- 對 PA_V1101_2（供品500元分配）做部分退款 200
INSERT INTO offering_payments (id, "offeringClaimId", kind, amount, "paidOn", reason, "createdAt")
VALUES ('OP_V1101_2', 'OC_FLORAL_2', 'REFUND', 200, now(), 'V11.0.1情境驗證：客戶多繳退回', now());

-- 重新查詢所有分錄加總（比照 offeringClaimAdapter.applyReversal 的算法）
WITH agg AS (
  SELECT
    sum(amount) FILTER (WHERE kind IN ('PAYMENT','TRANSFER_IN')) AS paid,
    sum(amount) FILTER (WHERE kind IN ('REFUND','TRANSFER_OUT')) AS refunded
  FROM offering_payments WHERE "offeringClaimId" = 'OC_FLORAL_2'
)
UPDATE offering_claims oc
SET "amountPaid" = GREATEST(agg.paid - COALESCE(agg.refunded, 0), 0),
    "amountUnpaid" = GREATEST(oc."amountDue" - GREATEST(agg.paid - COALESCE(agg.refunded, 0), 0), 0)
FROM agg
WHERE oc.id = 'OC_FLORAL_2';

INSERT INTO payment_adjustments
  (id, "paymentTransactionId", "sourceAllocationId", "adjustmentType", amount, reason, "operatorName", "approvedByName", "financeSourceKey", "createdAt")
VALUES
  ('ADJ_V1101_1', 'PT_V1101_MERGED', 'PA_V1101_2', 'REFUND', 200, 'V11.0.1情境驗證：客戶多繳退回', '收款測試員', '主委測試', 'ADJUSTMENT:PA_V1101_2:ADJ_V1101_1', now());

\echo '>>> 預期：amountPaid=300（500-200）, amountUnpaid=200（500-300）；PaymentAllocation.financeSourceKey 與 PaymentAdjustment.financeSourceKey 是兩組不同命名空間，不會撞號'
SELECT id, "amountDue", "amountPaid", "amountUnpaid", "paymentStatus" FROM offering_claims WHERE id = 'OC_FLORAL_2';
SELECT "financeSourceKey" FROM payment_allocations WHERE id = 'PA_V1101_2';
SELECT "financeSourceKey" FROM payment_adjustments WHERE id = 'ADJ_V1101_1';

\echo ''
\echo '=== 情境 11：收款編號安全產生機制——連續取號不重複、跨年度各自從1開始 ==='

WITH seq AS (
  INSERT INTO payment_sequence_counters (year, "currentValue") VALUES (115, 1)
  ON CONFLICT (year) DO UPDATE SET "currentValue" = payment_sequence_counters."currentValue" + 1
  RETURNING "currentValue"
)
SELECT 'PT-115-' || lpad("currentValue"::text, 6, '0') AS next_no_1 FROM seq;

WITH seq AS (
  INSERT INTO payment_sequence_counters (year, "currentValue") VALUES (115, 1)
  ON CONFLICT (year) DO UPDATE SET "currentValue" = payment_sequence_counters."currentValue" + 1
  RETURNING "currentValue"
)
SELECT 'PT-115-' || lpad("currentValue"::text, 6, '0') AS next_no_2 FROM seq;

WITH seq AS (
  INSERT INTO payment_sequence_counters (year, "currentValue") VALUES (116, 1)
  ON CONFLICT (year) DO UPDATE SET "currentValue" = payment_sequence_counters."currentValue" + 1
  RETURNING "currentValue"
)
SELECT 'PT-116-' || lpad("currentValue"::text, 6, '0') AS next_no_new_year FROM seq;

\echo '>>> 預期：115年度序號接續 4、5（先前已用到3），116年度是全新年度，從 1 開始，兩個年度互不影響、不會產生重複序號'
SELECT year, "currentValue" FROM payment_sequence_counters ORDER BY year;

\echo ''
\echo '=== 情境 10/13：代收對帳 FOR UPDATE 防止同一批代收款被兩個對帳批次重複認領 ==='

INSERT INTO payment_transactions
  (id, "transactionNo", "paidOn", "totalAmount", "methodType", "payerNameSnapshot", "isAgentCollected", "agentName", "agentRemittanceStatus", status, "createdAt", "updatedAt")
VALUES
  ('PT_V1101_AGENT_1', 'PT-115-000004', '2026-07-10', 3000, 'CASH', '林小姐（代收）', true, '代收人張三', 'PENDING', 'COMPLETED', now(), now()),
  ('PT_V1101_AGENT_2', 'PT-115-000005', '2026-07-12', 2000, 'CASH', '林小姐（代收）', true, '代收人張三', 'PENDING', 'COMPLETED', now(), now());

BEGIN;
  \echo '--- 第一個對帳批次：SELECT ... FOR UPDATE 鎖定代收人張三目前所有待對帳交易 ---'
  SELECT id, "totalAmount" FROM payment_transactions
  WHERE "isAgentCollected" = true AND "agentName" = '代收人張三' AND status = 'COMPLETED'
    AND "agentRemittanceStatus" IN ('PENDING', 'PARTIALLY_REMITTED')
  FOR UPDATE;

  INSERT INTO agent_reconciliation_records
    (id, "agentName", "periodLabel", "expectedAmount", "actualAmount", "differenceAmount", "reconciledByName", "reconciledAt")
  VALUES
    ('ARR_V1101_1', '代收人張三', '115年7月', 5000, 5000, 0, '主委測試', now());

  UPDATE payment_transactions
  SET "agentRemittanceStatus" = 'RECONCILED', "agentReconciliationRecordId" = 'ARR_V1101_1'
  WHERE id IN ('PT_V1101_AGENT_1', 'PT_V1101_AGENT_2');
COMMIT;

\echo '>>> 對帳完成後，再次查詢同一個代收人待對帳交易，預期為 0 筆（不會被第二個對帳批次重複認領）'
SELECT count(*) AS still_pending FROM payment_transactions
WHERE "isAgentCollected" = true AND "agentName" = '代收人張三' AND status = 'COMPLETED'
  AND "agentRemittanceStatus" IN ('PENDING', 'PARTIALLY_REMITTED');

\echo '>>> 對帳完成後不得再次勾選繳回：agentRemittanceStatus 已經是 RECONCILED，不在 PENDING/PARTIALLY_REMITTED 範圍內，畫面上代收對帳頁不會再顯示這兩筆'
SELECT id, "agentRemittanceStatus", "agentReconciliationRecordId" FROM payment_transactions WHERE id IN ('PT_V1101_AGENT_1', 'PT_V1101_AGENT_2');

\echo ''
\echo '=== 情境：月結報表數字一致性——代收已繳回不得計為第二次收入 ==='

SELECT
  sum("totalAmount") FILTER (WHERE status = 'COMPLETED') AS total_amount,
  sum("totalAmount") FILTER (WHERE status = 'COMPLETED' AND "isAgentCollected" = false) AS direct_collected,
  sum("totalAmount") FILTER (WHERE status = 'COMPLETED' AND "isAgentCollected" = true AND "agentRemittanceStatus" IN ('PENDING','PARTIALLY_REMITTED')) AS agent_uncollected_remitted,
  sum("totalAmount") FILTER (WHERE status = 'COMPLETED' AND "isAgentCollected" = true AND "agentRemittanceStatus" = 'RECONCILED') AS agent_remitted
FROM payment_transactions
WHERE "paidOn" >= '2026-07-01' AND "paidOn" < '2026-08-01';

\echo '>>> 驗證：total_amount = direct_collected + agent_uncollected_remitted + agent_remitted（代收繳回沒有被算成第二筆收入，因為 agent_remitted 只是從 total_amount 裡再分類出來，不是另外加總）'

\echo ''
\echo '=== 全部情境驗證結束 ==='
