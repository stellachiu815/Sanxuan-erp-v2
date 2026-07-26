-- V15R5：年度燈「祭改」與「全家燈」年度單價。
--
-- 沿用與 sponsorUnitPrice／pocketUnitPrice／四類牌位單價**完全相同**的 per-year
-- TempleEvent Decimal 欄位模式——只新增兩個必要欄位，不新建價格表、不改既有金流結構、
-- 不動任何既有資料。
--   - purificationUnitPrice：祭改年度單價（收款走既有 PurificationEntry）。
--   - familyLanternUnitPrice：全家燈年度單價（收款走既有 LanternRegistration）。
--
-- nullable、無預設：既有活動一律 NULL，不被強制改價；未設定時該項應收為 0（不寫死金額）。
ALTER TABLE "temple_events"
  ADD COLUMN IF NOT EXISTS "purificationUnitPrice" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "familyLanternUnitPrice" DECIMAL(12,2);
