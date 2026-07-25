/**
 * V15R4：全家燈依家戶成員人數（6～13）自動對應建議套版層級（純函式，可 tsx 測）。
 *
 * 目前系統只有單一全家燈套版檔，尚未有多層級版型檔（依先前指令「先停止新增新套版」）。
 * 這裡先提供「依人數自動判定的建議套版層級」供 picker 顯示與後續套版沿用；實際多層級
 * 版型檔製作屬列印版型工作，之後補上時只需替換對應 TemplateDefinition，不動這支邏輯。
 *
 * 層級切點：6～8 人＝小版；9～11 人＝中版；12～13 人＝大版（人數上限 13）。
 */
export type FamilyLanternTier = "SMALL" | "MEDIUM" | "LARGE";

export function familyLanternTier(memberCount: number): FamilyLanternTier {
  if (memberCount <= 8) return "SMALL";
  if (memberCount <= 11) return "MEDIUM";
  return "LARGE";
}

export function familyLanternTierLabel(memberCount: number): string {
  switch (familyLanternTier(memberCount)) {
    case "SMALL":
      return "建議套版：小版（6～8 人）";
    case "MEDIUM":
      return "建議套版：中版（9～11 人）";
    case "LARGE":
      return "建議套版：大版（12～13 人）";
  }
}
