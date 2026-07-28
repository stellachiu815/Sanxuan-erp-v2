/**
 * V11.3「信眾資料匯入預檢中心」正式版——資料正規化（依正式 7 欄 Excel 格式，
 * 需求「三玄宮 ERP V11.3 家戶匯入正式版」）。
 *
 * 這個檔案刻意不 import Prisma、不碰資料庫，純函式，方便在沙盒環境裡直接
 * 用簡單的呼叫驗證行為（不需要接資料庫）。所有函式都「不會丟出例外」——
 * 輸入看不懂就回傳空字串／空陣列，不會讓呼叫端因為單一欄位崩潰。
 *
 * ⚠️ 這一版正式格式只有「家戶編號／戶名／主要聯絡人／地址／歷代祖先／
 * 乙位正魂／家戶成員」七個欄位，不再有生日／性別／農曆／生肖／往生標記
 * 等舊版彈性格式欄位，所以舊版對應的正規化函式（日期、性別、生肖同義詞
 * 換算等）已經一併移除，不是遺漏——這些欄位在正式格式裡已經不存在。
 */
import { Buffer } from "node:buffer";

/**
 * V12.8「合併儲存格（Forward Fill）」前處理。
 *
 * ── 正式 Excel 的實際樣貌 ──
 * 正式家戶 Excel 使用合併儲存格，一戶會橫跨多列：
 *
 *   列2  F00001 │ 周家 │ 王小姐 │ 台北市… │ 4 │ 2 │ 周佳堂
 *   列3  (空白) │(空白)│ (空白) │ (空白)  │   │   │ 周彥廷
 *   列4  (空白) │(空白)│ (空白) │ (空白)  │   │   │ 梁林玲玉
 *   列5  (空白) │(空白)│ (空白) │ (空白)  │   │   │ 梁家坤
 *   列6  F00002 │ 梁家 │ …
 *
 * XLSX 解析合併儲存格時，只有左上角那一格有值，其餘是空字串——所以列3–5
 * 會被誤判成「缺少家戶編號／戶名」而擋下匯入。這是 V12.8 要修的 Bug。
 *
 * ── 這支函式做兩件事，缺一不可 ──
 *
 *   1. **Forward Fill 家戶層級欄位**：家戶編號／戶名／主要聯絡人／主要地址／
 *      家庭成員(數量)／普渡牌位資料筆數，空白時沿用上一列的值。
 *
 *   2. **把同一戶的多列合併成一列**：整個下游流程（驗證／預檢／人工確認／
 *      正式匯入／進度分母）都建立在「一列＝一戶」的假設上——
 *      devoteeImportBatch.ts 的 commit 是 `for (const r of readyRows)`，
 *      一列就做一次家戶建立/更新。如果只做 forward fill 而不合併，F00001
 *      會變成 4 列、被當成 4 戶重複處理，統計數字與「N / 869 戶」的進度
 *      也會全部失真。合併之後下游完全不用改，既有架構原封不動。
 *
 * ⚠️ **「所有成員」欄絕對不可以 forward fill。** 那是成員層級資料，一列一個
 * 名字；forward fill 會把同一個人複製到後面每一列。正確做法是把同一戶各列
 * 的成員值**串接**起來（用頓號），再交給既有的 splitMultiValue() 拆解。
 */

/** 家戶層級欄位：空白時沿用上一列（合併儲存格的來源）。 */
const HOUSEHOLD_LEVEL_TARGETS = [
  "householdCode",
  "householdName",
  "primaryContact",
  "address",
  "memberCount",
  "tabletCount",
] as const;

/**
 * 成員層級欄位：同一戶的多列要「串接」，不是沿用。
 * V24：加入 tabletMeta——牌位（歷代祖先／乙位正魂）的**每筆**陽上姓名＋安奉地，
 * 以 base64（避開頓號/逗號/換行等分隔符）逐筆串接，之後由 decodeTabletMeta() 還原，
 * 依 displayName 對應回牌位，讓正式匯入寫入 WorshipRecord.yangshangName／location。
 */
const MEMBER_LEVEL_TARGETS = ["allMembers", "householdMembers", "ancestors", "spirits", "tabletMeta"] as const;

/**
 * V24：正式家戶 Excel 為「合併儲存格、一戶多列」，且**每一列以「牌位類型」欄分類**
 * （在世成員／歷代祖先／個人往生者(乙位正魂)），牌位名稱在「牌位顯示名稱」欄。
 * 這些合成欄讓 forward-fill/分組後，成員／祖先／乙位正魂能各自串接、再由既有
 * mapping（見 analyze route 的合成對應）流入 householdMembers／ancestors／spirits。
 */
