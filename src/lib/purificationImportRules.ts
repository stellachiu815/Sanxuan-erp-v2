/**
 * V14.4 Part 6B「普渡 Excel 匯入」純規則（不 import Prisma，可 tsx 直接測）。
 *
 * 只負責「跟資料庫無關」的部分：欄位別名對應、多位陽上人解析、保守匹配的
 * 狀態分類（候選信眾由呼叫端查 DB 後傳入）、白米匯入規則。真正查資料庫比對
 * 與正式建立在 src/lib/purificationImport.ts（confirm 一律走既有共用正式核心：
 * createUniversalSalvationEntry / ensureLinkedTabletItem / ensureTabletPrintObjects /
 * registerRice / receivableAdapters），這裡不重寫第二套建立邏輯。
 */

// ============================================================
// 一、欄位別名對應（analyze 需回報實際對應欄位，不默默猜錯）
// ============================================================

export type PurificationImportField =
  | "householdCode" | "householdName" | "primaryContact" | "devoteeName" | "phone" | "address"
  | "tabletCategory" | "tabletName" | "yangshang" | "tabletAddress"
  | "riceKg" | "extraPocketQty" | "sponsor" | "sponsorDonation" | "sponsorCustomName" | "companyName" | "note";

/** 各欄位可接受的中文別名（可擴充；analyze 會回報實際命中的原始欄名）。 */
export const FIELD_ALIASES: Record<PurificationImportField, string[]> = {
  householdCode: ["家戶編號", "戶號", "家戶代號"],
  householdName: ["戶名", "家戶名稱"],
  primaryContact: ["主要聯絡人", "聯絡人", "戶長"],
  devoteeName: ["信眾姓名", "姓名", "報名人"],
  phone: ["電話", "手機", "聯絡電話"],
  address: ["地址", "聯絡地址", "戶籍地址"],
  tabletCategory: ["牌位類型", "牌位分類", "類別"],
  tabletName: ["牌位姓名", "牌位名稱", "祭祀名稱"],
  yangshang: ["陽上", "陽上人", "陽上人姓名"],
  tabletAddress: ["牌位地址", "疏文地址"],
  riceKg: ["白米斤數", "白米", "斤數"],
  extraPocketQty: ["額外寶袋", "額外寶袋數量", "加寶袋"],
  sponsor: ["贊普", "贊普數量"],
  sponsorDonation: ["隨喜贊普", "隨喜"],
  sponsorCustomName: ["贊普姓名", "贊普名稱"],
  companyName: ["公司名稱", "公司", "商號"],
  note: ["備註", "說明"],
};

/** 依表頭原始欄名解析出「欄位 → 實際命中的原始欄名」對應（供 analyze 顯示）。 */
export function resolveColumnMapping(headers: string[]): Partial<Record<PurificationImportField, string>> {
  const norm = (s: string) => s.replace(/\s+/g, "").trim();
  const map: Partial<Record<PurificationImportField, string>> = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [PurificationImportField, string[]][]) {
    const hit = headers.find((h) => aliases.some((a) => norm(h) === norm(a)));
    if (hit) map[field] = hit;
  }
  return map;
}

// ============================================================
// 二、多位陽上人解析（逗號／中文逗號／頓號／換行 → 陣列，存 yangshangNames[]）
// ============================================================

