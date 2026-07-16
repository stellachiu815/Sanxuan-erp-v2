/**
 * 祭改編號自動編列規則（V9.0「祭改管理與小人頭貼紙列印」新增）。
 *
 * 純函式、不 import 任何其他模組（不依賴 Prisma），方便在沙盒環境用
 * `tsx --test` 直接執行自動測試（見 tests/purificationNumbering.test.ts）。
 *
 * 核心規則（對應需求「六、祭改編號自動編列」「七、編號鎖定與取消規則」）：
 * 1. 編號使用阿拉伯數字，依序遞增，但只要編號字串裡出現連續的「44」
 *    （不限於開頭，任何位置只要有連續兩個 4 相鄰）就必須跳過，永遠不使用。
 * 2. 已經正式列印過的編號視為鎖定：取消時保留原編號、不重排、不給別人用。
 * 3. 補報（臨時新增）接續「目前最後一個有效編號」繼續編列，一樣要跳過
 *    含連續 44 的號碼。
 * 4. 只有「尚未正式列印」時，管理者才能執行「重新編號」整批重排——這件事
 *    本身的權限/二次確認由 src/lib/purification.ts 在呼叫這裡的函式之前
 *    先做完，這個檔案只負責「給定一個起點，往後找 N 個可以使用的號碼」。
 */

/** 判斷一個非負整數的十進位字串表示裡，是否包含連續的「44」。 */
export function containsConsecutive44(n: number): boolean {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`containsConsecutive44: 只接受非負整數，收到 ${n}`);
  }
  return String(n).includes("44");
}

/**
 * 判斷這個編號是否被禁用——內建規則「包含連續44」永遠生效（程式邏輯層級，
 * 不是資料庫可關閉的設定），加上管理者額外新增的禁用號碼清單
 * （對應 PurificationBannedNumber 資料表，由呼叫端查出來後傳進來）。
 */
export function isNumberBanned(n: number, extraBanned: Iterable<number> = []): boolean {
  if (containsConsecutive44(n)) return true;
  for (const banned of extraBanned) {
    if (banned === n) return true;
  }
  return false;
}

/** 從 current 的下一個號碼開始，找第一個沒有被禁用的號碼（current 本身不算）。 */
export function nextAvailableNumber(current: number, extraBanned: Iterable<number> = []): number {
  if (!Number.isInteger(current) || current < 0) {
    throw new Error(`nextAvailableNumber: current 必須是非負整數，收到 ${current}`);
  }
  const bannedSet = new Set(extraBanned);
  let candidate = current + 1;
  while (isNumberBanned(candidate, bannedSet)) {
    candidate += 1;
  }
  return candidate;
}

/**
 * 依序產生 count 個可用編號，從 startAfter 之後開始找（跳過所有禁用編號）。
 *
 * 這一個函式同時服務兩種情境（呼叫端只是給不同的 startAfter）：
 * - 全新編號 / 重新編號整批重排：startAfter = 0，從 1 開始編。
 * - 補報接續編號：startAfter = 目前這個年度最後一個有效編號，接續往後編。
 */
export function assignSequentialNumbers(
  count: number,
  startAfter = 0,
  extraBanned: Iterable<number> = []
): number[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`assignSequentialNumbers: count 必須是非負整數，收到 ${count}`);
  }
  const bannedSet = new Set(extraBanned);
  const result: number[] = [];
  let current = startAfter;
  while (result.length < count) {
    current = nextAvailableNumber(current, bannedSet);
    result.push(current);
  }
  return result;
}

/** A4 小人頭貼紙固定每張 33 格：把依編號排序好的陣列，切成每 33 筆一張。 */
export function paginateForPrinting<T>(items: readonly T[], pageSize = 33): T[][] {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error(`paginateForPrinting: pageSize 必須是正整數，收到 ${pageSize}`);
  }
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += pageSize) {
    pages.push(items.slice(i, i + pageSize));
  }
  return pages;
}
