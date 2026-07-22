-- V13.4（第三段）：ReceivableSourceType 新增 LANTERN_REGISTRATION
--
-- ⚠️⚠️ 這個 migration **刻意只有一句 SQL**。
--
-- PostgreSQL 的限制：`ALTER TYPE ... ADD VALUE` 在同一個 transaction 內
-- 不能使用剛新增的那個 enum 值（"unsafe use of new value of enum type"）。
-- Prisma migrate 會把單一 migration 檔包成一個 transaction，所以只要在
-- 這個檔案裡再寫任何用到 LANTERN_REGISTRATION 的 SQL，部署就會失敗。
--
-- 這與 V13.3B 的 20260723000000 是同一個處理方式。

ALTER TYPE "ReceivableSourceType" ADD VALUE 'LANTERN_REGISTRATION';
