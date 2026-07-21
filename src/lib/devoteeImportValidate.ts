import { applyMapping } from "@/lib/smartImport";
import { normalizeName, toNullableText, splitMultiValue, toHalfWidthDigits } from "@/lib/devoteeImportNormalize";

/**
 * V11.3「信眾資料匯入預檢中心」正式版——單列（＝一戶）資料驗證。
 *
 * 一列＝一戶。這個檔案只做「這一列本身資料乾不乾淨」的判斷，完全不查
 * 資料庫——正式建立／更新 Household、Member、WorshipRecord（歷代祖先／
 * 乙位正魂）的邏輯在 devoteeImportBatch.ts。
 *
 * ⚠️ V12.6 驗收修正：正式家戶 Excel 的實際格式是
 *
 *   家戶編號｜戶名｜主要聯絡人｜地址｜家庭成員(數量)｜普渡牌位資料筆數(數量)｜所有成員
 *
 * 其中「所有成員」一欄以逗號分隔，**混合**三種資料：一般家戶成員、歷代
 * 祖先、乙位正魂。系統依名稱內容自動分類（見 classifyAllMembers()）：
 *
 *   含「歷代祖先」→ 歷代祖先牌位／含「乙位正魂」→ 乙位正魂牌位／其餘 → 一般成員
 *
 * 兩個數量欄位僅供核對，不會寫入任何資料，對不上只會產生警告：
 *   「家庭成員」        → 只核對一般家戶成員人數
 *   「普渡牌位資料筆數」 → 只核對歷代祖先 + 乙位正魂的合計筆數
 *
 * ⚠️ V13.2 釐清（Excel 標題列不變，只調整系統內的顯示文字為
 * 「家戶固定牌位筆數」）：這個欄位核對的是**家戶固定登記**的牌位，
 * 家戶固定牌位本來就只有歷代祖先與乙位正魂兩類。
 *
 * 冤親債主、無緣子女、寶袋**不由家戶 Excel 匯入**——它們屬於每年度普渡
 * 活動的報名內容，每年可能不同，由普渡報名畫面手動新增：
 *   冤親債主／無緣子女 → UniversalSalvationEntry（四類別已完整支援）
 *   寶袋               → AdditionalPrintItem（獨立管理，有數量與單價）
 * 因此 classifyAllMembers() 只辨識三種類型，這是正確設計，不是缺漏。
 *
 * ⚠️ 向下相容：舊檔案若已經把成員／歷代祖先／乙位正魂拆成三個獨立欄位，
 * 照樣可以匯入（沒有「所有成員」時自動退回舊路徑），不需要重做檔案。
 */

export type NormalizedHouseholdFields = {
  code: string; // 家戶編號（必填，直接對應既有 Household.id）
  name: string; // 戶名（必填，對應既有 Household.name）
  contactName: string | null; // 主要聯絡人
  address: string | null; // 地址
};

export type NormalizedDevoteeRow = {
  rowNumber: number;
  raw: Record<string, unknown>;
  household: NormalizedHouseholdFields;
  memberNames: string[]; // 家戶成員，拆解後、已去除同列重複
  ancestorNames: string[]; // 歷代祖先，拆解後、已去除同列重複
  spiritNames: string[]; // 乙位正魂，拆解後、已去除同列重複
  /** 缺少必填欄位——對應「資料不完整」狀態 */
  missingFieldErrors: string[];
  /** 欄位內容看不懂——對應「格式錯誤」狀態 */
  formatErrors: string[];
  /** 通過驗證但有可疑之處的提醒，不影響是否可匯入（目前正式格式沒有會觸發
   *  警告的欄位，保留這個欄位是為了跟批次/預覽的資料形狀維持一致，方便
   *  之後如果新增警告規則不用改動呼叫端型別）。 */
  warnings: string[];
};

