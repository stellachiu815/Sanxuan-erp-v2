-- V30.3b 寶袋作業號碼識別關聯
-- 在 AdditionalPrintItem 增加 nullable registrationItemId，指回自身「增加寶袋」US_POCKET_EXTRA
-- RitualRegistrationItem。作業號碼 registrationOrder 的唯一真值仍只在 RitualRegistrationItem，
-- 本表不新增 registrationOrder 欄位。onDelete SetNull（報名項目刪除只解除關聯、保留列印物件與紀錄）。
--
-- 安全性：純新增 nullable 欄位 + index + FK，不改既有欄位、不觸及收款/財務/地址/牌位資料鏈/
-- printCount/printedAt/Advisory Lock/既有 Unique Index。不含任何 backfill。

ALTER TABLE "additional_print_items"
  ADD COLUMN IF NOT EXISTS "registrationItemId" TEXT;

CREATE INDEX IF NOT EXISTS "additional_print_items_registrationItemId_idx"
  ON "additional_print_items" ("registrationItemId");

ALTER TABLE "additional_print_items"
  ADD CONSTRAINT "additional_print_items_registrationItemId_fkey"
  FOREIGN KEY ("registrationItemId")
  REFERENCES "ritual_registration_items" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
