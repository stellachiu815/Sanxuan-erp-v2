-- V12.3「家戶管理完整強化」
--
-- 兩項最小變更，都是新增，沒有任何欄位刪除或型別變更，對既有資料零影響：
--
--   1. households 加上「合併至哪一戶」的自我關聯（mergedIntoHouseholdId / mergedAt）
--   2. 新增 household_code_aliases：家戶編號歷史對照
--
-- ⚠️ 兩個外鍵都使用 ON UPDATE CASCADE，跟既有所有指向 households(id) 的外鍵
--    一致——家戶編號是主鍵，修改編號時 PostgreSQL 會自動連動更新。

-- ────────────────────────────────────────────────
-- 1. 家戶合併關聯（自我關聯）
-- ────────────────────────────────────────────────
ALTER TABLE "households" ADD COLUMN "mergedIntoHouseholdId" VARCHAR(10);
ALTER TABLE "households" ADD COLUMN "mergedAt" TIMESTAMP(3);

CREATE INDEX "households_mergedIntoHouseholdId_idx" ON "households"("mergedIntoHouseholdId");

ALTER TABLE "households"
  ADD CONSTRAINT "households_mergedIntoHouseholdId_fkey"
  FOREIGN KEY ("mergedIntoHouseholdId") REFERENCES "households"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ────────────────────────────────────────────────
-- 2. 家戶編號歷史對照
-- ────────────────────────────────────────────────
CREATE TABLE "household_code_aliases" (
    "oldCode" VARCHAR(10) NOT NULL,
    "householdId" VARCHAR(10) NOT NULL,
    "reason" TEXT,
    "operatorUserId" TEXT,
    "operatorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_code_aliases_pkey" PRIMARY KEY ("oldCode")
);

CREATE INDEX "household_code_aliases_householdId_idx" ON "household_code_aliases"("householdId");

ALTER TABLE "household_code_aliases"
  ADD CONSTRAINT "household_code_aliases_householdId_fkey"
  FOREIGN KEY ("householdId") REFERENCES "households"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
