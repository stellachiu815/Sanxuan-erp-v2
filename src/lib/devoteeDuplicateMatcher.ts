/**
 * V12.0「疑似重複信眾」核心比對邏輯（對應指令「十三」）。
 *
 * 這支檔案刻意不 import 任何依賴 @prisma/client／next 的模組——純粹的
 * 資料比對邏輯，這樣即使在這個沙盒（node_modules 是空的）也能用
 * `npx tsx` 直接載入真正的原始碼執行驗證，方法論跟 src/lib/permissions.ts
 * ／src/lib/backupErrorClassifier.ts 一致。
 *
 * ⚠️「系統只能列出疑似重複資料。不得自動合併。」——這支檔案「只回傳比對
 * 結果」，沒有、也不會提供任何合併資料的函式。呼叫端（API／畫面）只能
 * 讀取這裡的結果供人工確認，畫面上必須顯示「疑似重複僅供人工確認，系統
 * 不會自動刪除或合併資料。」（指令「十三」原文字句）。
 */

export type DuplicateCandidate = {
  memberId: string;
  name: string;
  phone: string | null; // 手機優先，其次家戶電話（由呼叫端決定要傳哪一個當作「電話」比對依據）
  address: string | null;
  birthdayKey: string | null; // 建議用「國曆或農曆生日組合出的穩定字串」，例如 "solar:1990-03-05" 或 "lunar:1990-3-5-false"
  householdId: string;
};

export type DuplicateMatchReason =
  | "SAME_NAME_SAME_PHONE" // 姓名相同且電話相同
  | "SAME_NAME_SAME_ADDRESS" // 姓名相同且地址相同
  | "SAME_NAME_SAME_BIRTHDAY" // 姓名相同且生日相同
  | "SAME_PHONE_DIFFERENT_NAME" // 電話相同但姓名不同
  | "SAME_HOUSEHOLD_SAME_NAME"; // 同一家戶內同名成員

export type DuplicateMatch = {
  reason: DuplicateMatchReason;
  a: DuplicateCandidate;
  b: DuplicateCandidate;
};

/**
 * 逐兩兩比對（O(n^2)，適合在「疑似重複信眾」這種本來就是離線批次檢視的
 * 頁面使用；指令「十八、效能要求」是針對名單/搜尋/時間軸這些高頻互動
 * 畫面，疑似重複清單不在那個效能要求範圍內，見交付報告效能檢查說明）。
 */
export function findDuplicateMatches(candidates: DuplicateCandidate[]): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];

      if (a.memberId === b.memberId) continue;

      const sameName = !!a.name && a.name.trim() === b.name.trim();
      const samePhone = !!a.phone && !!b.phone && a.phone.trim() === b.phone.trim();
      const sameAddress = !!a.address && !!b.address && a.address.trim() === b.address.trim();
      const sameBirthday = !!a.birthdayKey && !!b.birthdayKey && a.birthdayKey === b.birthdayKey;
      const sameHousehold = a.householdId === b.householdId;

      if (sameName && samePhone) matches.push({ reason: "SAME_NAME_SAME_PHONE", a, b });
      if (sameName && sameAddress) matches.push({ reason: "SAME_NAME_SAME_ADDRESS", a, b });
      if (sameName && sameBirthday) matches.push({ reason: "SAME_NAME_SAME_BIRTHDAY", a, b });
      if (samePhone && !sameName) matches.push({ reason: "SAME_PHONE_DIFFERENT_NAME", a, b });
      if (sameHousehold && sameName) matches.push({ reason: "SAME_HOUSEHOLD_SAME_NAME", a, b });
    }
  }

  return matches;
}

export const DUPLICATE_MATCH_REASON_LABEL: Record<DuplicateMatchReason, string> = {
  SAME_NAME_SAME_PHONE: "姓名相同且電話相同",
  SAME_NAME_SAME_ADDRESS: "姓名相同且地址相同",
  SAME_NAME_SAME_BIRTHDAY: "姓名相同且生日相同",
  SAME_PHONE_DIFFERENT_NAME: "電話相同但姓名不同",
  SAME_HOUSEHOLD_SAME_NAME: "同一家戶內同名成員",
};
