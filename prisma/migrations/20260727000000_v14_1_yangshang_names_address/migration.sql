-- V14.1：普渡牌位多位陽上人＋每筆獨立牌位地址。
--
-- ⚠️ 純附加、冪等、向下相容：
--  - 只新增欄位，不刪除既有 yangshangName（保留正式資料）。
--  - yangshangNames 預設空陣列；把既有單一 yangshangName 安全回填成單元素陣列，
--    只在「陣列目前為空且舊欄位有值」時回填，可重複執行不會重複塞入。
ALTER TABLE "universal_salvation_entries"
  ADD COLUMN IF NOT EXISTS "yangshangNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "universal_salvation_entries"
  ADD COLUMN IF NOT EXISTS "tabletAddress" TEXT;

-- 舊資料回填：yangshangName 有值、yangshangNames 仍為空 → 補成單一元素陣列。
UPDATE "universal_salvation_entries"
   SET "yangshangNames" = ARRAY["yangshangName"]
 WHERE "yangshangName" IS NOT NULL
   AND btrim("yangshangName") <> ''
   AND (array_length("yangshangNames", 1) IS NULL);
