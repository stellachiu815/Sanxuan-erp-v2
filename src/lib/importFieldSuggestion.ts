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

// V11.3「信眾資料匯入預檢中心」正式版欄位定義（需求「三玄宮 ERP V11.3
// 家戶匯入正式版（依正式 Excel 格式）」）。正式格式固定只有七欄，一列＝
// 一戶：家戶編號｜戶名｜主要聯絡人｜地址｜歷代祖先｜乙位正魂｜家戶成員。
//
// ⚠️ 這是舊版（household_/member_ 前綴、姓名必填、彈性欄位）的完全取代，
// 不是並存的第二套格式——householdCode／householdName／householdMembers
// 三個欄位標記為必填，取代舊版的「姓名」必填（改為檢查「家戶成員」是否
// 存在，見 devoteeImportValidate.ts）。
const DEVOTEE_PRECHECK_FIELDS: TargetFieldDef[] = [
  { key: "householdCode", label: "家戶編號", required: true },
  { key: "householdName", label: "戶名", required: true },
  { key: "primaryContact", label: "主要聯絡人" },
  { key: "address", label: "地址" },

  /**
   * V12.6 驗收修正：正式家戶 Excel 的實際格式是「所有成員」一欄混合三種
   * 資料（一般家戶成員／歷代祖先／乙位正魂），以逗號分隔，由系統依名稱
   * 內容自動分類（見 devoteeImportValidate.ts classifyAllMembers()）。
   * 這是目前正式檔案的主要來源欄位。
   */
  { key: "allMembers", label: "所有成員（混合：成員／歷代祖先／乙位正魂）" },

  /**
   * 以下兩個數量欄位**僅供驗證**，不會寫入任何資料：系統會把「所有成員」
   * 解析出來的筆數跟這兩個數字比對，對不上就在預檢提出警告，方便及早
   * 發現 Excel 內容被截斷或分隔符打錯。
   */
  { key: "memberCount", label: "家庭成員（數量，僅驗證）" },
  { key: "tabletCount", label: "普渡牌位資料筆數（數量，僅驗證）" },

  /**
   * 以下三欄保留給「已經拆成獨立欄位」的舊檔案，維持向下相容——舊檔案
   * 照樣可以匯入，不需要重做。有「所有成員」時以「所有成員」為準。
   */
  { key: "householdMembers", label: "家戶成員（舊格式：僅一般成員）" },
  { key: "ancestors", label: "歷代祖先（舊格式：獨立欄）" },
  { key: "spirits", label: "乙位正魂（舊格式：獨立欄）" },
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

  // V11.3「信眾資料匯入預檢中心」正式版欄位別名（七欄固定格式，見上方
  // DEVOTEE_PRECHECK_FIELDS 說明）。address 沿用上面已經有的別名，兩種
  // 匯入類型的「地址」別名寫法本來就相同，不需要重複定義。
  householdCode: ["家戶編號", "戶號", "編號"],
  householdName: ["戶名", "家戶名稱", "家戶"],
  primaryContact: ["主要聯絡人", "聯絡人"],
  /**
   * V12.6 驗收修正：正式檔案的「所有成員」混合欄。
   * ⚠️ 別名不含「家庭成員」——那是數量欄，不是名單欄（見 memberCount）。
   */
  allMembers: ["所有成員", "全部成員", "成員名單", "所有成員名單"],
  /** 僅驗證用的數量欄位，不會寫入資料 */
  memberCount: ["家庭成員", "家庭成員數", "家庭成員（數量）", "成員數", "成員人數"],
  tabletCount: ["普渡牌位資料筆數", "牌位資料筆數", "普渡牌位筆數", "牌位筆數"],

  // 舊格式（已拆成獨立欄）的別名，維持向下相容。
  householdMembers: ["家戶成員", "成員"],
  ancestors: ["歷代祖先", "祖先", "歷代祖先牌位", "祖先牌位", "歷代"],
  spirits: ["乙位正魂", "個人乙位正魂", "正魂", "乙位", "乙位正魂牌位", "個人牌位"],
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

  /**
   * V12.6 驗收修正：**同一個系統欄位不可以被兩個 Excel 欄位同時佔用。**
   *
   * 問題現象：正式 Excel 同時有「歷代祖先」與「乙位正魂」兩欄，但使用者
   * 看到的卻像是「只能二選一」。根因有兩個，這裡一起處理：
   *
   *   1. applyMapping() 是 `mapped[target] = value`——兩個 Excel 欄位若對應
   *      到同一個 target，後者會**靜默覆蓋**前者，其中一欄等於整個消失。
   *   2. 欄位對應記憶（ImportFieldMapping）優先於別名比對，而且沒有任何
   *      防重複。只要曾經誤把某一欄存成 ancestors，之後每次上傳都會沿用，
   *      把真正的「歷代祖先」欄擠掉。
   *
   * 修正方式：先用別名做精準比對（別名是系統定義的權威對照），再用記憶
   * 補上別名沒命中的欄位；任何一個 target 一旦被佔用就不再分配給第二欄，
   * 剩下的留空由使用者自行選擇。這樣「歷代祖先」與「乙位正魂」一定會各自
   * 對到自己的欄位，不會互相覆蓋。
   */
  const usedTargets = new Set<string>();

  // 第一輪：別名精準比對（優先權最高，因為這是系統定義的正確對照）
  for (const rawCol of sourceColumns) {
    const col = normalizeColumnName(rawCol);
    const aliasHit = fields.find(
      (f) => !usedTargets.has(f.key) && FIELD_ALIASES[f.key]?.some((alias) => alias === col)
    );
    if (aliasHit) {
      result[rawCol] = aliasHit.key;
      usedTargets.add(aliasHit.key);
    }
  }

  // 第二輪：別名沒命中的欄位，才採用使用者過去的手動對應記憶，
  // 且同樣不可佔用已被別名認領的 target。
  for (const rawCol of sourceColumns) {
    if (result[rawCol]) continue;
    const col = normalizeColumnName(rawCol);
    const rememberedTarget = remembered[col];
    if (rememberedTarget && !usedTargets.has(rememberedTarget)) {
      result[rawCol] = rememberedTarget;
      usedTargets.add(rememberedTarget);
      continue;
    }
    result[rawCol] = null;
  }

  return result;
}
