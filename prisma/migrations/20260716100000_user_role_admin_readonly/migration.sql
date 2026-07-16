-- V11.1.1「全專案建置、權限與正式封版指令」
-- 擴充既有的 Role enum，新增 ADMIN／READONLY 兩個值（純附加，既有
-- SUPER_ADMIN／STAFF／FINANCE_CLERK 語意不變），讓既有的 User model
-- 可以表示使用者要求的四級操作人員身分（最高管理員／管理員／
-- 一般工作人員／唯讀人員）。不建立任何新資料表——直接沿用專案裡本來就
-- 已經存在的 users 表，不建立第二套互不相通的人員資料。

-- AlterEnum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ADMIN';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'READONLY';
