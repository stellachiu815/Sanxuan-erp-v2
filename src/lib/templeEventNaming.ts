import { digitsToChineseDigits } from "@/lib/chineseNumerals";

/**
 * 宮務活動的預設名稱組字規則：民國年度用「逐字讀法」（跟門牌號碼同一套
 * 規則，例如 115 →「一一五」，不是「一百一十五」），後面接活動名稱。
 *
 * 這支刻意獨立成一個不 import Prisma 的檔案（只依賴同樣零依賴、已經有
 * 完整自動測試的 chineseNumerals.ts），方便在沙盒環境裡直接跑自動測試，
 * 不需要真正的資料庫。src/lib/templeEvents.ts、src/lib/purification.ts
 * 的年度名稱組字都共用這支函式背後的同一套規則。
 */
export function formatTempleEventName(year: number, activityLabel: string): string {
  return `民國${digitsToChineseDigits(String(year))}年度${activityLabel}`;
}
