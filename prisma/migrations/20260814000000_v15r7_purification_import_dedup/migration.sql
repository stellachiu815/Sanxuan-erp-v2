-- V15R7：普渡 Excel 匯入預檢——每列新增旗標與 DB 去重欄位（純新增、安全預設，不改舊資料語意）。
ALTER TABLE "purification_import_rows"
  ADD COLUMN "syncToHousehold" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "existingMatchStatus" TEXT,
  ADD COLUMN "existingRecordId" TEXT,
  ADD COLUMN "resolutionAction" TEXT;
