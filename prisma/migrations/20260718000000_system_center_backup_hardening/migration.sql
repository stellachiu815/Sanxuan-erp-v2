-- V11.2.1 系統管理中心｜Google Drive 正式環境驗收與安全補強
-- 對應交付報告《V11.2.1_GoogleDrive正式環境驗收報告.md》。
-- 手寫 SQL（沙盒無法執行 `prisma migrate dev` 自動產生，比照 V11.2 既有慣例）。

ALTER TABLE "google_drive_connections"
  ADD COLUMN "lastVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "lastTestResult" TEXT;

ALTER TABLE "backup_logs"
  ADD COLUMN "currentStage" TEXT,
  ADD COLUMN "failedStage" TEXT,
  ADD COLUMN "errorCode" TEXT,
  ADD COLUMN "sha256Checksum" TEXT,
  ADD COLUMN "sourceEnvironment" TEXT,
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "lastIntegrityCheckAt" TIMESTAMP(3),
  ADD COLUMN "lastIntegrityCheckStatus" TEXT,
  ADD COLUMN "lastIntegrityCheckDetail" TEXT;

ALTER TABLE "system_settings"
  ADD COLUMN "activeBackupLogId" TEXT,
  ADD COLUMN "activeBackupLockExpiresAt" TIMESTAMP(3),
  ADD COLUMN "lastBeforeUpdateCommit" TEXT;
