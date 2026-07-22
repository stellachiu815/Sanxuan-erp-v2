-- V13.4（第一段）：報名成員明細 ritual_participants
--
-- ⚠️ 純附加：只有 CREATE TABLE 與 CREATE INDEX，不動任何既有資料表的既有欄位，
-- 沒有 UPDATE／DELETE／DROP。既有資料完全不受影響，Render 線上部署安全。
--
-- ⚠️ memberId 的外鍵刻意用 ON DELETE RESTRICT（不是 CASCADE）：
-- src/lib/recycleBin.ts 會執行 Member 的永久刪除，若用 CASCADE，
-- 刪一位信眾會讓他所有歷史活動報名一起消失。Restrict 讓「有報名紀錄的
-- 信眾無法被永久刪除」，保護財務與稽核資料。

CREATE TABLE "ritual_participants" (
    "id" TEXT NOT NULL,
    "ritualRecordId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,

    "nameSnapshot" TEXT NOT NULL,
    "addressSnapshot" TEXT,

    "lunarBirthYearSnapshot" INTEGER,
    "lunarBirthMonthSnapshot" INTEGER,
    "lunarBirthDaySnapshot" INTEGER,
    "lunarIsLeapMonthSnapshot" BOOLEAN NOT NULL DEFAULT false,
    "nominalAgeSnapshot" INTEGER,
    "zodiacSnapshot" TEXT,
    "taisuiSnapshot" TEXT,
    "printProfileSnapshotAt" TIMESTAMP(3),
    "printProfileVersion" INTEGER NOT NULL DEFAULT 0,

    "notes" TEXT,

    "deletedAt" TIMESTAMP(3),
    "deletedByName" TEXT,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ritual_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ritual_participants_ritualRecordId_memberId_key"
    ON "ritual_participants"("ritualRecordId", "memberId");
CREATE INDEX "ritual_participants_memberId_idx" ON "ritual_participants"("memberId");
CREATE INDEX "ritual_participants_ritualRecordId_idx" ON "ritual_participants"("ritualRecordId");
CREATE INDEX "ritual_participants_deletedAt_idx" ON "ritual_participants"("deletedAt");

ALTER TABLE "ritual_participants"
    ADD CONSTRAINT "ritual_participants_ritualRecordId_fkey"
    FOREIGN KEY ("ritualRecordId") REFERENCES "ritual_records"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ritual_participants"
    ADD CONSTRAINT "ritual_participants_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "members"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
