/**
 * V30.5 牌位「地址」直式文字的兩行向下對齊（純函式，無 React，便於單元測試）。
 *
 * 需求：地址維持直式；地址分兩行（兩直行）時，第二（較短）行要**向下對齊**，使兩行底部視覺一致；
 * 單行地址不受影響（維持置中）。只調整**既有地址 Bounding Box 內**的文字垂直排列——
 * 不改地址區塊 x/y、寬高，不改主文／陽上人／每頁數量／裁切。
 *
 * 實作原理：直式文字（writing-mode: vertical-rl）在固定高度盒內會自動折行成多「直行」（inline 軸＝
 * 上→下）。`text-align: end` 會把**最後一行（較短的第二行）**沿 inline-end（底部）對齊，而已填滿的
 * 第一行不受影響 → 兩行底部齊平。單行時維持 `center` 置中，避免影響單行外觀。
 */

/** 每一直行可容納的字數（依盒高 mm 與字級 px 估算；1mm≈3.7795px，行高 1.15）。 */
export function charsPerColumn(boxHeightMm: number, fontPx: number): number {
  const PX_PER_MM = 3.7795275591;
  const advancePx = fontPx * 1.15; // 每字直向前進量（含行高）
  if (advancePx <= 0) return 1;
  return Math.max(1, Math.floor((boxHeightMm * PX_PER_MM) / advancePx));
}

/** 估算直式文字會折成幾行（幾直行）。空字串回 0。 */
export function estimateVerticalLineCount(charCount: number, boxHeightMm: number, fontPx: number): number {
  if (charCount <= 0) return 0;
  return Math.ceil(charCount / charsPerColumn(boxHeightMm, fontPx));
}

/**
 * 地址直式文字的 text-align：
 *   - 折成 ≥2 行 → "end"（第二行向下對齊，兩行底部齊平）。
 *   - 單行（或空）→ "center"（維持置中，不影響單行）。
 */
export function addressVerticalAlign(
  charCount: number,
  boxHeightMm: number,
  fontPx: number
): "center" | "end" {
  return estimateVerticalLineCount(charCount, boxHeightMm, fontPx) >= 2 ? "end" : "center";
}

/**
 * 直式文字內層樣式（component 與測試共用同一份，確保測到的就是實際 render 的 CSS）。
 * 地址 15mm×150mm 是「文字可容納最大 Bounding Box」——這裡只決定盒**內**垂直排列，
 * 不含任何外框、不改盒尺寸；height:100% 讓 inline 軸＝盒高，text-align:end 才能把短的第二行沿底部對齊。
 */
export function verticalTextInnerStyle(
  align: "center" | "end" | "start",
  sizePx: number,
  soft: boolean,
  /** V32 §4 模板可調樣式（未提供時維持既有預設，確保未設定模板時輸出不變）。 */
  style?: { fontFamily?: string | null; fontWeight?: string | null; letterSpacingPx?: number | null; lineHeight?: number | null }
) {
  const base = {
    writingMode: "vertical-rl" as const,
    textOrientation: "mixed" as const,
    fontSize: sizePx,
    lineHeight: style?.lineHeight ?? 1.15,
    textAlign: align,
    height: "100%",
    color: soft ? "#333" : "#000",
  };
  const extra: Record<string, string> = {};
  if (style?.fontFamily) extra.fontFamily = style.fontFamily;
  if (style?.fontWeight) extra.fontWeight = style.fontWeight;
  if (style?.letterSpacingPx != null && style.letterSpacingPx !== 0) extra.letterSpacing = `${style.letterSpacingPx}px`;
  return { ...base, ...extra };
}
