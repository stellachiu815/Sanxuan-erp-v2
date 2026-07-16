/**
 * 祭改小人頭「列印前檢查／待確認清單」規則（V9.0 新增）。
 *
 * 純函式、只 import 同樣是純函式的 chineseNumerals.ts（不 import Prisma、
 * 不 import lunar-javascript），方便在沙盒環境用 `tsx --test` 直接執行
 * 自動測試（見 tests/purificationConsistency.test.ts）。
 *
 * 對應需求「十三、列印預覽」列出的「不得直接列印」清單：
 * 性別未填 / 農曆生日未填 / 出生年份不足以計算歲數 / 地址未填 /
 * 文字超出 / 內容重疊 / 編號重複 / 誤用禁用編號 / 建生瑞生與性別不一致。
 *
 * 「建生／瑞生與性別不一致」這一項在這個系統的設計裡結構性不可能發生——
 * 吉時建生／瑞生永遠是從性別即時算出來的（見 chineseNumerals.ts 的
 * formatJishi），沒有另外開放「手動指定建生或瑞生」的欄位，所以不需要
 * 額外檢查兩者是否一致；只要性別本身正確，建生／瑞生就一定正確。
 */

import type { NormalizedGender } from "./chineseNumerals";

export type PurificationPrintCheckInput = {
  gender: NormalizedGender;
  /** 是否有足夠資料換算出「出生農曆年」（國曆或農曆生日擇一有值即可）。 */
  hasBirthYearData: boolean;
  /** src/lib/purificationAge.ts 的 resolveNominalAgeForMinguoYear 是否算出合理歲數。 */
  ageResolutionOk: boolean;
  address: string | null | undefined;
  number: number | null | undefined;
  isBannedNumber: boolean;
  isDuplicateNumber: boolean;
  /** 來自 src/lib/purificationLayout.ts 的 optimizeCell 結果。 */
  layoutNeedsManualReview: boolean;
  layoutReviewReasons: readonly string[];
};

export type PurificationPrintCheckResult = {
  canPrint: boolean;
  issues: string[];
};

/** 檢查一筆祭改報名資料是否可以直接列印；只要有任何一項問題，一律回傳
 *  canPrint=false，交給畫面列入「待確認清單」，不得略過問題直接列印。 */
export function checkPurificationPrintReadiness(
  input: PurificationPrintCheckInput
): PurificationPrintCheckResult {
  const issues: string[] = [];

  if (input.gender === "UNKNOWN") {
    issues.push("性別未填寫，無法判斷吉時建生／瑞生");
  }
  if (!input.hasBirthYearData) {
    issues.push("農曆生日未填寫");
  } else if (!input.ageResolutionOk) {
    issues.push("出生年份不足以計算歲數");
  }
  if (!input.address || input.address.trim() === "") {
    issues.push("地址未填寫");
  }
  if (input.number === null || input.number === undefined) {
    issues.push("尚未編號");
  }
  if (input.isBannedNumber) {
    issues.push("誤用禁用編號");
  }
  if (input.isDuplicateNumber) {
    issues.push("編號重複");
  }
  if (input.layoutNeedsManualReview) {
    issues.push(...input.layoutReviewReasons);
  }

  return { canPrint: issues.length === 0, issues };
}