export const TABLET_ROUTED_COLUMNS = {
  members: "__tablet_routed_members__",
  ancestors: "__tablet_routed_ancestors__",
  spirits: "__tablet_routed_spirits__",
  /** 每筆牌位的陽上姓名＋安奉地（base64 JSON），依 displayName 對應回牌位。 */
  meta: "__tablet_routed_meta__",
} as const;

/** V24：一筆牌位的隨附資料（陽上姓名／安奉地），依 displayName 對應回 WorshipRecord。 */
export type TabletMeta = {
  type: "ancestor" | "spirit";
  displayName: string;
  /** 陽上姓名——原文保留，不刪除、不重組。 */
  yangshang: string;
  /** 安奉地／牌位地址——原文保留，不改寫；空白時維持空字串（下游視為待補）。 */
  address: string;
};

/** 以 base64 編碼一筆牌位隨附資料（避開頓號/逗號/換行等 splitMultiValue 分隔符）。 */
function encodeTabletMeta(meta: TabletMeta): string {
  return Buffer.from(JSON.stringify(meta), "utf8").toString("base64");
}

/**
 * 還原同一戶串接後的牌位隨附資料。輸入是 forwardFillAndGroupHouseholdRows 串接出來的
 * 「b64、b64、b64」字串（每列一筆牌位、以頓號串接）。回傳每筆 TabletMeta，無法解析者略過。
 */
export function decodeTabletMeta(raw: unknown): TabletMeta[] {
  const out: TabletMeta[] = [];
  for (const token of splitMultiValue(raw)) {
    try {
      const parsed = JSON.parse(Buffer.from(token, "base64").toString("utf8")) as Partial<TabletMeta>;
      if (parsed && typeof parsed.displayName === "string" && (parsed.type === "ancestor" || parsed.type === "spirit")) {
        out.push({
          type: parsed.type,
          displayName: parsed.displayName,
          yangshang: typeof parsed.yangshang === "string" ? parsed.yangshang : "",
          address: typeof parsed.address === "string" ? parsed.address : "",
        });
      }
    } catch {
      // 非本系統編碼的 token（例如向下相容的舊資料）——略過，不影響其他筆。
    }
  }
  return out;
}

/** 找出原始資料列中，標題（去空白）等於指定名稱的實際欄位 key。 */
function findColumnByLabel(rows: Record<string, unknown>[], label: string): string | undefined {
  for (const row of rows) {
    const hit = Object.keys(row).find((k) => k.trim() === label);
    if (hit) return hit;
  }
  return undefined;
}

/** 找出原始資料列中，標題（去空白）符合條件的實際欄位 key（用於模糊比對，例如含「陽上」）。 */
function findColumnKeyByPredicate(
  rows: Record<string, unknown>[],
  predicate: (label: string) => boolean
): string | undefined {
  for (const row of rows) {
    const hit = Object.keys(row).find((k) => predicate(k.trim()));
    if (hit) return hit;
  }
  return undefined;
}

/** 判斷「牌位類型」值屬於哪一類；非牌位（在世成員）回 "member"。 */
export function classifyTabletType(rawType: unknown): "ancestor" | "spirit" | "member" {
  const t = String(rawType ?? "").trim();
  if (!t) return "member";
  if (t.includes("歷代祖先")) return "ancestor";
  if (t.includes("個人往生者") || t.includes("乙位正魂") || t.includes("往生")) return "spirit";
  return "member";
}

/**
 * 若原始檔含「牌位類型」欄，為每一列標註三個合成欄：依牌位類型把「牌位顯示名稱／姓名」
 * 路由到成員／歷代祖先／乙位正魂。之後既有的分組串接會自動把同一戶各列合併。
 * 回傳是否啟用了牌位類型路由（供 analyze route 決定是否加入合成對應）。
 */
export function annotateTabletRoutedColumns(rows: Record<string, unknown>[]): boolean {
  const typeCol = findColumnByLabel(rows, "牌位類型");
  if (!typeCol) return false;
  const tabletNameCol = findColumnByLabel(rows, "牌位顯示名稱");
  const personNameCol = findColumnByLabel(rows, "姓名");
  /**
   * 陽上姓名／安奉地為選填。安奉地**只**認標題含「安奉」的欄（安奉地／安奉位置），
   * **不**用一般「地址」欄遞補——避免把家戶地址誤寫成牌位地址（專案既有規則：
   * 牌位地址不得被家戶地址自動覆蓋）。
   */
  const yangshangCol = findColumnKeyByPredicate(rows, (label) => label.includes("陽上"));
  const addressCol = findColumnKeyByPredicate(rows, (label) => label.includes("安奉"));
  for (const row of rows) {
    const kind = classifyTabletType(row[typeCol]);
    const tabletName = tabletNameCol ? String(row[tabletNameCol] ?? "").trim() : "";
    const personName = personNameCol ? String(row[personNameCol] ?? "").trim() : "";
    // 牌位顯示名稱優先作為牌位名稱；在世成員一律用姓名。
    const displayName = tabletName || personName;
    row[TABLET_ROUTED_COLUMNS.ancestors] = kind === "ancestor" ? displayName : "";
    row[TABLET_ROUTED_COLUMNS.spirits] = kind === "spirit" ? displayName : "";
    row[TABLET_ROUTED_COLUMNS.members] = kind === "member" ? personName || displayName : "";
    if ((kind === "ancestor" || kind === "spirit") && displayName) {
      const meta: TabletMeta = {
        type: kind,
        displayName,
        yangshang: yangshangCol ? String(row[yangshangCol] ?? "").trim() : "",
        address: addressCol ? String(row[addressCol] ?? "").trim() : "",
      };
      row[TABLET_ROUTED_COLUMNS.meta] = encodeTabletMeta(meta);
    } else {
      row[TABLET_ROUTED_COLUMNS.meta] = "";
    }
  }
  return true;
}

