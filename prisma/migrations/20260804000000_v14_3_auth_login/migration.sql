-- V14.3 正式登入系統：User 密碼／登入帳號、Session、稽核動作。
--
-- ⚠️ 純附加、向下相容：既有 users 一律 passwordHash/loginId = NULL（需管理員設定
-- 密碼後才能登入）；新增 sessions 表；AuditAction enum 追加登入相關動作。不動既有資料。

-- 1. User 新增欄位
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "loginId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "users_loginId_key" ON "users" ("loginId");

-- 2. AuditAction 追加登入相關動作（enum ADD VALUE，純附加）
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LOGIN';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LOGOUT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DISABLE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ENABLE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RESET_PASSWORD';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CHANGE_ROLE';

-- 3. sessions 表
CREATE TABLE IF NOT EXISTS "sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_key" ON "sessions" ("token");
CREATE INDEX IF NOT EXISTS "sessions_userId_idx" ON "sessions" ("userId");
CREATE INDEX IF NOT EXISTS "sessions_expiresAt_idx" ON "sessions" ("expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'sessions_userId_fkey'
  ) THEN
    ALTER TABLE "sessions"
      ADD CONSTRAINT "sessions_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
