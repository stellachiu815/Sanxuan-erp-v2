-- V32 §4 中元普渡列印模板設定表（安全新增；每 documentType 一列，全部 nullable/default）。
-- 不修改既有資料；不建立第二套列印引擎；恢復預設＝刪除該列。
CREATE TABLE IF NOT EXISTS "tablet_template_settings" (
  "documentType" TEXT NOT NULL,
  "offsetXmm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "offsetYmm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "fontFamily" TEXT,
  "fontWeight" TEXT,
  "letterSpacingPx" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lineHeight" DOUBLE PRECISION NOT NULL DEFAULT 1.15,
  "defaultMainText" TEXT,
  "showCalibrationBox" BOOLEAN NOT NULL DEFAULT false,
  "showCropMarks" BOOLEAN NOT NULL DEFAULT false,
  "showWorkNumber" BOOLEAN NOT NULL DEFAULT true,
  "maximize" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByName" TEXT,
  CONSTRAINT "tablet_template_settings_pkey" PRIMARY KEY ("documentType")
);
