/**
 * Excel智慧匯入」的欄位自動辨識規則（需求「八」）：目標欄位定義＋常見別名
 * 對照表＋純函式版的「猜欄位對應」。刻意獨立成不 import Prisma／xlsx 的
 * 檔案，方便在沙盒環境裡直接跑自動測試——「已儲存的欄位對應記憶」由
 * src/lib/smartImport.ts 查資料庫取得後，當成普通參數傳進來，這裡完全
 * 不碰資料庫。
 */

export type ImportKind =
  | "PURIFICATION"
  | "GENERIC_ACTIVITY"
  | "ADDITIONAL_PRINT_ITEM"
  | "OFFERING_CLAIM"
  | "DEVOTEE_PRECHECK"; // V11.3「信眾資料匯入預檢中心」新增

export type TargetFieldDef = { key: string; label: string; required?: boolean };

const PURIFICATION_FIELDS: TargetFieldDef[] = [
  { key: "householdId", label: "家戶編號", required: true },
  { key: "displayName", label: "姓名", required: true },
  { key: "gender", label: "性別" },
  { key: "solarBirthDate", label: "國曆生日" },
  { key: "lunarBirthDate", label: "農曆生日" },
  { key: "address", label: "地址" },
  { key: "phone", label: "電話" },
  { key: "paymentAmount", label: "收款金額" },
  { key: "notes", label: "備註" },
];

const GENERIC_ACTIVITY_FIELDS: TargetFieldDef[] = [
  { key: "householdId", label: "家戶編號", required: true },
  { key: "amount", label: "金額" },
  { key: "notes", label: "備註" },
];

// V9.1「附加列印項目」Excel 匯入方式二（明細工作表）欄位定義。原祭祀類型／
// 原祭祀名稱是用來比對「這一列要掛在哪一筆歷代祖先/冤親債主/個人乙位正魂/
// 無緣子女底下」，找不到對應來源資料時，src/lib/additionalPrintItems.ts
// 會把這一列列入待確認，不會直接匯入（需求「八」）。
const ADDITIONAL_PRINT_ITEM_FIELDS: TargetFieldDef[] = [
  { key: "householdId", label: "家戶編號", required: true },
  { key: "registrantName", label: "報名人" },
  { key: "sourceCategory", label: "原祭祀類型", required: true },
  { key: "sourceName", label: "原祭祀名稱", required: true },
  { key: "itemType", label: "附加項目類型", required: true },
  { key: "printName", label: "列印名稱", required: true },
  { key: "quantity", label: "數量" },
  { key: "isExtra", label: "預設／額外" },
  { key: "notes", label: "備註" },
];

// V10.1「供品認捐中心」Excel 匯入欄位定義（需求「八」，支援方式一：固定
// 欄位／方式二：專屬工作表，兩種都是把 Excel 每一列對應到這組欄位，差別只
// 在檔案格式本身，欄位定義是共用的）。offeringTypeName／floralLunarMonth／
// floralLunarDay 用來比對這一列要認捐哪一種供品／哪一個花果供品日期名額，
// 找不到對應資料時，src/lib/offeringImport.ts 會把這一列列入待確認清單，
// 不會直接匯入。
const OFFERING_CLAIM_FIELDS: TargetFieldDef[] = [
  { key: "householdId", label: "家戶編號", required: true },
  { key: "sponsorName", label: "認捐人姓名", required: true },
  { key: "offeringTypeName", label: "供品名稱", required: true },
  { key: "floralLunarMonth", label: "花果供品農曆月" },
  { key: "floralLunarDay", label: "花果供品農曆日" },
  { key: "quantity", label: "數量" },
  { key: "unitPrice", label: "單價" },
  { key: "paidAmount", label: "已收金額" },
  { key: "notes", label: "備註" },
];

// V11.3「信眾資料匯入預檢中心」欄位定義（需求「第三步」）。key 用
// household_/member_ 前綴區分兩組資料，避免跟其他 ImportKind 或彼此的
// key 撞名；「戶號或原系統編號」直接對應既有 Household.id（VarChar(10)，
// 見 src/lib/importRules.ts 既有家戶批次匯入的相同慣例，不是新概念）。
const DEVOTEE_PRECHECK_FIELDS: TargetFieldDef[] = [
  // ⚠️ 這裡刻意「不」標記 required：true。跟其他匯入類型不同，這個欄位
  // 只是「第七步」家戶分組判斷的其中一個線索（見
  // devoteeImportValidate.ts 開頭註解的完整說明），沒有填也不會被擋成
  // 「資料不完整」，只是會被歸類成「待確認家戶」需要人工補上。這裡的
  // required 標記只給前端欄位對照畫面顯示用，如果標成 true 會跟實際驗證
  // 行為（devoteeImportValidate.ts 只有姓名是必填）不一致，誤導使用者。
  { key: "household_code", label: "戶號或原系統編號" },
  { key: "household_contactName", label: "主要聯絡人" },
  { key: "household_phone", label: "電話" },
  { key: "household_mobile", label: "手機" },
  { key: "household_address", label: "地址" },
  { key: "household_companyName", label: "公司名稱" },
  { key: "household_notes", label: "家戶備註" },
  { key: "member_name", label: "姓名", required: true },
  { key: "member_gender", label: "性別" },
  { key: "member_solarBirthDate", label: "國曆生日" },
  { key: "member_lunarBirthDate", label: "農曆生日" },
  { key: "member_lunarBirthMonth", label: "農曆出生月" },
  { key: "member_lunarBirthDay", label: "農曆出生日" },
  { key: "member_birthHour", label: "出生時辰" },
  { key: "member_zodiac", label: "生肖" },
  { key: "member_relationToHead", label: "與戶主關係" },
  { key: "member_isDeceased", label: "是否往生" },
  { key: "member_yangshangName", label: "陽上姓名" },
  { key: "member_notes", label: "個人備註" },
];

