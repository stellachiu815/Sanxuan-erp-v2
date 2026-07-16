-- V9.0「祭改管理與小人頭貼紙列印」：祭改報名、編號、列印批次的完整資料模型。
-- 純粹附加，不修改任何既有資料表的欄位或關聯。

-- CreateEnum
CREATE TYPE "PurificationRegistrationStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'SUPPLEMENTARY');

-- CreateEnum
CREATE TYPE "PurificationPaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');

-- CreateTable
CREATE TABLE "purification_years" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "copiedFromYearId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purification_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purification_banned_numbers" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purification_banned_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purification_print_batches" (
    "id" TEXT NOT NULL,
    "purificationYearId" TEXT NOT NULL,
    "registrationCount" INTEGER NOT NULL,
    "printedByName" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purification_print_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purification_registrations" (
    "id" TEXT NOT NULL,
    "purificationYearId" TEXT NOT NULL,
    "number" INTEGER,
    "memberId" TEXT,
    "householdId" TEXT,
    "isTemporaryName" BOOLEAN NOT NULL DEFAULT false,
    "manualDisplayName" TEXT,
    "manualGender" TEXT,
    "manualSolarBirthDate" DATE,
    "manualLunarBirthYear" INTEGER,
    "manualLunarBirthMonth" INTEGER,
    "manualLunarBirthDay" INTEGER,
    "manualLunarIsLeapMonth" BOOLEAN NOT NULL DEFAULT false,
    "manualAddress" TEXT,
    "manualPhone" TEXT,
    "paymentStatus" "PurificationPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "paymentAmount" DECIMAL(12,2),
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "status" "PurificationRegistrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "isPrinted" BOOLEAN NOT NULL DEFAULT false,
    "printedAt" TIMESTAMP(3),
    "printBatchId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purification_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purification_years_year_key" ON "purification_years"("year");

-- CreateIndex
CREATE INDEX "purification_years_year_idx" ON "purification_years"("year");

-- CreateIndex
CREATE UNIQUE INDEX "purification_banned_numbers_number_key" ON "purification_banned_numbers"("number");

-- CreateIndex
CREATE INDEX "purification_print_batches_purificationYearId_idx" ON "purification_print_batches"("purificationYearId");

-- CreateIndex
CREATE INDEX "purification_registrations_purificationYearId_status_idx" ON "purification_registrations"("purificationYearId", "status");

-- CreateIndex
CREATE INDEX "purification_registrations_memberId_idx" ON "purification_registrations"("memberId");

-- CreateIndex
CREATE INDEX "purification_registrations_householdId_idx" ON "purification_registrations"("householdId");

-- CreateIndex
CREATE INDEX "purification_registrations_deletedAt_idx" ON "purification_registrations"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "purification_registrations_purificationYearId_number_key" ON "purification_registrations"("purificationYearId", "number");

-- AddForeignKey
ALTER TABLE "purification_print_batches" ADD CONSTRAINT "purification_print_batches_purificationYearId_fkey" FOREIGN KEY ("purificationYearId") REFERENCES "purification_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purification_registrations" ADD CONSTRAINT "purification_registrations_purificationYearId_fkey" FOREIGN KEY ("purificationYearId") REFERENCES "purification_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purification_registrations" ADD CONSTRAINT "purification_registrations_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purification_registrations" ADD CONSTRAINT "purification_registrations_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purification_registrations" ADD CONSTRAINT "purification_registrations_printBatchId_fkey" FOREIGN KEY ("printBatchId") REFERENCES "purification_print_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
