import { applyMapping } from "@/lib/smartImport";
import { normalizeName, toNullableText, splitMultiValue } from "@/lib/devoteeImportNormalize";

/**
 * V11.3「信眾資料匯入預檢中心」正式版——單列（＝一戶）資料驗證。
 *
 * 正式 Excel 固定只有七欄，一列＝一戶（需求「三玄宮 ERP V11.3 家戶匯入
 * 正式版（依正式 Excel 格式）」）：
 *
 *   家戶編號｜戶名｜主要聯絡人｜地址｜歷代祖先（逗號分隔）｜乙位正魂（逗號分隔）｜家戶成員（逗號分隔）
 *
 * 這個檔案只做「這一列本身資料乾不乾淨」的判斷，完全不查資料庫——正式
 * 建立／更新 Household、Member、WorshipRecord（歷代祖先／乙位正魂）的邏輯
 * 在 devoteeImportBatch.ts。
 *
 * ⚠️ 舊版（彈性欄位、姓名必填）已經完全被取代，不是並存的第二套格式
 * （使用者已明確選擇「完全改成只支援這七欄」）：
 *   - 不再要求「姓名」為必填欄位，也不會再顯示「缺少必填欄位：姓名」。
 *   - 改為檢查「家戶成員」是否存在，若存在就自動拆解成多筆姓名。
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

  // 需求明確指示：不要再驗證「姓名」，改為檢查「家戶成員」是否存在；
  // 存在的話自動拆解姓名（依「、」或「，」拆開，見 splitMultiValue）。
  const memberNames = dedupeKeepOrder(splitMultiValue(mapped.householdMembers));
  if (memberNames.length === 0) {
    missingFieldErrors.push("缺少必填欄位「家戶成員」");
  }

  const ancestorNames = dedupeKeepOrder(splitMultiValue(mapped.ancestors));
  const spiritNames = dedupeKeepOrder(splitMultiValue(mapped.spirits));

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
