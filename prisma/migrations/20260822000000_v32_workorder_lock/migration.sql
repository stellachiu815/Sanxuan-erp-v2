-- V32 正式作業編號「鎖定」狀態（範圍＝活動＋報名項目；不塞進單筆 item）。
-- 純新增資料表，不改既有欄位/資料。程式端對此表讀取採容錯（表不存在時視為未鎖定），
-- 故本 migration 未部署前不會破壞既有功能；部署後鎖定即持久化。
CREATE TABLE IF NOT EXISTS "workorder_locks" (
  "templeEventId" TEXT NOT NULL,
  "registrationItemTypeId" TEXT NOT NULL,
  "locked" BOOLEAN NOT NULL DEFAULT true,
  "lockedByName" TEXT,
  "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("templeEventId", "registrationItemTypeId")
);
