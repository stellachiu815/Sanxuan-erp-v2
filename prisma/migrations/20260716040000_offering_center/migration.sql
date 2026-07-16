-- V10.1「建立供品認捐中心（Offering Center）」
-- 宮慶／四位主祀神明聖誕／普渡／其他法會共用的認捐管理模組。

-- ============================================================
-- 第一步：ActivityType 新增四位主祀神明聖誕
-- ============================================================
-- 原因見 schema.prisma ActivityType enum 上方註解：TempleEvent 既有的
-- @@unique([activityType, year]) 限制同一年度、同一活動類型只能一筆，
-- 因此四位主祀神明聖誕各自用獨立的 enum 值，才能在同一年度內分別建立活動。

ALTER TYPE "ActivityType" ADD VALUE 'GUANDI_BIRTHDAY';
ALTER TYPE "ActivityType" ADD VALUE 'XUANTIAN_BIRTHDAY';
ALTER TYPE "ActivityType" ADD VALUE 'YAOCHI_BIRTHDAY';
ALTER TYPE "ActivityType" ADD VALUE 'ZHONGTAN_BIRTHDAY';

-- ============================================================
-- 第二步：temple_events 新增「壽龜跨供品互斥規則」開關欄位（需求「六」）
-- ============================================================

ALTER TABLE "temple_events" ADD COLUMN "offeringTurtleExclusiveRule" BOOLEAN NOT NULL DEFAULT true;

-- ============================================================
-- 第三步：新增 Enum
-- ============================================================

-- CreateEnum
CREATE TYPE "OfferingUnit" AS ENUM ('ZHI', 'DUI', 'PAN', 'FEN', 'ZU', 'OTHER');

-- CreateEnum
CREATE TYPE "OfferingBehaviorKind" AS ENUM ('TURTLE', 'NOODLE_TOWER', 'LOOSE_PEACH', 'FLORAL', 'GENERIC');

-- CreateEnum
CREATE TYPE "OfferingClaimMode" AS ENUM ('INDIVIDUAL', 'GROUPED');

