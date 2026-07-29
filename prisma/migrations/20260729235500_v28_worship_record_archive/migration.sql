-- V28：家戶祭祀永久資料封存（歷代祖先／乙位正魂）。
-- 只新增兩個可空欄位 + 一個索引，對既有正式資料零影響（既有列 deletedAt 皆為 NULL＝有效）。
-- 不修改、不刪除、不覆蓋任何既有資料。沿用既有軟刪除慣例（deletedAt/deletedByName）。

ALTER TABLE "worship_records" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "worship_records" ADD COLUMN "deletedByName" TEXT;

CREATE INDEX "worship_records_deletedAt_idx" ON "worship_records"("deletedAt");
