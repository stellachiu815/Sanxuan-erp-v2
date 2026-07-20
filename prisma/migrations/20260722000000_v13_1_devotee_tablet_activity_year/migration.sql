-- V13.1「信眾資料、辭世流程、歷代祖先、乙位正魂、活動年度與列印共用規則整合版」
--
-- ⚠️ 這份 migration 是**純附加（additive）**：
--   * 只有 ADD COLUMN 與 CREATE INDEX
--   * 沒有 DROP、沒有 RENAME、沒有 ALTER TYPE、沒有 NOT NULL 約束
--   * 沒有任何 UPDATE / DELETE / TRUNCATE
--   * 不動任何既有唯一鍵（特別是 temple_events(activityType, year)）
--
-- 因此可以直接套用在正式資料庫，既有資料列完全不受影響，新欄位一律
-- 取得 NULL 或明確的預設值。Render 線上部署安全。

-- ────────────────────────────────────────────────────────────
-- 1. members：身分證字號、辭世詢問標記
-- ────────────────────────────────────────────────────────────

-- 身分證字號（指令一）。刻意不加 UNIQUE：既有正式資料可能已有重複或
-- 錯誤值，加唯一鍵會讓 migration 在正式庫直接失敗；重複由應用層的
-- 人工確認流程處理（指令十四）。
ALTER TABLE "members" ADD COLUMN "nationalId" TEXT;

-- 「暫不建立乙位正魂」的持久化標記（指令五）。用來區分「還沒建立」與
-- 「已決定不建立」，避免每次編輯都重複彈出詢問。
ALTER TABLE "members" ADD COLUMN "soulTabletPromptedAt" TIMESTAMP(3);

-- 身分證搜尋用索引（指令一「支援搜尋」）。非唯一。
CREATE INDEX "members_nationalId_idx" ON "members"("nationalId");

-- ────────────────────────────────────────────────────────────
-- 2. worship_records：建立人
-- ────────────────────────────────────────────────────────────

-- 建立人（指令七）。建立日期沿用既有的 createdAt，不重複新增。
-- 存操作人姓名字串，沿用專案既有慣例（同 record_versions.operatorName），
-- 不建 User 外鍵——系統目前仍是「選擇操作人」而非登入 session。
ALTER TABLE "worship_records" ADD COLUMN "createdByName" TEXT;

-- ────────────────────────────────────────────────────────────
-- 3. temple_events：活動年度控制（指令十）
-- ────────────────────────────────────────────────────────────
--
-- 加在 temple_events 而不是新建一張活動年度表——temple_events 本來就是
-- 「一年度 × 一活動類型」的主檔，已經是這個專案唯一的活動年度概念。
--
-- 布林欄位的預設值刻意選擇「不改變既有行為」：
--   isRegistrationOpen / isPrintOpen = true  → 既有活動維持可報名、可列印
--   isCompleted / isArchived        = false → 既有活動維持在候選名單中
-- 這樣套用 migration 後，所有既有活動的行為與套用前完全一致。

ALTER TABLE "temple_events" ADD COLUMN "registrationStartAt" DATE;
ALTER TABLE "temple_events" ADD COLUMN "registrationEndAt" DATE;
ALTER TABLE "temple_events" ADD COLUMN "isRegistrationOpen" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "temple_events" ADD COLUMN "isPrintOpen" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "temple_events" ADD COLUMN "isCompleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "temple_events" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;
