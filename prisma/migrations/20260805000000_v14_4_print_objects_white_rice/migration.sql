-- V14.4「普渡列印物件＋白米年度配額＋資料建立來源整合」
--
-- ⚠️ 純附加、向下相容、可重跑（全部 IF NOT EXISTS）：
--   - 不刪除任何既有欄位、不清空既有列印紀錄。
--   - 舊的整筆列印狀態安全轉入新的列印物件層，且不誤標為「已補印」。
--   - 白米為每年由神明指派的年度配額，欄位一律 nullable/預設關閉，既有活動不受影響。

-- ────────────────────────────────────────────────────────────
-- 1. TempleEvent：白米年度配額設定（沿用同一套 per-year 欄位，不另建價格表）
-- ────────────────────────────────────────────────────────────
ALTER TABLE "temple_events" ADD COLUMN IF NOT EXISTS "riceTotalKg" DECIMAL(12,2);
ALTER TABLE "temple_events" ADD COLUMN IF NOT EXISTS "riceUnitPrice" DECIMAL(12,2);
ALTER TABLE "temple_events" ADD COLUMN IF NOT EXISTS "riceOpen" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "temple_events" ADD COLUMN IF NOT EXISTS "riceNote" TEXT;

-- ────────────────────────────────────────────────────────────
-- 2. RitualRegistrationItem：建立當下鎖定單價（白米＝每斤金額）
-- ────────────────────────────────────────────────────────────
ALTER TABLE "ritual_registration_items" ADD COLUMN IF NOT EXISTS "lockedUnitPrice" DECIMAL(12,2);

-- ────────────────────────────────────────────────────────────
-- 3. AdditionalPrintItem：牌位／寶袋獨立列印物件追蹤欄位
-- ────────────────────────────────────────────────────────────
ALTER TABLE "additional_print_items" ADD COLUMN IF NOT EXISTS "firstPrintedAt" TIMESTAMP(3);
ALTER TABLE "additional_print_items" ADD COLUMN IF NOT EXISTS "lastPrintedAt" TIMESTAMP(3);
ALTER TABLE "additional_print_items" ADD COLUMN IF NOT EXISTS "lastPrintedByUserId" TEXT;
ALTER TABLE "additional_print_items" ADD COLUMN IF NOT EXISTS "printCount" INTEGER NOT NULL DEFAULT 0;

-- 3a. 舊列印狀態安全轉入（只針對「尚未轉入」的列（printCount = 0 且新欄位為空），
--     可重跑不會重複累加、也不會覆蓋已由新流程寫入的值）：
--   - firstPrintedAt ← 既有 printedAt（第一次列印時間；舊資料只有一個時間戳，視為首印）。
--   - lastPrintedAt  ← 既有 printedAt（最近一次列印時間）。
--   - printCount     ← 已列印(isPrinted) 才有次數：1（首印）+ reprintCount（補印次數）。
--     未列印(isPrinted=false) 一律維持 0，**不會被誤標為已補印**。
UPDATE "additional_print_items"
SET
  "firstPrintedAt" = "printedAt",
  "lastPrintedAt"  = "printedAt",
  "printCount"     = CASE WHEN "isPrinted" = true THEN 1 + COALESCE("reprintCount", 0) ELSE 0 END
WHERE "printCount" = 0
  AND "firstPrintedAt" IS NULL
  AND "isPrinted" = true;

-- 3b. 索引：列印中心常以「最後列印時間」排序/篩選。
CREATE INDEX IF NOT EXISTS "additional_print_items_lastPrintedAt_idx" ON "additional_print_items" ("lastPrintedAt");

-- ────────────────────────────────────────────────────────────
-- 4. TempleEventPrintBatch：列印確認冪等鍵（防重送/連點重複累加 printCount）
-- ────────────────────────────────────────────────────────────
ALTER TABLE "temple_event_print_batches" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "temple_event_print_batches_idempotencyKey_key" ON "temple_event_print_batches" ("idempotencyKey");

-- ────────────────────────────────────────────────────────────
-- 5. Part 2：牌位建立時自動建立列印物件（TABLET×1、預設 POCKET×1）
-- ────────────────────────────────────────────────────────────
-- 5a. 硬防重：同一 sourceEntryId＋itemType 的「預設物件」（isExtra=false、未刪除）唯一。
--     額外寶袋 isExtra=true 不受此限（可多筆）。API 重送/連點即使繞過應用層檢查，
--     資料庫也擋下重複的預設 TABLET／POCKET。
CREATE UNIQUE INDEX IF NOT EXISTS "additional_print_items_default_object_uq"
  ON "additional_print_items" ("sourceEntryId", "itemType")
  WHERE "isExtra" = false AND "deletedAt" IS NULL;

-- 5b. Backfill：既有有效牌位（universal_salvation_entries）若尚無預設 TABLET／POCKET，
--     各補建一筆。printCount=0（未列印），不誤標為已列印/補印。可重跑（NOT EXISTS 防重）。
--     id 用不依賴擴充套件的字串（'bf_' || md5(...)），僅需唯一，非 cuid 也可（欄位為 String）。
INSERT INTO "additional_print_items" (
  "id", "ritualRecordId", "householdId", "sourceEntryId", "sourceEntryType",
  "memberId", "activityId", "itemType", "printName", "usesSourceName",
  "quantity", "isExtra", "isChargeable", "status", "printCount", "createdAt", "updatedAt"
)
SELECT
  'bf_' || md5(random()::text || clock_timestamp()::text || e."id" || 'TABLET'),
  rr."id", rr."householdId", e."id", 'UNIVERSAL_SALVATION_ENTRY',
  NULL, rr."templeEventId", 'TABLET'::"AdditionalPrintItemType", e."displayName", true,
  1, false, false, 'PENDING_PRINT'::"AdditionalPrintItemStatus", 0, now(), now()
FROM "universal_salvation_entries" e
JOIN "universal_salvation_details" d ON d."id" = e."universalSalvationId"
JOIN "ritual_records" rr ON rr."id" = d."ritualRecordId"
WHERE e."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "additional_print_items" a
    WHERE a."sourceEntryId" = e."id" AND a."itemType" = 'TABLET'
      AND a."isExtra" = false AND a."deletedAt" IS NULL
  );

INSERT INTO "additional_print_items" (
  "id", "ritualRecordId", "householdId", "sourceEntryId", "sourceEntryType",
  "memberId", "activityId", "itemType", "printName", "usesSourceName",
  "quantity", "isExtra", "isChargeable", "status", "printCount", "createdAt", "updatedAt"
)
SELECT
  'bf_' || md5(random()::text || clock_timestamp()::text || e."id" || 'POCKET'),
  rr."id", rr."householdId", e."id", 'UNIVERSAL_SALVATION_ENTRY',
  NULL, rr."templeEventId", 'POCKET'::"AdditionalPrintItemType", e."displayName", true,
  1, false, false, 'PENDING_PRINT'::"AdditionalPrintItemStatus", 0, now(), now()
FROM "universal_salvation_entries" e
JOIN "universal_salvation_details" d ON d."id" = e."universalSalvationId"
JOIN "ritual_records" rr ON rr."id" = d."ritualRecordId"
WHERE e."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "additional_print_items" a
    WHERE a."sourceEntryId" = e."id" AND a."itemType" = 'POCKET'
      AND a."isExtra" = false AND a."deletedAt" IS NULL
  );
