-- V14.4 Part 6B：普渡 Excel 匯入草稿（純附加、不影響既有正式資料；可重跑）。
-- analyze 只寫這兩張草稿表；confirm 才透過共用正式核心物化正式資料。

CREATE TABLE IF NOT EXISTS "purification_import_batches" (
  "id" TEXT NOT NULL,
  "templeEventId" TEXT,
  "year" INTEGER NOT NULL,
  "originalFilename" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "detectedColumns" JSONB,
  "summary" JSONB,
  "confirmationKey" TEXT,
  "createdByUserId" TEXT,
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purification_import_batches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "purification_import_batches_confirmationKey_key" ON "purification_import_batches" ("confirmationKey");
CREATE INDEX IF NOT EXISTS "purification_import_batches_templeEventId_idx" ON "purification_import_batches" ("templeEventId");
CREATE INDEX IF NOT EXISTS "purification_import_batches_year_idx" ON "purification_import_batches" ("year");
CREATE INDEX IF NOT EXISTS "purification_import_batches_status_idx" ON "purification_import_batches" ("status");

CREATE TABLE IF NOT EXISTS "purification_import_rows" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "rawData" JSONB NOT NULL,
  "normalizedData" JSONB NOT NULL,
  "matchingStatus" TEXT NOT NULL,
  "matchedDevoteeId" TEXT,
  "matchedHouseholdId" TEXT,
  "candidateIds" JSONB,
  "issueCodes" JSONB,
  "issueMessages" JSONB,
  "excluded" BOOLEAN NOT NULL DEFAULT false,
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "createNewDevoteeConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "createNewHouseholdConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "editedData" JSONB,
  "confirmationStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "confirmedRecordId" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purification_import_rows_pkey" PRIMARY KEY ("id")
);
-- 同 batch＋rowNumber 唯一（同一列不會被重複建立）。
CREATE UNIQUE INDEX IF NOT EXISTS "purification_import_rows_batchId_rowNumber_key" ON "purification_import_rows" ("batchId", "rowNumber");
CREATE INDEX IF NOT EXISTS "purification_import_rows_batchId_idx" ON "purification_import_rows" ("batchId");
CREATE INDEX IF NOT EXISTS "purification_import_rows_matchingStatus_idx" ON "purification_import_rows" ("matchingStatus");

DO $$ BEGIN
  ALTER TABLE "purification_import_rows"
    ADD CONSTRAINT "purification_import_rows_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "purification_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
