-- V14.2：既有普渡牌位項目 ↔ UniversalSalvationEntry 的「保守」一次性回填。
--
-- 只在**唯一可靠匹配**時才回填 universalSalvationEntryId：同一筆 RitualRecord 內，
-- 對應類別「未連結的計價項目恰好 1 筆」且「未連結的牌位恰好 1 筆」才配對。
-- 任何一邊 >1（歧義）一律不動——不得用建立順序或成員姓名亂猜，留待人工確認
-- （見本檔尾註的待人工確認查詢）。純附加、冪等：已連結的不再處理。
--
-- 對照：US_ANCESTOR↔ANCESTOR_LINE、US_ZHENGHUN↔INDIVIDUAL_SOUL、
--       US_YUANQIN↔DEBT_CREDITOR、US_WUYUAN↔UNBORN_CHILD。
WITH item_unique AS (
  SELECT ri."ritualRecordId" AS rrid,
         rit."key"           AS item_key,
         MIN(ri."id")        AS item_id
  FROM "ritual_registration_items" ri
  JOIN "registration_item_types" rit ON rit."id" = ri."registrationItemTypeId"
  WHERE ri."universalSalvationEntryId" IS NULL
    AND ri."deletedAt" IS NULL
    AND rit."key" IN ('US_ANCESTOR', 'US_ZHENGHUN', 'US_YUANQIN', 'US_WUYUAN')
  GROUP BY ri."ritualRecordId", rit."key"
  HAVING COUNT(*) = 1
),
entry_unique AS (
  SELECT rr."id"        AS rrid,
         e."category"   AS category,
         MIN(e."id")    AS entry_id
  FROM "universal_salvation_entries" e
  JOIN "universal_salvation_details" d ON d."id" = e."universalSalvationId"
  JOIN "ritual_records" rr ON rr."id" = d."ritualRecordId"
  WHERE e."deletedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "ritual_registration_items" x
      WHERE x."universalSalvationEntryId" = e."id"
    )
  GROUP BY rr."id", e."category"
  HAVING COUNT(*) = 1
)
UPDATE "ritual_registration_items" ri
SET "universalSalvationEntryId" = eu.entry_id
FROM item_unique iu
JOIN entry_unique eu
  ON eu.rrid = iu.rrid
 AND eu.category = (CASE iu.item_key
        WHEN 'US_ANCESTOR' THEN 'ANCESTOR_LINE'
        WHEN 'US_ZHENGHUN' THEN 'INDIVIDUAL_SOUL'
        WHEN 'US_YUANQIN'  THEN 'DEBT_CREDITOR'
        WHEN 'US_WUYUAN'   THEN 'UNBORN_CHILD'
     END)::"UniversalSalvationEntryCategory"
WHERE ri."id" = iu.item_id
  AND ri."universalSalvationEntryId" IS NULL;

-- 待人工確認清單（歧義未回填者）請於資料庫執行以下查詢檢視：
--   SELECT ri."id", ri."ritualRecordId", rit."key", ri."memberId", ri."createdAt"
--   FROM "ritual_registration_items" ri
--   JOIN "registration_item_types" rit ON rit."id" = ri."registrationItemTypeId"
--   WHERE ri."universalSalvationEntryId" IS NULL AND ri."deletedAt" IS NULL
--     AND rit."key" IN ('US_ANCESTOR','US_ZHENGHUN','US_YUANQIN','US_WUYUAN')
--   ORDER BY ri."ritualRecordId", rit."key";
