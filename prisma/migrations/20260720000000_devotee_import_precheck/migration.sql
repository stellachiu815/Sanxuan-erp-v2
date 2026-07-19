-- V11.3「信眾資料匯入預檢中心」
-- 手寫 SQL（沙盒無法連線資料庫執行 `prisma migrate dev` 自動產生，比照既有
-- 慣例——見 V11.1.1/V12.0 等各輪 migration 的說明）。
--
-- 這個 migration 全部都是「單純加法」，不修改、不刪除、不重新命名任何既有
-- 欄位或 enum 值，也不會對現有資料列造成任何欄位遺失或型別轉換風險：
--   1. households 新增 mobile（可為 null，跟既有 phone 分開存）。
--   2. members 新增 birthHour（可為 null）。
--   3. ImportRowStatus enum 新增 6 個值，既有 4 個值（OK/ERROR/
--      DUPLICATE_PENDING/IMPORTED）完全不動，舊的家戶批次匯入不受影響。
--   4. 新增 ImportRowResolutionDecision enum（全新型別，不影響既有型別）。
--   5. import_rows 新增 6 個欄位（全部可為 null），供「信眾資料匯入預檢
--      中心」記錄人工對疑似重複/待確認家戶做出的最終決定；舊的家戶批次
--      匯入這幾欄一律是 null，不受影響。

-- ============================================================
-- 一、Household 新增手機欄位
-- ============================================================

ALTER TABLE "households" ADD COLUMN "mobile" TEXT;

-- ============================================================
-- 二、Member 新增出生時辰欄位
-- ============================================================

ALTER TABLE "members" ADD COLUMN "birthHour" TEXT;

-- ============================================================
-- 三、ImportRowStatus 新增狀態值（純加法，既有 4 個值語意不變）
-- ============================================================

ALTER TYPE "ImportRowStatus" ADD VALUE IF NOT EXISTS 'READY_TO_IMPORT';
ALTER TYPE "ImportRowStatus" ADD VALUE IF NOT EXISTS 'SUSPECTED_DUPLICATE';
ALTER TYPE "ImportRowStatus" ADD VALUE IF NOT EXISTS 'INCOMPLETE_DATA';
ALTER TYPE "ImportRowStatus" ADD VALUE IF NOT EXISTS 'FORMAT_ERROR';
ALTER TYPE "ImportRowStatus" ADD VALUE IF NOT EXISTS 'HOUSEHOLD_UNCERTAIN';
ALTER TYPE "ImportRowStatus" ADD VALUE IF NOT EXISTS 'EXCLUDED';

-- ============================================================
-- 四、新增 ImportRowResolutionDecision enum
-- ============================================================

CREATE TYPE "ImportRowResolutionDecision" AS ENUM ('CONFIRMED_DUPLICATE', 'CONFIRMED_NOT_DUPLICATE', 'ASSIGN_HOUSEHOLD', 'SKIP');

-- ============================================================
-- 五、ImportRow 新增人工決定欄位（候選比對結果本身刻意不落地保存，
-- 只保存「人已經做出的最終決定」，見 schema.prisma 註解）
-- ============================================================

ALTER TABLE "import_rows"
  ADD COLUMN "resolutionDecision" "ImportRowResolutionDecision",
  ADD COLUMN "resolutionHouseholdId" TEXT,
  ADD COLUMN "resolutionMemberId" TEXT,
  ADD COLUMN "resolutionNote" TEXT,
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedByName" TEXT;