function isBlankCell(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (v instanceof Date) return false;
  return String(v).replace(/[\s　]/g, "") === "";
}

export type PreparedSheetRow = {
  /** 這一戶在 Excel 裡的第一列列號（供錯誤訊息與畫面顯示定位） */
  rowNumber: number;
  /** 這一戶實際橫跨的所有 Excel 列號 */
  sourceRowNumbers: number[];
  /** forward fill ＋ 合併之後的資料，key 仍是原始 Excel 欄位名稱 */
  raw: Record<string, unknown>;
};

/**
 * 對整份工作表做 forward fill 並把同一戶的多列合併成一列。
 *
 * @param rawRows Excel 解析出來的原始列（key 是 Excel 欄位名稱）
 * @param mapping 欄位對應（Excel 欄位名稱 → 系統欄位 key）
 */
export function forwardFillAndGroupHouseholdRows(
  rawRows: Record<string, unknown>[],
  mapping: Record<string, string | null>
): { rows: PreparedSheetRow[]; mergedRowCount: number } {
  // 系統欄位 → 對應到的 Excel 欄位名稱（同一個 target 只會有一個來源欄，
  // 見 suggestColumnMappingPure() 的防重複佔用）
  const sourceOf = new Map<string, string>();
  for (const [sourceColumn, target] of Object.entries(mapping)) {
    if (target && !sourceOf.has(target)) sourceOf.set(target, sourceColumn);
  }

  const codeColumn = sourceOf.get("householdCode");

  // ---- 第一步：forward fill 家戶層級欄位 ----
  const filled: Record<string, unknown>[] = [];
  const lastValue = new Map<string, unknown>();

  for (const row of rawRows) {
    const next: Record<string, unknown> = { ...row };

    for (const target of HOUSEHOLD_LEVEL_TARGETS) {
      const col = sourceOf.get(target);
      if (!col) continue;
      if (isBlankCell(next[col])) {
        // 只有在「上面真的出現過值」時才補；檔案最開頭就空白的話維持空白，
        // 讓既有驗證照常回報「缺少必填欄位」，不會被無聲蓋掉。
        if (lastValue.has(col)) next[col] = lastValue.get(col);
      } else {
        lastValue.set(col, next[col]);
      }
    }

    filled.push(next);
  }

  // ---- 第二步：把同一個家戶編號的多列合併成一列 ----
  const groups = new Map<string, { rowNumbers: number[]; raw: Record<string, unknown> }>();
  const order: string[] = [];
  let mergedRowCount = 0;

  filled.forEach((row, i) => {
    const rowNumber = i + 2; // 1 是標題列
    const code = codeColumn ? String(row[codeColumn] ?? "").trim() : "";

    // 沒有家戶編號的列無法歸戶（例如檔案最開頭就空白）——保持獨立一列，
    // 交給既有驗證回報錯誤，不要靜默丟掉。
    const key = code || `__no_code_row_${rowNumber}__`;

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { rowNumbers: [rowNumber], raw: { ...row } });
      order.push(key);
      return;
    }

    mergedRowCount++;
    existing.rowNumbers.push(rowNumber);

    // 成員層級欄位：串接（用頓號，既有 splitMultiValue() 支援）
    for (const target of MEMBER_LEVEL_TARGETS) {
      const col = sourceOf.get(target);
      if (!col) continue;
      const addition = row[col];
      if (isBlankCell(addition)) continue;
      const current = existing.raw[col];
      existing.raw[col] = isBlankCell(current) ? addition : `${String(current)}、${String(addition)}`;
    }

    // 家戶層級欄位：以第一列為準；第一列剛好空白時才用後面補上的值。
    for (const target of HOUSEHOLD_LEVEL_TARGETS) {
      const col = sourceOf.get(target);
      if (!col) continue;
      if (isBlankCell(existing.raw[col]) && !isBlankCell(row[col])) {
        existing.raw[col] = row[col];
      }
    }
  });

  return {
    rows: order.map((key) => {
      const g = groups.get(key)!;
      return { rowNumber: g.rowNumbers[0], sourceRowNumbers: g.rowNumbers, raw: g.raw };
    }),
    mergedRowCount,
  };
}

