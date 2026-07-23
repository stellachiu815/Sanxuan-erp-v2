-- V14.2：RitualRegistrationItem 與 UniversalSalvationEntry 的正式 1:1 關聯。
--
-- ⚠️ 純附加、向下相容：只新增一個可空欄位與唯一索引＋外鍵，不動任何既有資料。
-- 取代先前「同類別依序配對」的暫時做法：牌位名稱／陽上人／地址／列印／補印／
-- 收款／查詢一律讀這一筆 entry，不再依賴建立順序。
ALTER TABLE "ritual_registration_items"
  ADD COLUMN IF NOT EXISTS "universalSalvationEntryId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ritual_registration_items_universalSalvationEntryId_key"
  ON "ritual_registration_items" ("universalSalvationEntryId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ritual_registration_items_universalSalvationEntryId_fkey'
  ) THEN
    ALTER TABLE "ritual_registration_items"
      ADD CONSTRAINT "ritual_registration_items_universalSalvationEntryId_fkey"
      FOREIGN KEY ("universalSalvationEntryId")
      REFERENCES "universal_salvation_entries" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
