-- V14.2：中元普渡「四類牌位」年度單價（TempleEvent 上，沿用 pocket/sponsor 同一套結構）。
--
-- ⚠️ 純附加、向下相容：四個可空欄位，既有活動一律 NULL、不受影響、不動任何既有資料。
-- 型別沿用全專案 Decimal(12,2)。
ALTER TABLE "temple_events" ADD COLUMN IF NOT EXISTS "ancestorUnitPrice" DECIMAL(12,2);
ALTER TABLE "temple_events" ADD COLUMN IF NOT EXISTS "zhenghunUnitPrice" DECIMAL(12,2);
ALTER TABLE "temple_events" ADD COLUMN IF NOT EXISTS "yuanqinUnitPrice" DECIMAL(12,2);
ALTER TABLE "temple_events" ADD COLUMN IF NOT EXISTS "wuyuanUnitPrice" DECIMAL(12,2);
