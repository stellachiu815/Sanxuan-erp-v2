-- V13.4（第二段）：年度燈財務表 + RitualRecord 報名來源 + TempleEvent 報名表型態
--
-- ⚠️ 純附加：CREATE TABLE ×1、ADD COLUMN ×3（全部 nullable）。
-- 既有資料列取得 NULL，行為與套用前完全一致。

-- ── 1. 年度燈財務 ────────────────────────────────────────
-- 只放金額。列印所需的農曆生日、虛歲、生肖、太歲在 ritual_participants，
-- 每位成員各自一份（全家燈不能用代表人的快照代替全戶）。
CREATE TABLE "lantern_registrations" (
    "id" TEXT NOT NULL,
    "ritualRecordId" TEXT NOT NULL,
    "amountDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountUnpaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lantern_registrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lantern_registrations_ritualRecordId_key"
    ON "lantern_registrations"("ritualRecordId");

ALTER TABLE "lantern_registrations"
    ADD CONSTRAINT "lantern_registrations_ritualRecordId_fkey"
    FOREIGN KEY ("ritualRecordId") REFERENCES "ritual_records"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 2. 報名來源（取代原設計的 isInitiator） ──────────────────
-- 發起人不等於參加人，且同一筆報名可能被多次編輯，所以來源記在主檔上，
-- 不記在成員明細。操作人與時間沿用既有 record_versions，不重複保存。
ALTER TABLE "ritual_records" ADD COLUMN "registrationSource" TEXT;
ALTER TABLE "ritual_records" ADD COLUMN "copiedFromRitualRecordId" TEXT;

-- ── 3. 報名表型態 ──────────────────────────────────────────
-- NULL 代表「尚未設定報名表」→ 畫面禁止確認報名。
-- 刻意不給預設值：不得因為找不到編輯器就自動降級成通用參加型。
ALTER TABLE "temple_events" ADD COLUMN "registrationFormType" TEXT;