export function parseYangshangNames(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return String(raw)
    .split(/[,，、\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ============================================================
// 三、白米匯入規則：只採用斤數（單價/金額/已收/剩餘/超額一律忽略）
// ============================================================

/** Excel 只匯入白米斤數；其餘白米欄位（單價/金額）一律不採為正式來源。 */
export function extractRiceKgFromImport(rawKg: unknown): number | null {
  const n = Number(rawKg);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// ============================================================
// 四、保守匹配狀態分類（候選由呼叫端查 DB 傳入）
// ============================================================

export type MatchStatus = "MATCHED" | "NEW" | "AMBIGUOUS" | "CONFLICT" | "INVALID" | "DUPLICATE";

export type ImportRowInput = {
  householdCode?: string | null;
  devoteeName?: string | null;
  phone?: string | null;
  address?: string | null;
  tabletCategory?: string | null;
  tabletName?: string | null;
};

/** DB 查出的候選信眾（呼叫端提供）。 */
export type DevoteeCandidate = {
  id: string;
  name: string;
  householdId: string | null;
  householdCode?: string | null;
  phone?: string | null;
  address?: string | null;
};

export type MatchResult = {
  status: MatchStatus;
  matchedDevoteeId: string | null;
  candidateIds: string[];
  basis: string[];
  issues: string[];
};

const VALID_CATEGORIES = new Set(["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "DEBT_CREDITOR", "UNBORN_CHILD"]);

/**
 * 保守多欄位匹配分類（指令二）。核心原則：
 * - 家戶編號精確一致 或 姓名＋電話一致 → 強依據可 MATCHED。
 * - 只有姓名一致：單一候選也**不得自動 MATCHED**（→ AMBIGUOUS 待人工指定）。
 * - 同名多人 → AMBIGUOUS。電話/地址/家戶互相衝突 → CONFLICT。
 * - 缺姓名或牌位類型不合法 → INVALID。無任何候選 → NEW（需明確確認才建立新信眾）。
 * seenKey：呼叫端提供「同批次已出現的正規化 key」集合，用來標 DUPLICATE。
 */
export function classifyMatch(
  row: ImportRowInput,
  candidates: DevoteeCandidate[],
  seenKeys?: Set<string>
): MatchResult {
  const issues: string[] = [];
  const basis: string[] = [];
  const name = (row.devoteeName ?? "").trim();
  const phone = (row.phone ?? "").trim();
  const code = (row.householdCode ?? "").trim();

  // 基本驗證：
  if (!name) issues.push("缺少信眾姓名");
  if (!(row.tabletName ?? "").toString().trim()) issues.push("缺少牌位姓名");
  const cat = (row.tabletCategory ?? "").toString().trim();
  if (cat && !VALID_CATEGORIES.has(cat)) issues.push("牌位類型不是四類之一");
  if (issues.length > 0) {
    return { status: "INVALID", matchedDevoteeId: null, candidateIds: [], basis, issues };
  }

  // 同批次重複列：
  const dupKey = `${code}|${name}|${phone}`;
  if (seenKeys?.has(dupKey)) {
    return { status: "DUPLICATE", matchedDevoteeId: null, candidateIds: [], basis, issues: ["同批次重複列"] };
  }

  if (candidates.length === 0) {
    return { status: "NEW", matchedDevoteeId: null, candidateIds: [], basis: ["查無相符信眾"], issues };
  }

  // 強依據：家戶編號精確一致（且姓名相符）。
  const byCode = code ? candidates.filter((c) => (c.householdCode ?? "") === code && c.name === name) : [];
  if (byCode.length === 1) {
    basis.push("家戶編號＋姓名一致");
    return { status: "MATCHED", matchedDevoteeId: byCode[0].id, candidateIds: byCode.map((c) => c.id), basis, issues };
  }

  // 強依據：姓名＋電話一致。
  const byPhone = phone ? candidates.filter((c) => c.name === name && (c.phone ?? "") === phone) : [];
  if (byPhone.length === 1) {
    basis.push("姓名＋電話一致");
    return { status: "MATCHED", matchedDevoteeId: byPhone[0].id, candidateIds: byPhone.map((c) => c.id), basis, issues };
  }

  // 同名候選：
  const byName = candidates.filter((c) => c.name === name);
  if (byName.length > 1) {
    // 電話/地址互相衝突 → CONFLICT；否則同名多人 → AMBIGUOUS。
    const conflicting =
      phone && byName.every((c) => (c.phone ?? "") !== phone) && byName.some((c) => c.phone);
    return {
      status: conflicting ? "CONFLICT" : "AMBIGUOUS",
      matchedDevoteeId: null,
      candidateIds: byName.map((c) => c.id),
      basis: ["同名多筆"],
      issues: conflicting ? ["電話與所有同名候選皆不符，資料衝突"] : ["同名多人，需人工指定正確信眾"],
    };
  }
  if (byName.length === 1) {
    // 只有姓名一致：不得自動 MATCHED（指令二）。
    return {
      status: "AMBIGUOUS",
      matchedDevoteeId: null,
      candidateIds: [byName[0].id],
      basis: ["僅姓名一致（不足以自動比對）"],
      issues: ["僅姓名相同，需人工確認是否為同一人"],
    };
  }

  return { status: "NEW", matchedDevoteeId: null, candidateIds: [], basis: ["查無相符信眾"], issues };
}

/** 一列草稿是否可以正式確認（非 INVALID/AMBIGUOUS/CONFLICT/DUPLICATE，且已解析出信眾或已明確要建新）。 */
export function isRowConfirmable(status: MatchStatus, resolvedDevoteeId: string | null, confirmedNew: boolean): boolean {
  if (status === "MATCHED") return true;
  if (resolvedDevoteeId) return true; // 人工指定了正確信眾
  if (status === "NEW" && confirmedNew) return true; // 明確確認建立新信眾
  return false;
}
