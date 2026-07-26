-- V15R5.3 全家燈永久資料共用架構 Phase 2：全家燈「年度不可變快照」兩張專屬表。
--
-- 純新增、向後相容：只 CREATE TABLE（＋索引/FK），不改任何既有表/欄位/資料，其他活動零影響。
-- 永久主資料仍沿用 Household／Member 既有關聯與狀態（不另建永久名單）；本表只保存建立當年度的
-- 實際納入成員、家戶地址、戶主/主要聯絡人快照，日後永久資料變動不改寫舊年度。
--
-- FK 刪除行為（保護歷史快照）：
--   * ritualRegistrationItemId / ritualRecordId → CASCADE（隨年度項目/紀錄一起消滅，一致；兩者皆軟刪不硬刪）
--   * householdId → RESTRICT（家戶軟刪不硬刪，快照保留）
--   * createdByUserId → SET NULL（帳號刪除不影響歷史快照）
--   * FamilyLanternMember.memberId → RESTRICT（成員不得被硬刪而連帶刪除歷史快照）

-- ── family_lantern_registrations（1:1 對應全家燈 RitualRegistrationItem）──
CREATE TABLE "family_lantern_registrations" (
  "id" TEXT NOT NULL,
  "ritualRegistrationItemId" TEXT NOT NULL,
  "ritualRecordId" TEXT NOT NULL,
  "householdId" VARCHAR(10) NOT NULL,
  "year" INTEGER NOT NULL,
  "addressSnapshot" TEXT,
  "contactNameSnapshot" TEXT,
  "contactSourceSnapshot" TEXT,
  "createdByUserId" TEXT,
  "createdByNameSnapshot" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "family_lantern_registrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "family_lantern_registrations_ritualRegistrationItemId_key" ON "family_lantern_registrations"("ritualRegistrationItemId");
CREATE UNIQUE INDEX "family_lantern_registrations_ritualRecordId_householdId_key" ON "family_lantern_registrations"("ritualRecordId", "householdId");
CREATE INDEX "family_lantern_registrations_householdId_idx" ON "family_lantern_registrations"("householdId");
CREATE INDEX "family_lantern_registrations_year_idx" ON "family_lantern_registrations"("year");

ALTER TABLE "family_lantern_registrations"
  ADD CONSTRAINT "family_lantern_registrations_ritualRegistrationItemId_fkey"
  FOREIGN KEY ("ritualRegistrationItemId") REFERENCES "ritual_registration_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "family_lantern_registrations"
  ADD CONSTRAINT "family_lantern_registrations_ritualRecordId_fkey"
  FOREIGN KEY ("ritualRecordId") REFERENCES "ritual_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "family_lantern_registrations"
  ADD CONSTRAINT "family_lantern_registrations_householdId_fkey"
  FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "family_lantern_registrations"
  ADD CONSTRAINT "family_lantern_registrations_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── family_lantern_members（1:N 當年度實際納入成員；memberId 正式 FK，RESTRICT 保護歷史）──
CREATE TABLE "family_lantern_members" (
  "id" TEXT NOT NULL,
  "familyLanternRegistrationId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "memberNameSnapshot" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "family_lantern_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "family_lantern_members_familyLanternRegistrationId_memberId_key" ON "family_lantern_members"("familyLanternRegistrationId", "memberId");
CREATE INDEX "family_lantern_members_memberId_idx" ON "family_lantern_members"("memberId");

ALTER TABLE "family_lantern_members"
  ADD CONSTRAINT "family_lantern_members_familyLanternRegistrationId_fkey"
  FOREIGN KEY ("familyLanternRegistrationId") REFERENCES "family_lantern_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "family_lantern_members"
  ADD CONSTRAINT "family_lantern_members_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