export function getTargetFields(importKind: ImportKind): TargetFieldDef[] {
  if (importKind === "PURIFICATION") return PURIFICATION_FIELDS;
  if (importKind === "ADDITIONAL_PRINT_ITEM") return ADDITIONAL_PRINT_ITEM_FIELDS;
  if (importKind === "OFFERING_CLAIM") return OFFERING_CLAIM_FIELDS;
  if (importKind === "DEVOTEE_PRECHECK") return DEVOTEE_PRECHECK_FIELDS;
  return GENERIC_ACTIVITY_FIELDS;
}

// 常見別名，找不到已儲存的欄位對應記憶時，先用這套簡單規則猜一次
// （「智慧辨識」），猜不到才需要人工手動選擇。
export const FIELD_ALIASES: Record<string, string[]> = {
  householdId: ["家戶編號", "家戶", "戶號", "編號"],
  displayName: ["姓名", "報名人姓名", "信眾姓名", "全名"],
  gender: ["性別"],
  solarBirthDate: ["國曆生日", "國曆出生日期", "生日", "出生日期"],
  lunarBirthDate: ["農曆生日", "農曆出生日期"],
  address: ["地址", "住址", "戶籍地址"],
  phone: ["電話", "手機", "聯絡電話", "手機號碼"],
  paymentAmount: ["收款金額", "金額", "費用", "應收金額"],
  amount: ["金額", "費用", "收費"],
  notes: ["備註", "說明", "附註"],
  registrantName: ["報名人", "報名人姓名"],
  sourceCategory: ["原祭祀類型", "祭祀類型", "類別"],
  sourceName: ["原祭祀名稱", "祭祀名稱"],
  itemType: ["附加項目類型", "項目類型"],
  printName: ["列印名稱", "寶袋名稱"],
  quantity: ["數量"],
  isExtra: ["預設／額外", "預設/額外", "是否為額外"],
  sponsorName: ["認捐人姓名", "認捐人", "姓名"],
  offeringTypeName: ["供品名稱", "供品種類", "供品項目"],
  floralLunarMonth: ["花果供品農曆月", "農曆月"],
  floralLunarDay: ["花果供品農曆日", "農曆日"],
  unitPrice: ["單價"],
  paidAmount: ["已收金額", "已收款", "已付金額"],

  // V11.3「信眾資料匯入預檢中心」欄位別名。
  household_code: ["戶號", "原系統編號", "家戶編號", "戶號或原系統編號", "編號"],
  household_contactName: ["主要聯絡人", "聯絡人"],
  household_phone: ["電話", "家用電話", "市內電話", "聯絡電話"],
  household_mobile: ["手機", "手機號碼", "行動電話"],
  household_address: ["地址", "住址", "戶籍地址"],
  household_companyName: ["公司名稱", "公司"],
  household_notes: ["家戶備註", "備註"],
  member_name: ["姓名", "信眾姓名", "全名"],
  member_gender: ["性別"],
  member_solarBirthDate: ["國曆生日", "國曆出生日期", "生日", "出生日期"],
  member_lunarBirthDate: ["農曆生日", "農曆出生日期"],
  member_lunarBirthMonth: ["農曆出生月", "農曆月"],
  member_lunarBirthDay: ["農曆出生日", "農曆日"],
  member_birthHour: ["出生時辰", "時辰"],
  member_zodiac: ["生肖"],
  member_relationToHead: ["與戶主關係", "稱謂", "關係"],
  member_isDeceased: ["是否往生", "是否已辭世", "往生", "在世狀態"],
  member_yangshangName: ["陽上姓名"],
  member_notes: ["個人備註", "備註", "說明"],
};

export function normalizeColumnName(name: string): string {
  return name.trim();
}

/**
 * 純函式版「猜欄位對應」：已儲存記憶（remembered，key 是去除空白後的欄位
 * 名稱）優先，找不到才用別名表。都對不到就回傳 null（前端顯示成
 * 「（不匯入）」，需要人工手動選擇）。
 *
 * ⚠️ 回傳物件的 key 刻意用「原始」欄位名稱（rawCol，不去除空白），跟
 * Excel 解析出來的欄位名稱（parseSpreadsheetBuffer 的 columns/rows 的 key）
 * 完全一致——只有「查記憶／查別名表」這個比對步驟才用去除空白後的版本，
 * 避免前端拿原始欄位名稱去查這個對應表時，因為多了頭尾空白而查不到。
 */
export function suggestColumnMappingPure(
  importKind: ImportKind,
  sourceColumns: string[],
  remembered: Record<string, string>
): Record<string, string | null> {
  const fields = getTargetFields(importKind);
  const result: Record<string, string | null> = {};

  for (const rawCol of sourceColumns) {
    const col = normalizeColumnName(rawCol);
    if (remembered[col]) {
      result[rawCol] = remembered[col];
      continue;
    }
    const aliasHit = fields.find((f) => FIELD_ALIASES[f.key]?.some((alias) => alias === col));
    result[rawCol] = aliasHit ? aliasHit.key : null;
  }
  return result;
}
