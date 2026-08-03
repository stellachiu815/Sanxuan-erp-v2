-- V31 正式作業編號 workOrder 與 單筆列印主文覆寫 printMainText
-- 純新增 nullable 欄位，不改既有欄位、不觸及 registrationOrder/收款/財務/牌位內容/報名流程。
-- ⚠️ 本檔僅產生，不得 migrate deploy、不得 backfill。

ALTER TABLE "ritual_registration_items"
  ADD COLUMN IF NOT EXISTS "workOrder" INTEGER;

-- 正式作業號各活動×項目各自 1..N、不重號；以 unique index 作最後防線（NULL 可重複＝尚未指派）。
CREATE UNIQUE INDEX IF NOT EXISTS "rri_event_item_workorder_key"
  ON "ritual_registration_items" ("templeEventId", "registrationItemTypeId", "workOrder");

ALTER TABLE "universal_salvation_entries"
  ADD COLUMN IF NOT EXISTS "printMainText" TEXT;
