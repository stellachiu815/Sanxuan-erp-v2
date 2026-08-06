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
  householdCode: ["家戶編號", "戶號", "家戶代號", "編號", "家戶", "戶別編號"],
  householdName: ["戶名", "家戶名稱", "家戶名"],
  primaryContact: ["主要聯絡人", "聯絡人", "戶長", "報名人"],
  devoteeName: ["信眾姓名", "報名信眾", "報名人姓名"],
  phone: ["電話", "手機", "聯絡電話", "行動電話"],
  address: ["地址", "聯絡地址", "戶籍地址", "通訊地址"],
  tabletCategory: ["牌位類型", "牌位分類", "類別", "祭祀類別", "類型"],
  tabletName: ["牌位姓名", "牌位名稱", "祭祀名稱", "祭祀姓名", "往生者", "亡者姓名", "姓名", "被超薦人", "陽下"],
  yangshang: ["陽上", "陽上人", "陽上人姓名", "在世子孫", "陽世子孫"],
  tabletAddress: ["牌位地址", "疏文地址", "祭祀地址"],
  riceKg: ["白米斤數", "白米", "斤數", "白米(斤)", "白米重量"],
  extraPocketQty: ["額外寶袋", "額外寶袋數量", "加寶袋", "寶袋數量", "寶袋"],
  sponsor: ["贊普", "贊普數量", "贊普份數"],
  sponsorDonation: ["隨喜贊普", "隨喜", "隨喜金額"],
  sponsorCustomName: ["贊普姓名", "贊普名稱", "贊普人"],
  companyName: ["公司名稱", "公司", "商號", "行號"],
  note: ["備註", "說明", "註記"],
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

/**
 * V36.5B：正式 Excel「額外寶袋」欄位解析——同一欄相容兩種正式寫法（純函式，可測）：
 *   - 純數字（例：2）→ 數量模式：count=2、names=[]（沿用牌位名稱列印 N 個額外寶袋）。
 *   - 文字姓名（例：江士耀 / 江士耀、王大 / 逗號、頓號、換行分隔）→ 姓名模式：
 *       每個姓名各建 1 個額外寶袋、列印該姓名；count=姓名數、names=[...]。
 *   - 空白 → count=0、names=[]。
 * 不要求使用者把姓名改成數字（正式格式相容）。
 */
export function parseExtraPocketField(raw: string | null | undefined): { count: number; names: string[] } {
  const s = (raw ?? "").toString().trim();
  if (!s) return { count: 0, names: [] };
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Math.max(0, Math.floor(Number(s)) || 0);
    return { count: n, names: [] };
  }
  const names = s.split(/[,，、\n\r]+/).map((x) => x.trim()).filter((x) => x.length > 0);
  return { count: names.length, names };
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
  /** 正式普渡 Excel 常把報名者姓名放在「報名人」欄（對應 primaryContact）；冤親以此為建立姓名之一。 */
  primaryContact?: string | null;
  phone?: string | null;
  address?: string | null;
  tabletCategory?: string | null;
  tabletName?: string | null;
  /** V15R2：祖先／乙位正魂用陽上人姓名配對既有信眾／家戶（Excel 只有牌位名稱＋陽上人）。 */
  yangshangNames?: string[] | null;
};

