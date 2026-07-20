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

/** 成員層級欄位：同一戶的多列要「串接」，不是沿用。 */
const MEMBER_LEVEL_TARGETS = ["allMembers", "householdMembers", "ancestors", "spirits"] as const;

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
