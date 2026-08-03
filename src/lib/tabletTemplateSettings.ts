import { prisma } from "@/lib/prisma";
import {
  defaultTemplateSetting,
  mergeTemplateSetting,
  sanitizeTemplateInput,
  TEMPLATE_DOC_TYPES,
  type TabletTemplateDocType,
  type TabletTemplateSetting,
} from "@/lib/tabletTemplateSettingsShape";
import { isOffsetWithinBounds, type TabletDocumentType } from "@/components/ritual/tablets/universalSalvationTabletA4";

export { TEMPLATE_DOC_TYPES } from "@/lib/tabletTemplateSettingsShape";
export type { TabletTemplateSetting, TabletTemplateDocType } from "@/lib/tabletTemplateSettingsShape";

/**
 * V32 §4 列印模板設定資料存取（raw SQL；欄位由 migration 部署，沙盒無法 prisma generate）。
 * 表不存在或查詢失敗 → 一律回系統預設（服務不因新表未部署而中斷；預覽/列印照常用預設值）。
 */

const DOC_TYPES = TEMPLATE_DOC_TYPES.map((t) => t.docType);

type Row = {
  documentType: string;
  density: string | null;
  offsetXmm: number | null;
  offsetYmm: number | null;
  fontFamily: string | null;
  fontWeight: string | null;
  letterSpacingPx: number | null;
  lineHeight: number | null;
  defaultMainText: string | null;
  showCalibrationBox: boolean | null;
  showCropMarks: boolean | null;
  showWorkNumber: boolean | null;
  maximize: boolean | null;
};

function rowToSetting(docType: TabletTemplateDocType, r: Row | undefined): TabletTemplateSetting {
  return mergeTemplateSetting(docType, r as Partial<TabletTemplateSetting> | undefined);
}

/** 取所有模板設定（缺列回預設）。表不存在→全預設。 */
export async function getAllTabletTemplateSettings(): Promise<TabletTemplateSetting[]> {
  let rows: Row[] = [];
  try {
    rows = await prisma.$queryRaw<Row[]>`SELECT * FROM "tablet_template_settings"`;
  } catch {
    rows = [];
  }
  const byType = new Map(rows.map((r) => [r.documentType, r]));
  return DOC_TYPES.map((d) => rowToSetting(d, byType.get(d)));
}

/** 取單一模板設定（缺列回預設）。 */
export async function getTabletTemplateSetting(docType: TabletTemplateDocType): Promise<TabletTemplateSetting> {
  let rows: Row[] = [];
  try {
    rows = await prisma.$queryRaw<Row[]>`SELECT * FROM "tablet_template_settings" WHERE "documentType" = ${docType}`;
  } catch {
    rows = [];
  }
  return rowToSetting(docType, rows[0]);
}

export type SaveTemplateResult =
  | { ok: true; setting: TabletTemplateSetting }
  | { ok: false; status: number; error: string };

/**
 * 儲存單一模板設定（upsert）。先夾安全範圍，再檢查 offset 未使版面超出 Safe Area（3mm 安全邊界），
 * 否則拒絕（不破壞裁切安全）。表不存在時回明確錯誤（提示需先部署 migration）。
 */
export async function saveTabletTemplateSetting(
  docType: TabletTemplateDocType,
  input: Partial<TabletTemplateSetting>,
  byName: string | null
): Promise<SaveTemplateResult> {
  if (!DOC_TYPES.includes(docType)) return { ok: false, status: 400, error: "未知的模板類型" };

  const current = await getTabletTemplateSetting(docType);
  const patch = sanitizeTemplateInput(input);
  const next: TabletTemplateSetting = { ...current, ...patch, documentType: docType };

  // Safe Area 保護：offset 不得使任一區塊超出 3mm 安全區。
  const offset = { offsetXmm: next.offsetXmm, offsetYmm: next.offsetYmm };
  if (!isOffsetWithinBounds(docType as TabletDocumentType, offset)) {
    return { ok: false, status: 422, error: "X／Y Offset 會使版面超出安全邊界（3mm），已拒絕儲存以保護裁切安全。請縮小位移。" };
  }

  try {
    await prisma.$executeRaw`
      INSERT INTO "tablet_template_settings"
        ("documentType","density","offsetXmm","offsetYmm","fontFamily","fontWeight","letterSpacingPx","lineHeight","defaultMainText","showCalibrationBox","showCropMarks","showWorkNumber","maximize","updatedAt","updatedByName")
      VALUES
        (${docType},${next.density},${next.offsetXmm},${next.offsetYmm},${next.fontFamily},${next.fontWeight},${next.letterSpacingPx},${next.lineHeight},${next.defaultMainText},${next.showCalibrationBox},${next.showCropMarks},${next.showWorkNumber},${next.maximize},CURRENT_TIMESTAMP,${byName})
      ON CONFLICT ("documentType") DO UPDATE SET
        "density" = EXCLUDED."density",
        "offsetXmm" = EXCLUDED."offsetXmm",
        "offsetYmm" = EXCLUDED."offsetYmm",
        "fontFamily" = EXCLUDED."fontFamily",
        "fontWeight" = EXCLUDED."fontWeight",
        "letterSpacingPx" = EXCLUDED."letterSpacingPx",
        "lineHeight" = EXCLUDED."lineHeight",
        "defaultMainText" = EXCLUDED."defaultMainText",
        "showCalibrationBox" = EXCLUDED."showCalibrationBox",
        "showCropMarks" = EXCLUDED."showCropMarks",
        "showWorkNumber" = EXCLUDED."showWorkNumber",
        "maximize" = EXCLUDED."maximize",
        "updatedAt" = CURRENT_TIMESTAMP,
        "updatedByName" = EXCLUDED."updatedByName"`;
  } catch {
    return { ok: false, status: 503, error: "模板設定表尚未就緒（tablet_template_settings）。請先於正式資料庫部署 V32 模板設定 migration 後再儲存。" };
  }
  return { ok: true, setting: next };
}

/** 恢復系統預設（刪除該列）。 */
export async function resetTabletTemplateSetting(docType: TabletTemplateDocType): Promise<SaveTemplateResult> {
  if (!DOC_TYPES.includes(docType)) return { ok: false, status: 400, error: "未知的模板類型" };
  try {
    await prisma.$executeRaw`DELETE FROM "tablet_template_settings" WHERE "documentType" = ${docType}`;
  } catch {
    // 表不存在＝本就是預設，視為成功。
  }
  return { ok: true, setting: defaultTemplateSetting(docType) };
}
