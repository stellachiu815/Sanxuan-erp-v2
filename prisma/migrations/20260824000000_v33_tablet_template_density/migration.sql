ALTER TABLE "tablet_template_settings"
ADD COLUMN IF NOT EXISTS "density" TEXT NOT NULL DEFAULT 'standard';