-- CreateEnum
CREATE TYPE "ActivityOfferingStatus" AS ENUM ('OPEN', 'FULL', 'STOPPED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OfferingClaimStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "OfferingPaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "OfferingReceiptStatus" AS ENUM ('NOT_ISSUED', 'ISSUED', 'REPRINTED');

-- CreateEnum
CREATE TYPE "OfferingPaymentKind" AS ENUM ('PAYMENT', 'REFUND', 'TRANSFER_OUT', 'TRANSFER_IN');

-- CreateEnum
CREATE TYPE "StoveMasterRoleType" AS ENUM ('STOVE_MASTER', 'VICE_STOVE_MASTER');

-- CreateEnum
CREATE TYPE "StoveMasterStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- ============================================================
-- 第四步：新增資料表
-- ============================================================

-- CreateTable
CREATE TABLE "offering_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "behaviorKind" "OfferingBehaviorKind" NOT NULL DEFAULT 'GENERIC',
    "unit" "OfferingUnit" NOT NULL DEFAULT 'OTHER',
    "isChargeable" BOOLEAN NOT NULL DEFAULT true,
    "hasLimitedQuantity" BOOLEAN NOT NULL DEFAULT true,
    "defaultQuantity" INTEGER NOT NULL DEFAULT 1,
    "defaultPrice" DECIMAL(12,2),
    "allowPriceOverride" BOOLEAN NOT NULL DEFAULT true,
    "allowDuplicateClaim" BOOLEAN NOT NULL DEFAULT false,
    "claimMode" "OfferingClaimMode" NOT NULL DEFAULT 'INDIVIDUAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offering_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_offerings" (
    "id" TEXT NOT NULL,
    "templeEventId" TEXT NOT NULL,
    "offeringTypeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(12,2),
    "useDefaultPrice" BOOLEAN NOT NULL DEFAULT true,
    "allowPriceOverride" BOOLEAN NOT NULL DEFAULT true,
    "hasLimitedQuantity" BOOLEAN NOT NULL DEFAULT true,
    "isChargeable" BOOLEAN NOT NULL DEFAULT true,
    "claimMode" "OfferingClaimMode" NOT NULL DEFAULT 'INDIVIDUAL',
    "claimStartDate" DATE,
    "claimEndDate" DATE,
    "status" "ActivityOfferingStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floral_offering_slots" (
    "id" TEXT NOT NULL,
    "activityOfferingId" TEXT NOT NULL,
    "templeEventId" TEXT NOT NULL,
    "lunarMonth" INTEGER NOT NULL,
    "lunarDay" INTEGER NOT NULL,
    "isLeapMonth" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priceOverride" DECIMAL(12,2),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "floral_offering_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offering_claims" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "activityOfferingId" TEXT NOT NULL,
    "offeringTypeId" TEXT NOT NULL,
    "floralSlotId" TEXT,
    "year" INTEGER NOT NULL,
    "sponsorMemberId" TEXT NOT NULL,
    "sponsorHouseholdId" TEXT NOT NULL,
    "sponsorNameSnapshot" TEXT NOT NULL,
    "phoneSnapshot" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2),
    "amountDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountUnpaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paymentStatus" "OfferingPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "receiptStatus" "OfferingReceiptStatus" NOT NULL DEFAULT 'NOT_ISSUED',
    "expectedPaymentDate" DATE,
    "collectionNote" TEXT,
    "note" TEXT,
    "status" "OfferingClaimStatus" NOT NULL DEFAULT 'ACTIVE',
    "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refundReason" TEXT,
    "refundedAt" TIMESTAMP(3),
    "refundedByName" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByName" TEXT,

    CONSTRAINT "offering_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offering_payments" (
    "id" TEXT NOT NULL,
    "offeringClaimId" TEXT NOT NULL,
    "kind" "OfferingPaymentKind" NOT NULL DEFAULT 'PAYMENT',
    "amount" DECIMAL(12,2) NOT NULL,
    "paidOn" DATE NOT NULL,
    "method" TEXT,
    "collectedByName" TEXT,
    "receiptNumber" TEXT,
    "reprintCount" INTEGER NOT NULL DEFAULT 0,
    "lastReprintAt" TIMESTAMP(3),
    "reason" TEXT,
    "relatedClaimId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offering_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stove_master_registrations" (
    "id" TEXT NOT NULL,
    "templeEventId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "roleType" "StoveMasterRoleType" NOT NULL,
    "memberId" TEXT,
    "householdId" TEXT,
    "nameSnapshot" TEXT NOT NULL,
    "phoneSnapshot" TEXT,
    "note" TEXT,
    "status" "StoveMasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stove_master_registrations_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- 第五步：索引
-- ============================================================

-- CreateIndex
CREATE INDEX "offering_types_isActive_idx" ON "offering_types"("isActive");

-- CreateIndex
CREATE INDEX "offering_types_behaviorKind_idx" ON "offering_types"("behaviorKind");

-- CreateIndex
CREATE INDEX "activity_offerings_templeEventId_idx" ON "activity_offerings"("templeEventId");

-- CreateIndex
CREATE INDEX "activity_offerings_offeringTypeId_idx" ON "activity_offerings"("offeringTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "activity_offerings_templeEventId_offeringTypeId_key" ON "activity_offerings"("templeEventId", "offeringTypeId");

-- CreateIndex
CREATE INDEX "floral_offering_slots_templeEventId_idx" ON "floral_offering_slots"("templeEventId");

-- CreateIndex
CREATE INDEX "floral_offering_slots_isActive_idx" ON "floral_offering_slots"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "floral_offering_slots_activityOfferingId_lunarMonth_lunarD_key" ON "floral_offering_slots"("activityOfferingId", "lunarMonth", "lunarDay", "isLeapMonth");

-- CreateIndex
CREATE INDEX "offering_claims_activityId_idx" ON "offering_claims"("activityId");

-- CreateIndex
CREATE INDEX "offering_claims_activityOfferingId_idx" ON "offering_claims"("activityOfferingId");

-- CreateIndex
CREATE INDEX "offering_claims_offeringTypeId_idx" ON "offering_claims"("offeringTypeId");

-- CreateIndex
CREATE INDEX "offering_claims_sponsorMemberId_idx" ON "offering_claims"("sponsorMemberId");

-- CreateIndex
CREATE INDEX "offering_claims_sponsorHouseholdId_idx" ON "offering_claims"("sponsorHouseholdId");

-- CreateIndex
CREATE INDEX "offering_claims_floralSlotId_idx" ON "offering_claims"("floralSlotId");

-- CreateIndex
CREATE INDEX "offering_claims_status_idx" ON "offering_claims"("status");

-- CreateIndex
CREATE INDEX "offering_claims_paymentStatus_idx" ON "offering_claims"("paymentStatus");

-- CreateIndex
CREATE INDEX "offering_claims_year_idx" ON "offering_claims"("year");

-- CreateIndex
CREATE INDEX "offering_claims_deletedAt_idx" ON "offering_claims"("deletedAt");

-- CreateIndex
CREATE INDEX "offering_payments_offeringClaimId_idx" ON "offering_payments"("offeringClaimId");

-- CreateIndex
CREATE INDEX "offering_payments_kind_idx" ON "offering_payments"("kind");

-- CreateIndex
CREATE INDEX "stove_master_registrations_templeEventId_idx" ON "stove_master_registrations"("templeEventId");

-- CreateIndex
CREATE INDEX "stove_master_registrations_status_idx" ON "stove_master_registrations"("status");

-- ============================================================
-- 第六步：外鍵
-- ============================================================

-- AddForeignKey
ALTER TABLE "activity_offerings" ADD CONSTRAINT "activity_offerings_templeEventId_fkey" FOREIGN KEY ("templeEventId") REFERENCES "temple_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_offerings" ADD CONSTRAINT "activity_offerings_offeringTypeId_fkey" FOREIGN KEY ("offeringTypeId") REFERENCES "offering_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floral_offering_slots" ADD CONSTRAINT "floral_offering_slots_activityOfferingId_fkey" FOREIGN KEY ("activityOfferingId") REFERENCES "activity_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floral_offering_slots" ADD CONSTRAINT "floral_offering_slots_templeEventId_fkey" FOREIGN KEY ("templeEventId") REFERENCES "temple_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering_claims" ADD CONSTRAINT "offering_claims_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "temple_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering_claims" ADD CONSTRAINT "offering_claims_activityOfferingId_fkey" FOREIGN KEY ("activityOfferingId") REFERENCES "activity_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering_claims" ADD CONSTRAINT "offering_claims_offeringTypeId_fkey" FOREIGN KEY ("offeringTypeId") REFERENCES "offering_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering_claims" ADD CONSTRAINT "offering_claims_floralSlotId_fkey" FOREIGN KEY ("floralSlotId") REFERENCES "floral_offering_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering_claims" ADD CONSTRAINT "offering_claims_sponsorMemberId_fkey" FOREIGN KEY ("sponsorMemberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering_claims" ADD CONSTRAINT "offering_claims_sponsorHouseholdId_fkey" FOREIGN KEY ("sponsorHouseholdId") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering_payments" ADD CONSTRAINT "offering_payments_offeringClaimId_fkey" FOREIGN KEY ("offeringClaimId") REFERENCES "offering_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stove_master_registrations" ADD CONSTRAINT "stove_master_registrations_templeEventId_fkey" FOREIGN KEY ("templeEventId") REFERENCES "temple_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stove_master_registrations" ADD CONSTRAINT "stove_master_registrations_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stove_master_registrations" ADD CONSTRAINT "stove_master_registrations_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE SET NULL ON UPDATE CASCADE;