/** 依序去除重複，保留第一次出現的順序（同一列「家戶成員」寫兩次同名時，只算一筆，避免重複建立）。 */
function dedupeKeepOrder(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * V12.6 驗收修正：正式家戶 Excel 的「所有成員」欄位分類。
 *
 * 正式檔案把三種資料混在同一欄，以逗號分隔，例如：
 *
 *   周財寶,陳秀珍,王姓歷代祖先,周晉萬 乙位正魂
 *
 * 分類規則（使用者明確指定，不自行擴充）：
 *   1. 名稱包含「歷代祖先」→ 歷代祖先牌位（WorshipRecord type = ANCESTOR_LINE）
 *   2. 名稱包含「乙位正魂」→ 乙位正魂牌位（WorshipRecord type = INDIVIDUAL）
 *   3. 其餘                → 一般家戶成員（Member）
 *
 * ⚠️ 順序很重要：先判斷歷代祖先、再判斷乙位正魂，最後才是一般成員。
 * 名稱同時包含兩個關鍵字時（實務上不應發生）歸為歷代祖先，行為可預測。
 *
 * ⚠️ 分類後的名稱**保持原樣**，不會把「歷代祖先」「乙位正魂」字樣移除——
 * 那些字本來就是牌位名稱的一部分（例如「王姓歷代祖先」），既有系統的
 * WorshipRecord.displayName 存的就是完整名稱，去重也是比對完整名稱。
 */
export function classifyAllMembers(rawValue: unknown): {
  memberNames: string[];
  ancestorNames: string[];
  spiritNames: string[];
} {
  const all = splitMultiValue(rawValue);
  const memberNames: string[] = [];
  const ancestorNames: string[] = [];
  const spiritNames: string[] = [];

  for (const name of all) {
    if (name.includes("歷代祖先")) ancestorNames.push(name);
    else if (name.includes("乙位正魂")) spiritNames.push(name);
    else memberNames.push(name);
  }

  return {
    memberNames: dedupeKeepOrder(memberNames),
    ancestorNames: dedupeKeepOrder(ancestorNames),
    spiritNames: dedupeKeepOrder(spiritNames),
  };
}

/**
 * 把數量欄位轉成整數；不是數字就回 null（僅驗證用，不影響匯入）。
 *
 * ⚠️ 兩個容易踩到的地方，都已處理：
 *   1. 全形數字「３」要先轉半形，否則會被當成沒有數字。
 *   2. 純文字（例如「abc」或「無」）去掉非數字後是空字串，
 *      而 Number("") === 0 且 isFinite(0) 為真——不先擋掉的話會誤判成 0，
 *      進而跳出「數量欄為 0 但實際有 N 筆」這種假警告。
 */
function toCount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const cleaned = toHalfWidthDigits(String(raw)).replace(/[^\d-]/g, "");
  if (!cleaned || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function normalizeAndValidateDevoteeRow(
  raw: Record<string, unknown>,
  mapping: Record<string, string | null>,
  rowNumber: number
): NormalizedDevoteeRow {
  const mapped = applyMapping(raw, mapping);
  const missingFieldErrors: string[] = [];
  const formatErrors: string[] = [];
  const warnings: string[] = [];

  const code = normalizeName(mapped.householdCode);
  if (!code) {
    missingFieldErrors.push("缺少必填欄位「家戶編號」");
  } else if (code.length > 10) {
    formatErrors.push(`「家戶編號」不能超過 10 個字（目前「${code}」共 ${code.length} 字）`);
  }

  const name = normalizeName(mapped.householdName);
  if (!name) {
    missingFieldErrors.push("缺少必填欄位「戶名」");
  }

  const contactName = toNullableText(mapped.primaryContact);
  const address = toNullableText(mapped.address);

  /**
   * V12.6 驗收修正：成員／牌位的來源有兩種格式，優先採用正式檔案的
   * 「所有成員」混合欄，沒有時才退回舊格式的三個獨立欄位（向下相容，
   * 舊檔案不需要重做）。
   */
  let memberNames: string[];
  let ancestorNames: string[];
  let spiritNames: string[];

  const allMembersRaw = mapped.allMembers;
  const hasAllMembers = splitMultiValue(allMembersRaw).length > 0;

  if (hasAllMembers) {
    // 正式格式：一欄混合，依名稱內容分類
    const classified = classifyAllMembers(allMembersRaw);
    memberNames = classified.memberNames;
    ancestorNames = classified.ancestorNames;
    spiritNames = classified.spiritNames;
  } else {
    // 舊格式：三個獨立欄位
    memberNames = dedupeKeepOrder(splitMultiValue(mapped.householdMembers));
    ancestorNames = dedupeKeepOrder(splitMultiValue(mapped.ancestors));
    spiritNames = dedupeKeepOrder(splitMultiValue(mapped.spirits));
  }

  // 三種資料全部都沒有，才算「這一列沒有任何成員資料」。
  if (memberNames.length === 0 && ancestorNames.length === 0 && spiritNames.length === 0) {
    missingFieldErrors.push("缺少必填欄位「所有成員」");
  }

  /**
   * 「家庭成員」與「普渡牌位資料筆數」**僅供驗證**，不寫入任何資料。
   * 數量對不上時只提出警告，不阻擋匯入——Excel 的數量欄常常是人工維護、
   * 未必即時更新，但對不上通常代表名單被截斷或分隔符打錯，值得提醒。
   */
  const expectedMemberCount = toCount(mapped.memberCount);
  const expectedTabletCount = toCount(mapped.tabletCount);

  if (expectedMemberCount !== null && expectedMemberCount !== memberNames.length) {
    warnings.push(
      `「家庭成員」數量欄為 ${expectedMemberCount}，但從「所有成員」實際解析出 ${memberNames.length} 位一般成員，請確認名單是否完整。`
    );
  }
  if (expectedTabletCount !== null && expectedTabletCount !== ancestorNames.length + spiritNames.length) {
    /**
     * V13.2：訊息補上完整的計算過程與涵蓋範圍。
     *
     * 舊訊息只說「實際解析出 N 筆牌位」，使用者看到數字對不上時，常會
     * 誤以為是冤親債主或寶袋沒被算進去，進而想把它們加進家戶 Excel。
     * 這裡明確說出這個欄位**不含**哪些項目，以及它們應該去哪裡登記。
     *
     * ⚠️ 只改訊息文字，判斷條件（歷代祖先 + 乙位正魂）完全未變。
     */
    warnings.push(
      `「家戶固定牌位筆數」填寫 ${expectedTabletCount}，` +
        `但系統解析到歷代祖先 ${ancestorNames.length} 筆、乙位正魂 ${spiritNames.length} 筆，` +
        `合計 ${ancestorNames.length + spiritNames.length} 筆，數量不一致，請確認名單是否完整。` +
        `此欄只核對歷代祖先與乙位正魂，不包含一般家戶成員，也不包含冤親債主、無緣子女及寶袋` +
        `（後三項屬於每年度普渡活動報名內容，請於普渡報名畫面另行新增）。`
    );
  }

  const household: NormalizedHouseholdFields = { code, name, contactName, address };

  return {
    rowNumber,
    raw,
    household,
    memberNames,
    ancestorNames,
    spiritNames,
    missingFieldErrors,
    formatErrors,
    warnings,
  };
}