/**
 * V12.9：**唯一安全的「日曆日期」建構器。**
 *
 * ── 這支存在的原因（正式匯入的當機來源）──
 * Prisma 收到 `new Date("Invalid Date")` 會直接拋
 * `PrismaClientValidationError: Provided Date object is invalid`，
 * 導致整批匯入中止。實際發生的路徑是：Excel 儲存格解析出一個
 * **Invalid Date 物件**（損壞或格式怪異的日期格），程式沒有檢查就呼叫
 * `rawValue.getFullYear()` → 得到 NaN → `Date.UTC(NaN, NaN, NaN)` → NaN
 * → `new Date(NaN)` → Invalid Date → 送進 Prisma → 整批爆掉。
 *
 * ── 規則 ──
 * 任何無法構成「真實存在的日曆日」的輸入，一律回傳 **null**，絕不回傳
 * Invalid Date。涵蓋：空白／null／undefined／NaN／Invalid Date 物件／
 * 0000-00-00／2 月 30 日這種不存在的日期／年份明顯不合理。
 *
 * 呼叫端只要一律用這支，就不可能再把 Invalid Date 送進 Prisma。
 */
export function toSafeCalendarDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null;

  // ① Excel 直接給 Date 物件（cellDates: true 時的常見情況）
  if (raw instanceof Date) {
    // ⚠️ 關鍵防線：Invalid Date 物件的 getTime() 是 NaN。少了這一行，
    // 後面所有欄位取出來都會是 NaN，最後組出 Invalid Date。
    if (Number.isNaN(raw.getTime())) return null;
    const y = raw.getUTCFullYear();
    const m = raw.getUTCMonth();
    const d = raw.getUTCDate();
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    const built = new Date(Date.UTC(y, m, d));
    return Number.isNaN(built.getTime()) ? null : built;
  }

  // ② 數字（Excel 序列日期）不在正式格式的支援範圍，一律視為無效，
  //    避免把 0 或隨機數字誤解成 1899 年之類的假日期。
  if (typeof raw === "number") return null;

  // ③ 文字：只接受 yyyy-MM-dd / yyyy/MM/dd
  const s = toHalfWidthDigits(String(raw)).trim().replace(/\//g, "-");
  if (!s) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return null;

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  // 0000-00-00 這種「格式對、內容不存在」的值在這裡被擋下
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  const built = new Date(Date.UTC(y, mo - 1, d));
  if (Number.isNaN(built.getTime())) return null;
  // 回讀確認沒有被自動進位（例如 2/30 會變成 3/2），且年份沒有被
  // Date.UTC 的「0–99 視為 1900+」規則悄悄改掉
  if (built.getUTCFullYear() !== y || built.getUTCMonth() !== mo - 1 || built.getUTCDate() !== d) {
    return null;
  }
  return built;
}

/** 姓名／戶名前後空白（含全形空白）。 */
export function normalizeName(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw).replace(/^[\s　]+|[\s　]+$/g, "");
}

/** 全形數字轉半形（其餘全形符號不動，避免誤傷地址裡的中文標點）。 */
export function toHalfWidthDigits(raw: string): string {
  return raw.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/** 一般文字欄位（主要聯絡人／地址等）：只做 trim，空字串轉 null。 */
export function toNullableText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return null;
  const s = toHalfWidthDigits(String(raw)).trim();
  return s.length > 0 ? s : null;
}

/**
 * 拆解「家戶成員」／「歷代祖先」／「乙位正魂」這類多筆姓名的欄位。
 *
 * 支援的分隔符（V12.6 指令二：逗號、頓號、換行）：
 *   、  ，  ,   以及換行（\n、\r\n）與分號 ;／；
 *
 * 換行是這一版新增的——Excel 儲存格內用 Alt+Enter 換行列多位成員是行政
 * 人員常用的寫法，舊版只切逗號會把整格當成一個超長姓名。
 *
 * 拆開後每一筆都會 trim（含全形空白與定位字元），空字串（例如結尾多打了
 * 一個分隔符號、或中間有空行）會被濾掉，不會產生空白姓名。
 */
export function splitMultiValue(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  const s = toHalfWidthDigits(String(raw)).trim();
  if (!s) return [];
  return s
    .split(/[、，,;；\r\n]+/)
    .map((part) => part.replace(/^[\s　\t]+|[\s　\t]+$/g, ""))
    .filter((part) => part.length > 0);
}
