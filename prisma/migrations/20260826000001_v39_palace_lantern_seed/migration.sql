-- V39 宮燈報名項目種子
--
-- 與既有報名項目種子同一套機制：固定 id + ON CONFLICT (key) DO NOTHING，冪等、
-- 純 INSERT、不 UPDATE、不 DELETE，可重複執行、不覆蓋宮方事後調整過的單價。
--
-- ⚠️ 必須排在 20260826000000（ALTER TYPE ActivityType ADD VALUE 'PALACE_LANTERN'）之後、
-- 且是「不同一支」migration——PostgreSQL 不允許在同一交易內使用剛新增的 enum 值。
-- 宮燈＝名單型（同補庫）：contentKind ROSTER、feeMode CUSTOM（單價由 fixedItemPrice 設為 FIXED）。
INSERT INTO "registration_item_types"
  ("id","activityType","activityGroup","activityGroupName","key","name","contentKind","feeMode","defaultUnitPrice","defaultQuantity","allowMultiplePerMember","printDocumentKeys","metadataJson","sortOrder","isActive","updatedAt")
VALUES
  ('rit_palace_lantern','PALACE_LANTERN','PALACE_LANTERN','宮燈','PALACE_LANTERN','宮燈報名','ROSTER','CUSTOM',NULL,1,false, ARRAY['PALACE_LANTERN_ROSTER'], NULL, 1, true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
