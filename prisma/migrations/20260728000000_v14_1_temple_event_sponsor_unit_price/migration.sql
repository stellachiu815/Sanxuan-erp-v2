-- V14.1：中元普渡活動層贊普單價（sponsorUnitPrice）。
--
-- ⚠️ 純附加、向下相容：只新增一個可空欄位，既有活動一律 NULL、不受影響，
-- 不動任何既有資料、無 DROP/UPDATE。型別與 pocketUnitPrice 一致 Decimal(12,2)。
ALTER TABLE "temple_events" ADD COLUMN IF NOT EXISTS "sponsorUnitPrice" DECIMAL(12,2);
