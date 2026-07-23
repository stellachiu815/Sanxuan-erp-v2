/**
 * V14.1：陽上人姓名處理（純函式、零相依，可直接用 node 測試）。
 *
 * 兩件事集中在這裡，畫面／API／列印模板都呼叫，不各自拼接：
 *  1. normalizeYangshangNames：清理姓名陣列（去空白、去空字串、去完全重複、保留順序）。
 *  2. formatYangshangAcclaim：列印組字「王大明、陳小美、李阿姨叩薦」。
 */

/**
 * 清理陽上人姓名陣列：
 *  - 去除每個姓名前後空白
 *  - 移除空字串
 *  - 移除「完全相同」的重複姓名（保留第一次出現的順序）
 *  - 保留使用者排列順序
 *
 * 不接受非陣列（回空陣列），不因空陣列丟錯。
 */
export function normalizeYangshangNames(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * 陽上人列印組字：姓名以「、」相連，最後接一次「叩薦」。
 *  - ["王大明","陳小美","李阿姨"] → "王大明、陳小美、李阿姨叩薦"
 *  - ["王大明"]                   → "王大明叩薦"
 *  - []／null／undefined          → ""（不輸出 undefined／null／空逗號／多餘「叩薦」）
 *
 * ⚠️ 不加任何親屬稱謂（孝男／孝媳／孝孫／陽上人／家戶成員…）。
 */
export function formatYangshangAcclaim(names: readonly string[] | null | undefined): string {
  const clean = normalizeYangshangNames(names ?? []);
  if (clean.length === 0) return "";
  return `${clean.join("、")}叩薦`;
}

/**
 * 讀取相容：優先用 yangshangNames；為空時以舊的單一 yangshangName 補成陣列。
 * 兩者皆空回空陣列。用於 API 回傳與列印，確保舊資料不遺失。
 */
export function resolveYangshangNames(
  yangshangNames: readonly string[] | null | undefined,
  legacyYangshangName: string | null | undefined
): string[] {
  const arr = normalizeYangshangNames(yangshangNames ?? []);
  if (arr.length > 0) return arr;
  const legacy = (legacyYangshangName ?? "").trim();
  return legacy ? [legacy] : [];
}
