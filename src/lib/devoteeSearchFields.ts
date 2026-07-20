import type { Prisma } from "@prisma/client";
import { normalizeNationalId } from "@/lib/nationalId";

/**
 * V12.2「信眾建立與查詢中心」指令「七、搜尋邏輯收斂」。
 *
 * 系統目前有三套用途不同、且都要保留的搜尋：
 *
 *   1. 首頁快速搜尋      GET /api/search（快速找到某人並跳轉）
 *   2. 信眾名單分頁搜尋  src/lib/devoteeList.ts buildDevoteeWhere()
 *   3. 全宮跨模組搜尋    src/lib/devoteeSearch.ts searchAcrossTemple()
 *
 * 三套的「用途」不同是合理的，問題在於它們各自維護一份「要搜哪些欄位」的
 * 清單，V12.2 盤點時已經分歧成 5 / 11 / 4 個欄位，導致「用戶名搜得到、用
 * 首頁搜尋框搜不到」這種難以解釋的行為。
 *
 * ⚠️ 這支檔案的角色是**單一欄位規格來源**，不是要把三段查詢改寫成同一段：
 * 指令明訂「不得為了抽共用常數而大幅重寫現有查詢」「Prisma relation 結構
 * 不同時，可共用欄位規格或 helper，不強迫三段 where 完全相同」。
 *
 * 因此這裡提供的是「以 Member 為主體」與「以 Household 為主體」兩種
 * relation 結構各自的 where 片段 helper，三套搜尋依自己的主體選用對應的
 * helper，查詢的 take／排序／分頁／篩選條件全部維持各自既有的作法。
 */

/**
 * 信眾／家戶搜尋的共同欄位規格（人類可讀，供畫面提示與文件使用）。
 * 修改搜尋涵蓋範圍時，請從這裡開始改，再同步下面兩個 helper。
 */
export const DEVOTEE_SEARCH_FIELD_LABELS = [
  "信眾姓名",
  "家戶編號",
  "家戶舊編號（歷史對照）",
  "戶名",
  "主要聯絡人",
  "家戶電話",
  "家戶手機",
  "個人手機",
  "地址",
  "公司名稱",
  // V13.1 指令一：身分證字號可搜尋。
  // ⚠️ 只做**完全比對**，不做 contains——身分證是個資，用 contains
  // 會讓輸入片段（例如「1234」）掃出一堆不相干的人，等於變相的個資列舉。
  // 行政人員實際使用情境是「拿著證件輸入完整號碼找人」，完全比對就夠了。
  "身分證字號（需輸入完整號碼）",
] as const;

/** 給輸入框用的統一 placeholder，避免各頁自己寫一句不一樣的提示。 */
export const DEVOTEE_SEARCH_PLACEHOLDER = "搜尋姓名、電話、地址、身分證、家戶編號（含舊編號）或戶名";

/**
 * 以 **Member** 為查詢主體時的 OR 條件片段。
 * 用於：首頁快速搜尋（成員部分）、信眾名單分頁搜尋、全宮搜尋的「信眾」分類。
 *
 * 涵蓋 DEVOTEE_SEARCH_FIELD_LABELS 全部九項：成員自己的姓名、所屬家戶的
 * 各欄位、以及信眾延伸資料（DevoteeProfile）的個人手機與公司名稱。
 */
export function memberSearchOrConditions(q: string): Prisma.MemberWhereInput[] {
  return [
    { name: { contains: q } },
    { household: { id: { contains: q } } },
    // V12.4：家戶舊編號（V12.3 的 HouseholdCodeAlias）。行政人員手上的紙本與
    // 舊 Excel 仍然是改編號前／合併前的編號，用舊編號也要搜得到目前這一戶。
    { household: { codeAliases: { some: { oldCode: { contains: q } } } } },
    { household: { name: { contains: q } } },
    { household: { contactName: { contains: q } } },
    { household: { phone: { contains: q } } },
    { household: { mobile: { contains: q } } },
    { household: { address: { contains: q } } },
    { household: { companyName: { contains: q } } },
    { devoteeProfile: { is: { mobile: { contains: q } } } },
    { devoteeProfile: { is: { companyName: { contains: q } } } },
    // V13.1：身分證完全比對（見上方 DEVOTEE_SEARCH_FIELD_LABELS 的說明）。
    ...nationalIdSearchCondition(q),
  ];
}

/**
 * 身分證搜尋條件。只有在輸入看起來確實是一組完整身分證時才產生條件，
 * 否則回傳空陣列（等於不參與這次搜尋）。
 *
 * 這樣做的效果：搜尋「王」不會誤觸身分證欄位，搜尋「A123456789」才會。
 */
function nationalIdSearchCondition(q: string): Prisma.MemberWhereInput[] {
  const normalized = normalizeNationalId(q);
  if (normalized === null || normalized.length !== 10) return [];
  return [{ nationalId: normalized }];
}

/**
 * 以 **Household** 為查詢主體時的 OR 條件片段。
 * 用於：首頁快速搜尋（家戶部分）、全宮搜尋的「家戶」分類。
 *
 * 注意：這裡刻意**不含**成員姓名與個人手機——那些屬於 Member 主體，由
 * 上面的 memberSearchOrConditions() 負責，避免同一筆資料在同一份結果裡
 * 用兩種身分各出現一次。
 */
export function householdSearchOrConditions(q: string): Prisma.HouseholdWhereInput[] {
  return [
    { id: { contains: q } },
    // V12.4：家戶舊編號（見上方 memberSearchOrConditions 的同一項說明）。
    { codeAliases: { some: { oldCode: { contains: q } } } },
    { name: { contains: q } },
    { contactName: { contains: q } },
    { phone: { contains: q } },
    { mobile: { contains: q } },
    { address: { contains: q } },
    { companyName: { contains: q } },
  ];
}
