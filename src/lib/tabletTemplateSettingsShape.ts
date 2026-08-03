/**
 * V32 §4 列印模板設定——純資料形狀與預設值（無 Prisma，供 UI／Service／測試共用）。
 * 單一真值來源：預覽與正式列印皆讀同一份設定；未設定時回系統預設。
 */

export type TabletTemplateDocType =
  | "ANCESTOR_LINE"
  | "INDIVIDUAL_SOUL"
  | "DEBT_CREDITOR"
  | "UNBORN_CHILD"
  | "POCKET";

export type TabletTemplateDensity = "standard" | "economy";

export type TabletTemplateSetting = {
  documentType: TabletTemplateDocType;
  /** V33 橫式密度：standard（附件一密度）／economy（省紙）。 */
  density: TabletTemplateDensity;
  offsetXmm: number;
  offsetYmm: number;
  fontFamily: string | null;
  fontWeight: string | null;
  letterSpacingPx: number;
  lineHeight: number;
  defaultMainText: string | null;
  showCalibrationBox: boolean;
  showCropMarks: boolean;
  showWorkNumber: boolean;
  maximize: boolean;
};

export const TEMPLATE_DOC_TYPES: { docType: TabletTemplateDocType; label: string }[] = [
  { docType: "ANCESTOR_LINE", label: "超拔祖先" },
  { docType: "INDIVIDUAL_SOUL", label: "乙位正魂" },
  { docType: "DEBT_CREDITOR", label: "累世冤親債主" },
  { docType: "UNBORN_CHILD", label: "無緣子女" },
  { docType: "POCKET", label: "寶袋" },
];

/** 系統預設（＝未於模板管理儲存時，正式列印採用的值；恢復預設即回到這裡）。 */
export function defaultTemplateSetting(docType: TabletTemplateDocType): TabletTemplateSetting {
  return {
    documentType: docType,
    density: "standard",
    offsetXmm: 0,
    offsetYmm: 0,
    fontFamily: null,
    fontWeight: null,
    letterSpacingPx: 0,
    lineHeight: 1.15,
    defaultMainText: null,
    showCalibrationBox: false,
    showCropMarks: false,
    showWorkNumber: true,
    maximize: false,
  };
}

/** 把 DB 部分列（可能欄位缺漏）合併到預設值上，產生完整設定。 */
export function mergeTemplateSetting(
  docType: TabletTemplateDocType,
  row: Partial<TabletTemplateSetting> | null | undefined
): TabletTemplateSetting {
  const base = defaultTemplateSetting(docType);
  if (!row) return base;
  const defined = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
  return { ...base, ...defined, documentType: docType } as TabletTemplateSetting;
}

/** 清理／驗證使用者輸入（夾在安全範圍；行距 0.8~2、字距 -5~20px、offset -50~50mm）。 */
export function sanitizeTemplateInput(input: Partial<TabletTemplateSetting>): Partial<TabletTemplateSetting> {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const out: Partial<TabletTemplateSetting> = {};
  if (input.density !== undefined) out.density = input.density === "economy" ? "economy" : "standard";
  if (input.offsetXmm !== undefined) out.offsetXmm = clamp(Number(input.offsetXmm) || 0, -50, 50);
  if (input.offsetYmm !== undefined) out.offsetYmm = clamp(Number(input.offsetYmm) || 0, -50, 50);
  if (input.letterSpacingPx !== undefined) out.letterSpacingPx = clamp(Number(input.letterSpacingPx) || 0, -5, 20);
  if (input.lineHeight !== undefined) out.lineHeight = clamp(Number(input.lineHeight) || 1.15, 0.8, 2);
  if (input.fontFamily !== undefined) out.fontFamily = (input.fontFamily ?? "")?.toString().trim() || null;
  if (input.fontWeight !== undefined) out.fontWeight = (input.fontWeight ?? "")?.toString().trim() || null;
  if (input.defaultMainText !== undefined) out.defaultMainText = (input.defaultMainText ?? "")?.toString().trim() || null;
  if (input.showCalibrationBox !== undefined) out.showCalibrationBox = !!input.showCalibrationBox;
  if (input.showCropMarks !== undefined) out.showCropMarks = !!input.showCropMarks;
  if (input.showWorkNumber !== undefined) out.showWorkNumber = !!input.showWorkNumber;
  if (input.maximize !== undefined) out.maximize = !!input.maximize;
  return out;
}
