-- V14（第四段）：報名項目列印追蹤欄位
--
-- ⚠️ 純附加：只有 ADD COLUMN，皆有預設值／可空，既有資料不受影響。
-- 補印只增加 printCount，不改任何收款金額或狀態。
ALTER TABLE "ritual_registration_items" ADD COLUMN "printedAt" TIMESTAMP(3);
ALTER TABLE "ritual_registration_items" ADD COLUMN "printCount" INTEGER NOT NULL DEFAULT 0;
