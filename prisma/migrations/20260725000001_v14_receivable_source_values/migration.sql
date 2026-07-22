-- V14（第二段）：收款來源新增列舉值（多項目架構的收費項目）
--
-- ⚠️ PostgreSQL 限制：新增的 enum 值不能在「新增它的同一個交易」裡被使用。
-- 因此這幾個 ADD VALUE 一律獨立成這支 migration，與建表、與後續使用它們的
-- 程式分開部署。純附加，不影響既有列舉值與既有資料。
ALTER TYPE "ReceivableSourceType" ADD VALUE 'RICE_REGISTRATION';
ALTER TYPE "ReceivableSourceType" ADD VALUE 'CELEBRATION_TABLE';
ALTER TYPE "ReceivableSourceType" ADD VALUE 'DRAGON_PHOENIX_LANTERN';
ALTER TYPE "ReceivableSourceType" ADD VALUE 'STORAGE_TROUSERS';

-- 龍鳳燈需要一個對應的活動類型（既有 ActivityType 沒有）。同樣是 enum
-- ADD VALUE，與上面同一支獨立 migration，不在同交易內被使用。
ALTER TYPE "ActivityType" ADD VALUE 'DRAGON_PHOENIX_LANTERN';
