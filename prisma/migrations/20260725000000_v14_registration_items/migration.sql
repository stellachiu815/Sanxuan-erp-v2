-- V14（第一段）：活動報名多項目架構
--
-- ⚠️ 純附加：只有 CREATE TABLE 與 ALTER TABLE ADD COLUMN，不動任何既有欄位、
-- 不動兩把核心唯一鍵（temple_events / ritual_records），沒有 DROP／UPDATE／
-- DELETE／TRUNCATE。既有普渡、年度燈、祭改、收款資料完全不受影響。

-- 1) 報名項目設定表：主活動底下有哪些可報名項目。
CREATE TABLE "registration_item_types" (
    "id" TEXT NOT NULL,
    "activityType" "ActivityType" NOT NULL,
    "activityGroup" TEXT NOT NULL,
    "activityGroupName" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentKind" TEXT NOT NULL,
    "feeMode" TEXT NOT NULL DEFAULT 'NONE',
    "defaultUnitPrice" DECIMAL(12,2),
    "defaultQuantity" INTEGER NOT NULL DEFAULT 1,
    "allowMultiplePerMember" BOOLEAN NOT NULL DEFAULT false,
    "printDocumentKeys" TEXT[],
    "metadataJson" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registration_item_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "registration_item_types_key_key" ON "registration_item_types"("key");
CREATE INDEX "registration_item_types_activityType_idx" ON "registration_item_types"("activityType");
CREATE INDEX "registration_item_types_activityGroup_idx" ON "registration_item_types"("activityGroup");
CREATE INDEX "registration_item_types_isActive_idx" ON "registration_item_types"("isActive");

-- 2) 報名項目實例表：RitualRecord 的子表，指回既有明細，不建第二套內容表。
CREATE TABLE "ritual_registration_items" (
    "id" TEXT NOT NULL,
    "ritualRecordId" TEXT NOT NULL,
    "registrationItemTypeId" TEXT NOT NULL,
    "memberId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "customName" TEXT,
    "amountDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountUnpaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeChoice" TEXT,
    "linkedEntryId" TEXT,
    "linkedEntryType" TEXT,
    "status" "RitualRecordStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ritual_registration_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ritual_registration_items_ritualRecordId_idx" ON "ritual_registration_items"("ritualRecordId");
CREATE INDEX "ritual_registration_items_registrationItemTypeId_idx" ON "ritual_registration_items"("registrationItemTypeId");
CREATE INDEX "ritual_registration_items_memberId_idx" ON "ritual_registration_items"("memberId");
CREATE INDEX "ritual_registration_items_deletedAt_idx" ON "ritual_registration_items"("deletedAt");

ALTER TABLE "ritual_registration_items"
    ADD CONSTRAINT "ritual_registration_items_ritualRecordId_fkey"
    FOREIGN KEY ("ritualRecordId") REFERENCES "ritual_records"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ritual_registration_items"
    ADD CONSTRAINT "ritual_registration_items_registrationItemTypeId_fkey"
    FOREIGN KEY ("registrationItemTypeId") REFERENCES "registration_item_types"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ritual_registration_items"
    ADD CONSTRAINT "ritual_registration_items_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "members"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3) 可編輯版型結構欄位（沿用既有 template_versions，不建新表）。
ALTER TABLE "template_versions" ADD COLUMN "paperSize" TEXT;
ALTER TABLE "template_versions" ADD COLUMN "orientation" TEXT;
ALTER TABLE "template_versions" ADD COLUMN "marginsJson" JSONB;
ALTER TABLE "template_versions" ADD COLUMN "layoutJson" JSONB;
