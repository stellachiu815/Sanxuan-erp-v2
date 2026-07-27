-- V15R8：普渡列印管理——RitualRegistrationItem 新增最後列印時間與操作人（純新增、nullable、不回填、不改舊語意）。
ALTER TABLE "ritual_registration_items"
  ADD COLUMN "lastPrintedAt" TIMESTAMP(3),
  ADD COLUMN "printedByUserId" TEXT,
  ADD COLUMN "printedByName" TEXT;
