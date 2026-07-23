-- V14.2：回填本戶固定陽上人字庫（household_yangshang）。
--
-- 背景：household_yangshang 是 V14.2 新表，對「新表建立前就已匯入」的家戶完全是空的，
-- 所以畫面上的「本戶固定陽上人」一鍵選項沒有任何資料。這支把**既有**的陽上姓名
-- 一次回填進字庫。
--
-- 冪等 & 不覆蓋：ON CONFLICT ("householdId","name") DO NOTHING──重跑不會重複、
-- 也不會覆蓋任何人工建立的資料（同一戶同名只會有一筆）。純寫入新表，不動既有資料表。
--
-- 來源（都只抽「姓名」，含「、／,／，」多位自動拆開、trim、去空白）：
--   1. worship_records.yangshangName          （祭祀資料上的陽上姓名）
--   2. members.yangshangName                  （成員標記離世時填的陽上姓名）
--   3. universal_salvation_entries.yangshangName 與 yangshangNames[]（歷年普渡牌位）
INSERT INTO "household_yangshang" ("id", "householdId", "name", "source", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s."householdId", s."name", 'IMPORT', now(), now()
FROM (
  -- 1. 祭祀資料
  SELECT wr."householdId" AS "householdId", trim(x) AS "name"
  FROM "worship_records" wr,
       regexp_split_to_table(coalesce(wr."yangshangName", ''), '[、,，]') AS x
  WHERE trim(x) <> ''

  UNION

  -- 2. 成員陽上姓名
  SELECT m."householdId", trim(x)
  FROM "members" m,
       regexp_split_to_table(coalesce(m."yangshangName", ''), '[、,，]') AS x
  WHERE m."deletedAt" IS NULL AND trim(x) <> ''

  UNION

  -- 3a. 普渡牌位舊單一欄位
  SELECT rr."householdId", trim(x)
  FROM "universal_salvation_entries" e
  JOIN "universal_salvation_details" d ON d."id" = e."universalSalvationId"
  JOIN "ritual_records" rr ON rr."id" = d."ritualRecordId",
       regexp_split_to_table(coalesce(e."yangshangName", ''), '[、,，]') AS x
  WHERE e."deletedAt" IS NULL AND trim(x) <> ''

  UNION

  -- 3b. 普渡牌位多位陽上人陣列
  SELECT rr."householdId", trim(nm)
  FROM "universal_salvation_entries" e
  JOIN "universal_salvation_details" d ON d."id" = e."universalSalvationId"
  JOIN "ritual_records" rr ON rr."id" = d."ritualRecordId",
       unnest(e."yangshangNames") AS nm
  WHERE e."deletedAt" IS NULL AND trim(nm) <> ''
) s
WHERE s."householdId" IS NOT NULL AND s."name" <> ''
ON CONFLICT ("householdId", "name") DO NOTHING;
