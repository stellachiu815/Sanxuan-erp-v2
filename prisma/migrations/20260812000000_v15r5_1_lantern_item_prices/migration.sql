-- V15R5.1：年度燈四項目各自逐年單價——新增「光明燈／太歲燈」年度單價欄位。
--
-- 原本年度燈只逐年設祭改（purificationUnitPrice）與全家燈（familyLanternUnitPrice）；
-- 光明燈／太歲燈仍讀全域 RegistrationItemType.defaultUnitPrice（＝500）。本 migration 讓四項
-- 目都能各自逐年設定，光明燈/太歲燈改讀 TempleEvent 的專屬欄位，不再讀 defaultUnitPrice、
-- 不寫死 500。沿用 sponsorUnitPrice/四類牌位單價**完全相同**的 per-year Decimal 欄位模式，
-- 不新建價格表、不改既有金流結構。
--
-- ⚠️ 只 ADD COLUMN，**不 backfill**：不主動把 defaultUnitPrice 或任何值寫進 TempleEvent。
--    原因——正式站既有活動可能各年度價格不同，migration 一律寫值會覆蓋掉正確的年度價格。
--    改由「年度燈單價設定」畫面第一次開啟時，對仍為 NULL 的欄位**預帶** RegistrationItemType.
--    defaultUnitPrice 作為建議值顯示；只有使用者按「儲存單價」才真正寫入 TempleEvent。
--
-- 安全性：
--   * 只 ADD COLUMN（nullable、無 DEFAULT），不刪任何資料、不改任何既有列、不重建活動。
--   * 不改既有報名金額、付款、收據、應收（那些是建立當下快照，不回頭改）。
--   * 既有活動四項欄位一律維持 NULL，直到管理者在設定畫面確認並儲存。
ALTER TABLE "temple_events"
  ADD COLUMN IF NOT EXISTS "brightLightUnitPrice" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "taisuiLightUnitPrice" DECIMAL(12,2);
