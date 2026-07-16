-- V2.0「祭祀資料核心」：普渡 / 年度燈 / 宮慶未來共用的祭祀紀錄架構。
-- 純粹附加，不修改任何既有資料表。

-- CreateEnum
CREATE TYPE "RitualRecordStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UniversalSalvationEntryCategory" AS ENUM ('ANCESTOR_LINE', 'INDIVIDUAL_SOUL', 'DEBT_CREDITOR', 'UNBORN_CHILD');

-- CreateTable
CREATE TABLE "ritual_records" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "memberId" TEXT,
    "year" INTEGER NOT NULL,
    "activityType" "ActivityType" NOT NULL,
    "status" "RitualRecordStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ritual_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "universal_salvation_details" (
    "id" TEXT NOT NULL,
    "ritualRecordId" TEXT NOT NULL,
    "isRegistered" BOOLEAN NOT NULL DEFAULT false,
    "yangshangName" TEXT,
    "enshrinementLocation" TEXT,
    "isSponsor" BOOLEAN NOT NULL DEFAULT false,
    "sponsorQuantity" INTEGER,
    "sponsorUnitPrice" DECIMAL(12,2),
    "sponsorAmount" DECIMAL(12,2),
    "sponsorNotes" TEXT,
    "tableNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "universal_salvation_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "universal_salvation_entries" (
    "id" TEXT NOT NULL,
    "universalSalvationId" TEXT NOT NULL,
    "category" "UniversalSalvationEntryCategory" NOT NULL,
    "displayName" TEXT NOT NULL,
    "yangshangName" TEXT,
    "worshipRecordId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "universal_salvation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ritual_records_householdId_idx" ON "ritual_records"("householdId");

-- CreateIndex
CREATE INDEX "ritual_records_year_activityType_idx" ON "ritual_records"("year", "activityType");

-- CreateIndex
CREATE UNIQUE INDEX "ritual_records_householdId_year_activityType_key" ON "ritual_records"("householdId", "year", "activityType");

-- CreateIndex
CREATE UNIQUE INDEX "universal_salvation_details_ritualRecordId_key" ON "universal_salvation_details"("ritualRecordId");

-- CreateIndex
CREATE INDEX "universal_salvation_entries_universalSalvationId_idx" ON "universal_salvation_entries"("universalSalvationId");

-- CreateIndex
CREATE INDEX "universal_salvation_entries_category_idx" ON "universal_salvation_entries"("category");

-- AddForeignKey
ALTER TABLE "ritual_records" ADD CONSTRAINT "ritual_records_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ritual_records" ADD CONSTRAINT "ritual_records_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "universal_salvation_details" ADD CONSTRAINT "universal_salvation_details_ritualRecordId_fkey" FOREIGN KEY ("ritualRecordId") REFERENCES "ritual_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "universal_salvation_entries" ADD CONSTRAINT "universal_salvation_entries_universalSalvationId_fkey" FOREIGN KEY ("universalSalvationId") REFERENCES "universal_salvation_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "universal_salvation_entries" ADD CONSTRAINT "universal_salvation_entries_worshipRecordId_fkey" FOREIGN KEY ("worshipRecordId") REFERENCES "worship_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