/** 祖先／乙位正魂／無緣子女：以陽上人配對；冤親：以報名姓名配對。 */
const CATEGORY_MATCH_BY_YANGSHANG = new Set(["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "UNBORN_CHILD"]);

/** 標準化陽上人集合（去空白、去重、排序）——供重複判斷與顯示，一份標準。 */
export function normalizeYangshangSet(names: readonly (string | null | undefined)[] | null | undefined): string[] {
  return [...new Set((names ?? []).map((s) => (s ?? "").replace(/\s+/g, "").trim()).filter((s) => s.length > 0))].sort();
}

/** 這一列該用哪些「人名」去配對既有信眾（依項目類型）。 */
function matchNamesFor(row: ImportRowInput): string[] {
  const cat = (row.tabletCategory ?? "").toString().trim();
  const devotee = (row.devoteeName ?? "").toString().trim();
  const yang = (row.yangshangNames ?? []).map((s) => (s ?? "").toString().trim()).filter((s) => s.length > 0);
  if (CATEGORY_MATCH_BY_YANGSHANG.has(cat)) {
    // 祖先／乙位正魂：Excel 沒有信眾姓名，用陽上人姓名配對（退回 devoteeName 相容舊格式）。
    return [...new Set([...yang, devotee].filter((s) => s.length > 0))];
  }
  // 冤親（DEBT_CREDITOR）與其他：以「報名者姓名」建立，相容名字可能填在
  //   信眾姓名(devoteeName)／牌位姓名(tabletName)／報名人(primaryContact)／陽上人(yangshang) 任一欄。
  const primary = (row.primaryContact ?? "").toString().trim();
  return [
    ...new Set(
      [devotee, primary, (row.tabletName ?? "").toString().trim(), ...yang].filter((s) => s.length > 0)
    ),
  ];
}

/**
 * V15R2 重複判斷複合鍵（唯一根因修正）。
 *
 * 舊鍵＝`家戶編號|報名姓名|牌位姓名|電話`：祖先／正魂沒有家戶編號、報名姓名、電話，
 * 只要牌位名稱相同（例如兩戶都寫「周姓歷代祖先」）就整串相同 → 被誤判重複。
 *
 * 新鍵綜合：項目類型＋完整牌位名稱＋標準化陽上集合＋配對 devoteeId/householdId＋
 * 報名姓名＋電話＋家戶編號。只有「內容完全一致」才會撞鍵（＝真正重複列）；
 * 同姓、同牌位名稱、同一位陽上人但其餘不同 → 不同鍵 → 不判重複。
 */
export function buildImportDupKey(
  row: ImportRowInput,
  matchedDevoteeId: string | null,
  matchedHouseholdId: string | null
): string {
  const cat = (row.tabletCategory ?? "").toString().trim();
  const tabletName = (row.tabletName ?? "").toString().trim();
  const devotee = (row.devoteeName ?? "").toString().trim();
  const phone = (row.phone ?? "").toString().trim();
  const code = (row.householdCode ?? "").toString().trim();
  const yangKey = normalizeYangshangSet(row.yangshangNames).join("+");
  return [cat, tabletName, yangKey, matchedDevoteeId ?? "", matchedHouseholdId ?? "", devotee, phone, code].join("|");
}

/**
 * V15R4 地址來源解析（純函式，preview 與 commit 共用同一套，避免兩套結果不一致）。
 * 正式優先序（依需求「二」）：
 *   1. Excel 該筆明確地址（牌位地址欄；退回地址欄）——最高優先（Excel）
 *   2. 已配對信眾的主要地址（＝信眾所屬家戶地址）（信眾）
 *   3. 已配對家戶的主要地址（家戶）
 *   4. 配對信眾本人有效地址（信眾）
 *   5. 都沒有 → null（呼叫端保留草稿並標「缺牌位地址」；正式確認/列印才擋）
 * ⚠️ 現行 schema：Member 無獨立地址欄，信眾地址＝所屬家戶地址。
 */
export function resolveImportAddress(input: {
  /** Excel 該筆牌位地址欄（最高優先）。 */
  rowTabletAddress?: string | null;
  /** Excel 該筆一般地址欄（次高優先，牌位地址欄為空時採用）。 */
  rowAddress?: string | null;
  matchedHouseholdAddress?: string | null;
  devoteeHouseholdAddress?: string | null;
  devoteeOwnAddress?: string | null;
}): { address: string | null; source: "Excel" | "家戶" | "信眾" | null } {
  const excel = ((input.rowTabletAddress ?? "").trim() || (input.rowAddress ?? "").trim());
  if (excel) return { address: excel, source: "Excel" };
  const dhh = (input.devoteeHouseholdAddress ?? "").trim();
  if (dhh) return { address: dhh, source: "信眾" };
  const hh = (input.matchedHouseholdAddress ?? "").trim();
  if (hh) return { address: hh, source: "家戶" };
  const own = (input.devoteeOwnAddress ?? "").trim();
  if (own) return { address: own, source: "信眾" };
  return { address: null, source: null };
}

/** DB 查出的候選信眾（呼叫端提供）。 */
export type DevoteeCandidate = {
  id: string;
  name: string;
  householdId: string | null;
  householdCode?: string | null;
  phone?: string | null;
  address?: string | null;
};

/** DB 查出的候選家戶（呼叫端提供）：正式普渡 Excel 常以家戶編號辨識，未必有信眾姓名欄。 */
export type HouseholdCandidate = {
  id: string; // 家戶編號（Household.id，例如 F00009）
  name?: string | null;
  phone?: string | null;
  address?: string | null;
};

export type MatchResult = {
  status: MatchStatus;
  matchedDevoteeId: string | null;
  matchedHouseholdId: string | null;
  candidateIds: string[];
  basis: string[];
  issues: string[];
};

const VALID_CATEGORIES = new Set(["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "DEBT_CREDITOR", "UNBORN_CHILD"]);

/**
 * 保守多欄位匹配分類（指令二）。核心原則：
 * - 正式普渡 Excel 以「家戶」為主辨識（未必有信眾姓名欄）；因此**不強制要求信眾姓名**，
 *   一列只要有可登記的牌位內容（牌位姓名）即為有效。
 * - 家戶編號精確一致 → 強依據（MATCHED 到該家戶）；姓名＋電話一致 → 強依據（MATCHED 到信眾）。
 * - 只有姓名一致：不得自動 MATCHED（→ AMBIGUOUS 待人工指定）。同名多人 → AMBIGUOUS；電話全衝突 → CONFLICT。
 * - 完全查無可用辨識（無家戶編號相符、無信眾候選）→ NEW（需明確確認才建家戶/信眾）。
 * - 缺牌位姓名或牌位類型不合法 → INVALID。
 * seenKey：同批次已出現的正規化 key，用來標 DUPLICATE。
 */
export function classifyMatch(
  row: ImportRowInput,
  candidates: DevoteeCandidate[],
  seenKeys?: Set<string>,
  householdCandidates: HouseholdCandidate[] = []
): MatchResult {
  const issues: string[] = [];
  const basis: string[] = [];
  const phone = (row.phone ?? "").trim();
  const code = (row.householdCode ?? "").trim();
  const tabletName = (row.tabletName ?? "").toString().trim();
  const cat = (row.tabletCategory ?? "").toString().trim();
  const isYuanqin = cat === "DEBT_CREDITOR";
  // 依項目類型決定配對用的人名（祖先／正魂＝陽上人；冤親＝報名姓名）。
  const matchNames = matchNamesFor(row);
  const primaryName = matchNames[0] ?? "";

  // 基本驗證（依類型）：
  //  祖先／正魂／無緣子女 → 必須有牌位姓名；冤親 → 必須有報名姓名。
  if (cat && !VALID_CATEGORIES.has(cat)) issues.push("牌位類型不是四類之一");
  if (isYuanqin) {
    if (matchNames.length === 0) issues.push("缺少報名姓名");
  } else {
    if (!tabletName) issues.push("缺少牌位姓名");
  }
  if (issues.length > 0) {
    return { status: "INVALID", matchedDevoteeId: null, matchedHouseholdId: null, candidateIds: [], basis, issues };
  }

  // 只在這一列「配對用人名」集合內的候選信眾（不擴散到其他人）。
  const relevant = candidates.filter((c) => matchNames.includes(c.name));

  // 先算出配對結果（供複合重複鍵使用），再判斷同批次是否真正重複。
  let result: MatchResult;

  // 強依據 1：家戶編號精確一致（正式 Excel 若有家戶編號時）。
  const hh = code ? householdCandidates.find((h) => h.id === code) : undefined;
  if (hh) {
    const memberInHh = relevant.find((c) => c.householdId === hh.id);
    // V37 防呆（依 Stella）：家戶編號比對到那一戶後，若「這位陽上人**不在**這一戶」，
    //   但這位陽上人卻**登記在別的家戶** → 極可能編號打錯、掛到別人家（例：陽上吳念騏在 F00211，
    //   卻填成 F00221＝別人家 → 印出別人家的安奉地）。純警示、不阻擋；陽上人本來就未登記者不誤報。
    const elsewhere = relevant.filter((c) => c.householdId !== hh.id);
    const wrongHouseholdWarn = (!memberInHh && elsewhere.length > 0)
      ? [`陽上人「${primaryName}」不在家戶編號「${code}」這一戶（他登記在別戶）——編號可能打錯、會掛到別人家，請確認`]
      : [];
    result = { status: "MATCHED", matchedDevoteeId: memberInHh?.id ?? null, matchedHouseholdId: hh.id, candidateIds: memberInHh ? [memberInHh.id] : [], basis: ["家戶編號一致"], issues: wrongHouseholdWarn };
  } else {
    // 強依據 2：家戶編號＋姓名一致（信眾層）。
    const byCode = code ? relevant.filter((c) => (c.householdCode ?? "") === code) : [];
    // 強依據 3：姓名＋電話一致。
    const byPhone = phone ? relevant.filter((c) => (c.phone ?? "") === phone) : [];
    if (byCode.length === 1) {
      result = { status: "MATCHED", matchedDevoteeId: byCode[0].id, matchedHouseholdId: byCode[0].householdId, candidateIds: byCode.map((c) => c.id), basis: ["家戶編號＋姓名一致"], issues: [] };
    } else if (byPhone.length === 1) {
      result = { status: "MATCHED", matchedDevoteeId: byPhone[0].id, matchedHouseholdId: byPhone[0].householdId, candidateIds: byPhone.map((c) => c.id), basis: ["姓名＋電話一致"], issues: [] };
    } else if (relevant.length === 1) {
      // V15R2：祖先／正魂只有陽上人、冤親只有報名姓名——姓名唯一命中一位既有信眾即配對
      //（以便從家戶補齊地址）。多人同名才需人工確認（見下）。
      result = { status: "MATCHED", matchedDevoteeId: relevant[0].id, matchedHouseholdId: relevant[0].householdId, candidateIds: [relevant[0].id], basis: ["姓名唯一配對"], issues: [] };
    } else if (relevant.length > 1) {
      // V36.16：一張牌位可有**多位陽上人**（例：楊菁文、楊婷勻）。多位陽上人各自命中一位信眾，
      //   **不是**「同一個名字對到多個人」的同名多人——不該逼使用者選。判斷方式：
      //     1. 這些陽上人若都屬**同一家戶** → 直接配對該戶（自動，免人工）。
      //     2. 分屬不同戶，但「主要陽上人（第一位）」這個名字**唯一**命中一位 → 以主要陽上人的家戶為準。
      //     3. 只有當「主要陽上人這個名字本身對到多位不同信眾」時，才是真正同名多人 → 待確認／衝突。
      const householdsOfRelevant = new Set(relevant.map((c) => c.householdId));
      const primaryMatches = relevant.filter((c) => c.name === primaryName);
      if (householdsOfRelevant.size === 1) {
        const rep = primaryMatches[0] ?? relevant[0];
        result = { status: "MATCHED", matchedDevoteeId: rep.id, matchedHouseholdId: rep.householdId, candidateIds: relevant.map((c) => c.id), basis: ["多位陽上人同一家戶"], issues: [] };
      } else if (primaryMatches.length === 1) {
        result = { status: "MATCHED", matchedDevoteeId: primaryMatches[0].id, matchedHouseholdId: primaryMatches[0].householdId, candidateIds: relevant.map((c) => c.id), basis: ["以主要陽上人家戶為準"], issues: [] };
      } else {
        // 真正同名多人（主要陽上人對到多位不同信眾）：不可自動猜測 → 待確認，電話全不符則為衝突。
        const conflicting = phone.length > 0 && primaryMatches.every((c) => (c.phone ?? "") !== phone) && primaryMatches.some((c) => c.phone);
        result = {
          status: conflicting ? "CONFLICT" : "AMBIGUOUS",
          matchedDevoteeId: null, matchedHouseholdId: null, candidateIds: (primaryMatches.length ? primaryMatches : relevant).map((c) => c.id),
          basis: ["同名多筆"],
          issues: conflicting ? ["電話與所有同名候選皆不符，資料衝突"] : ["多人同名，請選擇正確信眾"],
        };
      }
    } else {
      // 查無相符信眾／家戶：需明確確認才建新；地址無法取得。
      result = { status: "NEW", matchedDevoteeId: null, matchedHouseholdId: null, candidateIds: [], basis: ["查無相符家戶/信眾"], issues: isYuanqin ? ["尚未配對，無法取得地址"] : [] };
    }
  }

  // 同批次「真正重複列」判斷（複合鍵，含配對結果）。證據不足（未配對）時，
  // 只有「內容完全一致」才撞鍵；同姓／同牌位名稱但陽上或配對不同 → 不同鍵、不判重複。
  const dupKey = buildImportDupKey(row, result.matchedDevoteeId, result.matchedHouseholdId);
  if (seenKeys?.has(dupKey)) {
    return { status: "DUPLICATE", matchedDevoteeId: result.matchedDevoteeId, matchedHouseholdId: result.matchedHouseholdId, candidateIds: result.candidateIds, basis: result.basis, issues: ["同批次重複列（內容完全一致）"] };
  }

  return { ...result, basis: [...result.basis, ...basis] };
}

/** 一列草稿是否可以正式確認（非 INVALID/AMBIGUOUS/CONFLICT/DUPLICATE，且已解析出信眾或已明確要建新）。 */
export function isRowConfirmable(status: MatchStatus, resolvedDevoteeId: string | null, confirmedNew: boolean): boolean {
  if (status === "MATCHED") return true;
  if (resolvedDevoteeId) return true; // 人工指定了正確信眾
  if (status === "NEW" && confirmedNew) return true; // 明確確認建立新信眾
  return false;
}
