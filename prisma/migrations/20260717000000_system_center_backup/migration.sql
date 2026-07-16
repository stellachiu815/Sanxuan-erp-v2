-- V11.2「系統管理中心 — 備份與還原中心」新增資料表
-- 對應 prisma/schema.prisma 新增的 GoogleDriveConnection / BackupLog /
-- SystemSetting 三個模型。

-- CreateEnum
CREATE TYPE "BackupType" AS ENUM ('MANUAL', 'DAILY', 'WEEKLY', 'MONTHLY', 'BEFORE_UPDATE');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('IN_PROGRESS', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "google_drive_connections" (
    "id" TEXT NOT NULL DEFAULT 'SINGLETON',
    "boundEmail" TEXT,
    "refreshTokenCipher" TEXT,
    "rootFolderId" TEXT,
    "dailyFolderId" TEXT,
    "weeklyFolderId" TEXT,
    "monthlyFolderId" TEXT,
    "beforeUpdateFolderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3),
    "connectedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_drive_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_logs" (
    "id" TEXT NOT NULL,
    "type" "BackupType" NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "fileName" TEXT,
    "fileSizeBytes" BIGINT,
    "googleDriveFileId" TEXT,
    "googleDriveFolder" TEXT,
    "failureReason" TEXT,
    "executedByUserId" TEXT,
    "executedByName" TEXT NOT NULL,
    "isAutomatic" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL DEFAULT 'SINGLETON',
    "dailyRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "weeklyRetentionWeeks" INTEGER NOT NULL DEFAULT 12,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByName" TEXT,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_logs_type_startedAt_idx" ON "backup_logs"("type", "startedAt");

-- CreateIndex
CREATE INDEX "backup_logs_status_idx" ON "backup_logs"("status");
