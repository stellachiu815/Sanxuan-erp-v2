-- V13.3B（第一段）：ReceivableSourceType 新增 ADDITIONAL_PRINT_ITEM
--
-- ⚠️⚠️ 這個 migration **刻意只有一句 SQL**，原因是 PostgreSQL 的限制：
--
--   `ALTER TYPE ... ADD VALUE` 在舊版 PostgreSQL 不能於 transaction block
--   內執行；即使在 PG 12+ 放寬之後，**同一個 transaction 內也不能使用
--   剛剛新增的那個 enum 值**（會出現 "unsafe use of new value of enum type"）。
--
-- Prisma migrate 預設會把單一 migration 檔包在一個 transaction 裡執行，
-- 所以只要在這個檔案裡再寫任何「使用到 ADDITIONAL_PRINT_ITEM」的 SQL，
-- 部署就會失敗。
--
-- 因此：
--   * 這一段：只新增 enum 值，不做任何其他事
--   * 下一段（20260723000001_...）：才做欄位新增等其他變更
--
-- 純附加，既有資料與既有 enum 值完全不受影響。

ALTER TYPE "ReceivableSourceType" ADD VALUE 'ADDITIONAL_PRINT_ITEM';
