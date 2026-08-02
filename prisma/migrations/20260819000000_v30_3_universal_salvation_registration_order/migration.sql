-- V30.3 普渡報名順序（registrationOrder）
-- 只在 RitualRegistrationItem 新增兩個「可為 NULL」的欄位與一組唯一約束，
-- 不改動 RitualRecord / Member / Household / 牌位內容 / 金額 / 收款。
-- 既有資料一律以 NULL 進來（不占用順序），之後由 backfill 腳本針對指定活動補號。

-- 1) 報名順序（本次活動、該報名項目內；1 起；NULL = 尚未補號/無活動歸屬）。
ALTER TABLE "ritual_registration_items" ADD COLUMN "registrationOrder" INTEGER;

-- 2) 冗餘活動 id（由 RitualRecord.templeEventId 安全回填；供唯一約束與本活動查詢）。
ALTER TABLE "ritual_registration_items" ADD COLUMN "templeEventId" TEXT;

-- 3) 唯一約束：同一 (活動, 報名項目) 內順序不得重複。
--    PostgreSQL 對 NULL 視為相異，故 templeEventId 或 registrationOrder 為 NULL 的舊資料不受限制。
CREATE UNIQUE INDEX "rri_event_item_order_key"
  ON "ritual_registration_items" ("templeEventId", "registrationItemTypeId", "registrationOrder");

-- 4) 依活動查詢用索引。
CREATE INDEX "rri_temple_event_idx"
  ON "ritual_registration_items" ("templeEventId");
