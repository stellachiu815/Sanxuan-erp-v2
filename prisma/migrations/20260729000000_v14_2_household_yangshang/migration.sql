-- V14.2：家戶固定陽上人名單（household_yangshang）。
--
-- ⚠️ 純附加、向下相容：只新增一張新表，不動任何既有資料表與資料。
-- 沿用既有 Household 一對多（onDelete CASCADE，比照 household_code_aliases）。
-- @@unique([householdId, name]) 保證「同一戶同一位陽上人只建立一次」。
CREATE TABLE IF NOT EXISTS "household_yangshang" (
    "id" TEXT NOT NULL,
    "householdId" VARCHAR(10) NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "household_yangshang_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "household_yangshang_householdId_name_key"
    ON "household_yangshang" ("householdId", "name");

CREATE INDEX IF NOT EXISTS "household_yangshang_householdId_idx"
    ON "household_yangshang" ("householdId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'household_yangshang_householdId_fkey'
  ) THEN
    ALTER TABLE "household_yangshang"
      ADD CONSTRAINT "household_yangshang_householdId_fkey"
      FOREIGN KEY ("householdId") REFERENCES "households" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
