-- V12.0「信眾關係中心」新增資料模型
-- 對應交付報告《V12.0_資料庫關聯說明.md》。
-- 手寫 SQL（沙盒無法執行 `prisma migrate dev` 自動產生，比照既有慣例——
-- 見 V11.2/V11.2.1 各輪 migration 的說明）。
--
-- 這個 migration「只新增」資料表/型別，不修改、不刪除任何既有欄位或資料，
-- 也不會對 members/households 等既有資料表寫入任何一筆資料（信眾關係中心
-- 的信眾清單直接讀取既有 members 資料表，不複製、不預先幫每位既有成員
-- 建立 DevoteeProfile，見 schema.prisma DevoteeProfile 上方註解）。

-- ============================================================
-- 第一步：新增 Enum
-- ============================================================

-- CreateEnum
CREATE TYPE "DevoteeInteractionType" AS ENUM ('PHONE_CALL', 'LINE_CONTACT', 'VISIT', 'ADDRESS_UPDATE', 'CARE_CONTACT', 'ACTIVITY_INQUIRY', 'RITUAL_INQUIRY', 'OTHER');

-- CreateEnum
CREATE TYPE "DevoteeCareAction" AS ENUM ('FLAGGED', 'UNFLAGGED', 'CONTACTED', 'NOTE_UPDATED');

-- ============================================================
-- 第二步：新增資料表
-- ============================================================

-- CreateTable
CREATE TABLE "devotee_profiles" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "mobile" TEXT,
    "lineId" TEXT,
    "email" TEXT,
    "companyName" TEXT,
    "personalNote" TEXT,
    "isDisabled" BOOLEAN NOT NULL DEFAULT false,
    "disabledReason" TEXT,
    "careFlag" BOOLEAN NOT NULL DEFAULT false,
    "careReason" TEXT,
    "careNote" TEXT,
    "careAssignedToName" TEXT,
    "lastContactedAt" DATE,
    "nextContactSuggestedAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devotee_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devotee_tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSystemDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devotee_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devotee_tag_assignments" (
    "id" TEXT NOT NULL,
    "devoteeProfileId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "assignedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devotee_tag_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devotee_interactions" (
    "id" TEXT NOT NULL,
    "devoteeProfileId" TEXT NOT NULL,
    "interactionType" "DevoteeInteractionType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "followUp" TEXT,
    "nextContactDate" DATE,
    "createdByName" TEXT,
    "updatedByName" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedByName" TEXT,
    "deleteReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devotee_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devotee_care_records" (
    "id" TEXT NOT NULL,
    "devoteeProfileId" TEXT NOT NULL,
    "action" "DevoteeCareAction" NOT NULL,
    "reason" TEXT,
    "assignedToName" TEXT,
    "note" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devotee_care_records_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- 第三步：唯一索引與一般索引
-- ============================================================

-- CreateIndex
CREATE UNIQUE INDEX "devotee_profiles_memberId_key" ON "devotee_profiles"("memberId");

-- CreateIndex
CREATE INDEX "devotee_profiles_isDisabled_idx" ON "devotee_profiles"("isDisabled");

-- CreateIndex
CREATE INDEX "devotee_profiles_careFlag_idx" ON "devotee_profiles"("careFlag");

-- CreateIndex
CREATE UNIQUE INDEX "devotee_tags_name_key" ON "devotee_tags"("name");

-- CreateIndex
CREATE INDEX "devotee_tags_isActive_idx" ON "devotee_tags"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "devotee_tag_assignments_devoteeProfileId_tagId_key" ON "devotee_tag_assignments"("devoteeProfileId", "tagId");

-- CreateIndex
CREATE INDEX "devotee_tag_assignments_devoteeProfileId_idx" ON "devotee_tag_assignments"("devoteeProfileId");

-- CreateIndex
CREATE INDEX "devotee_tag_assignments_tagId_idx" ON "devotee_tag_assignments"("tagId");

-- CreateIndex
CREATE INDEX "devotee_interactions_devoteeProfileId_idx" ON "devotee_interactions"("devoteeProfileId");

-- CreateIndex
CREATE INDEX "devotee_interactions_deletedAt_idx" ON "devotee_interactions"("deletedAt");

-- CreateIndex
CREATE INDEX "devotee_interactions_occurredAt_idx" ON "devotee_interactions"("occurredAt");

-- CreateIndex
CREATE INDEX "devotee_care_records_devoteeProfileId_idx" ON "devotee_care_records"("devoteeProfileId");

-- CreateIndex
CREATE INDEX "devotee_care_records_createdAt_idx" ON "devotee_care_records"("createdAt");

-- ============================================================
-- 第四步：外鍵
-- ============================================================
-- memberId 關聯既有 members 資料表：ON DELETE CASCADE——members 本身走
-- 軟刪除（deletedAt），正常情況下不會真的被硬刪除；只有「回收區永久刪除」
-- 這種明確、罕見的操作才會真的 DELETE FROM members，這種情況下對應的
-- DevoteeProfile（連同其標籤/互動/關懷紀錄）一併清除是合理的，不會留下
-- 指向不存在成員的孤兒資料。

-- AddForeignKey
ALTER TABLE "devotee_profiles" ADD CONSTRAINT "devotee_profiles_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devotee_tag_assignments" ADD CONSTRAINT "devotee_tag_assignments_devoteeProfileId_fkey" FOREIGN KEY ("devoteeProfileId") REFERENCES "devotee_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devotee_tag_assignments" ADD CONSTRAINT "devotee_tag_assignments_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "devotee_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devotee_interactions" ADD CONSTRAINT "devotee_interactions_devoteeProfileId_fkey" FOREIGN KEY ("devoteeProfileId") REFERENCES "devotee_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devotee_care_records" ADD CONSTRAINT "devotee_care_records_devoteeProfileId_fkey" FOREIGN KEY ("devoteeProfileId") REFERENCES "devotee_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 第五步：11 個系統預設標籤（對應指令「八」）
-- ============================================================
-- 這是「標籤定義」的預設資料（isSystemDefault=true），不是信眾個人資料，
-- 不違反「不得大量複製舊資料至新資料表」——這裡沒有複製任何一筆既有的
-- Household/Member 資料，只是建立 11 筆全新的標籤選項供之後套用。

INSERT INTO "devotee_tags" ("id", "name", "isSystemDefault", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES
  ('devotee-tag-vip', 'VIP', true, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('devotee-tag-gongwei', '宮委', true, true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('devotee-tag-dongshi', '董事', true, true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('devotee-tag-yigong', '義工', true, true, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('devotee-tag-shixiong', '師兄', true, true, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('devotee-tag-shijie', '師姐', true, true, 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('devotee-tag-changnian', '長年信眾', true, true, 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('devotee-tag-fahui', '法會常客', true, true, 8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('devotee-tag-care', '需要關懷', true, true, 9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('devotee-tag-jianmiao', '建廟功德主', true, true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('devotee-tag-yongjiu', '永久功德主', true, true, 11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
