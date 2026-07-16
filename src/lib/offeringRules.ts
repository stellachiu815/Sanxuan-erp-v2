import { formatFormalLunarDate } from "@/lib/chineseNumerals";

/**
 * V10.1「供品認捐中心」核心業務規則（純函式、不 import Prisma / 不連線資料庫）。
 *
 * 刻意獨立成這一個檔案（比照 src/lib/additionalPrintItemRules.ts、
 * src/lib/purificationNumbering.ts 的既有慣例），方便在這個沙盒環境裡直接用
 * `tsx --test` 執行真正會通過/失敗的自動測試（見 tests/offeringRules.test.ts），
 * 不用等到能夠 `npm install` 之後才能驗證這裡面最容易出錯的規則：
 *
 * 1. 壽龜「一人一隻」＋跨供品種類互斥（需求「四～六」）。
 * 2. 花果供品「年度 24 筆」自動排程與正式讀法格式（需求「十」，不可顯示
 *    「正月初一」「初一」「十五」）——這裡刻意只用簡單的月/日組合，不需要
 *    呼叫 lunar-javascript（農曆轉換），所以在沒有 npm install 的沙盒
 *    環境裡也能完整測試。
 * 3. 收款狀態推算、金額計算、補印不得產生新應收款（需求「七、十三、十四」）。
 * 4. 散壽桃麵「每盤分開／合為一組」兩種認捐模式的名額計算（需求「九」）。
 */

// ============================================================
// 一、花果供品年度排程（需求「十」「十二」）
// ============================================================

export type FloralSlotSeed = {
  lunarMonth: number;
  lunarDay: number;
  isLeapMonth: boolean;
  sortOrder: number;
};

/**
 * 產生一年份的花果供品排程（固定 24 筆：一月一日、一月十五日……十二月一日、
 * 十二月十五日）。需求「十」明確列出的日期清單，這裡用迴圈產生，不是寫死
 * 24 行常數，方便之後如果要調整規則（例如新增/移除某個月份）時，改這裡的
 * 迴圈邏輯即可。isLeapMonth 一律是 false——如果遇到閏月或特殊年度調整，
 * 由管理者事後手動新增/停用/修改個別日期（見需求「十」最後一句），不在
 * 這支自動產生的函式裡處理。
 */
export function generateFloralOfferingSlots(): FloralSlotSeed[] {
  const slots: FloralSlotSeed[] = [];
  let sortOrder = 0;
  for (let month = 1; month <= 12; month++) {
    for (const day of [1, 15]) {
      slots.push({ lunarMonth: month, lunarDay: day, isLeapMonth: false, sortOrder });
      sortOrder += 1;
    }
  }
  return slots;
}

/**
 * 格式化花果供品的農曆日期，需求「十」明確要求「一月一日」「一月十五日」
 * 這種數值讀法，不可以顯示「正月初一」「初一」「十五」這種民間慣用簡稱。
 *
 * 直接沿用 src/lib/chineseNumerals.ts 的 formatFormalLunarDate()——那支函式
 * 本來就是「正式宮務列印用的農曆日期格式」（數值讀法），combined 產出的
 * 字串正好就是「月的中文數字＋月＋日的中文數字＋日」，例如 (1,15) →
 * 「一月十五日」，跟這裡的需求完全吻合，不需要另外重寫一套格式化邏輯。
 */
export function formatFloralSlotDate(lunarMonth: number, lunarDay: number): string {
  return formatFormalLunarDate(lunarMonth, lunarDay, false).combined;
}

// ============================================================
// 二、壽龜「一人一隻」＋跨供品種類互斥（需求「四～六」）
// ============================================================

export type TurtleConflictCheck = {
  allowed: boolean;
  reason: string | null;
};

/**
 * 檢查「同一信眾是否已經在這個活動認捐過同一種供品」（需求「四」大福壽龜、
 * 「五」小福壽龜的「一人一隻」規則，也適用於任何 allowDuplicateClaim=false
 * 的供品種類，不限於壽龜）。
 */
export function checkDuplicateClaimConflict(
  allowDuplicateClaim: boolean,
  offeringTypeName: string,
  hasExistingActiveClaimOfSameType: boolean
): TurtleConflictCheck {
  if (allowDuplicateClaim) return { allowed: true, reason: null };
  if (hasExistingActiveClaimOfSameType) {
    return {
      allowed: false,
      reason: `同一信眾在這個活動中已經認捐過「${offeringTypeName}」，不能重複登錄`,
    };
  }
  return { allowed: true, reason: null };
}

/**
 * 需求「六、福壽龜共同限制」：**同一位信眾在同一場宮慶（同一個活動年度）
 * 只能得到一隻福壽龜，大福壽龜與小福壽龜合併計算**——這是三玄宮已確認的
 * 固定宮務規則，不是可由一般活動設定畫面關閉的選項（2026-07-16 驗收時
 * 修正：先前版本曾經設計成可由 `TempleEvent.offeringTurtleExclusiveRule`
 * 個別關閉，這不符合實際宮務規則，本輪已移除這個可關閉的設計）。
 *
 * `TempleEvent.offeringTurtleExclusiveRule` 這個資料庫欄位保留下來只是
 * 為了系統彈性（例如未來真的有特殊情況需要處理），但這支函式**不再讀取
 * 這個欄位**，一律強制套用互斥規則——目前系統也沒有任何 API／畫面會讀寫
 * 這個欄位（已確認整個 `src/app/` 沒有任何 PATCH 活動年度的路由或表單
 * 會顯示/修改這個欄位），如果之後真的需要例外處理，必須由最高管理權限
 * 另外寫專用的一次性程式處理，不能透過一般活動管理畫面關閉。
 *
 * @param newClaimBehaviorKind 這一筆新認捐的供品行為分類
 * @param hasExistingActiveTurtleClaimOfDifferentType 這位信眾在這個活動中，
 *   是否已經有其他「壽龜類」供品種類的有效認捐（不含同一種供品——同一種
 *   供品的重複已經由上面的 checkDuplicateClaimConflict 處理）
 */
export function checkTurtleExclusiveConflict(
  newClaimBehaviorKind: string,
  hasExistingActiveTurtleClaimOfDifferentType: boolean
): TurtleConflictCheck {
  if (newClaimBehaviorKind !== "TURTLE") return { allowed: true, reason: null };
  if (hasExistingActiveTurtleClaimOfDifferentType) {
    return {
      allowed: false,
      reason: "同一信眾在同一場活動中只能取得一隻福壽龜（大福壽龜／小福壽龜擇一，合併計算）",
    };
  }
  return { allowed: true, reason: null };
}

// ============================================================
// 三、供品名額計算（需求「四、五、八、九」應有／已認捐／尚缺）
// ============================================================

export type OfferingQuota = {
  expected: number; // 應有數量
  claimed: number; // 已認捐數量
  remaining: number; // 尚缺數量（不會是負數）
};

/**
 * 計算供品名額。claimMode=INDIVIDUAL 時，「已認捐」是所有有效認捐的
 * quantity 加總（例如壽桃麵塔每筆固定 1 對，散壽桃麵每筆固定 1 盤）；
 * claimMode=GROUPED 時（需求「九」散壽桃麵可設定 5 盤合為一組），只要有
 * 一筆有效認捐，就視為「整組已認捐」（expected 固定視為 1 組）。
 */
export function computeOfferingQuota(
  expectedQuantity: number,
  activeClaimQuantities: number[],
  claimMode: "INDIVIDUAL" | "GROUPED" = "INDIVIDUAL"
): OfferingQuota {
  if (claimMode === "GROUPED") {
    const claimed = activeClaimQuantities.length > 0 ? 1 : 0;
    return { expected: 1, claimed, remaining: Math.max(0, 1 - claimed) };
  }
  const claimed = activeClaimQuantities.reduce((sum, q) => sum + q, 0);
  return { expected: expectedQuantity, claimed, remaining: Math.max(0, expectedQuantity - claimed) };
}

// ============================================================
// 四、金額與收款狀態（需求「七、十一、十三」）
// ============================================================

export type OfferingPaymentStatusValue = "UNPAID" | "PARTIAL" | "PAID" | "WAIVED";

/** 應收金額 = 數量 × 單價（免收或未設定單價時為 0，不是 null——避免畫面顯示 NaN）。 */
export function computeAmountDue(quantity: number, unitPrice: number | null, isChargeable: boolean): number {
  if (!isChargeable || unitPrice === null) return 0;
  return round2(quantity * unitPrice);
}

/**
 * 依「應收金額」「已收金額（不含退款）」「是否設定免收」推算收款狀態。
 * 需求「十三」的「已取消」不是這裡的狀態（那是 OfferingClaimStatus，claim
 * 層級的狀態，不是收款狀態）；「跨年度未收款」也不是存在這裡的獨立狀態，
 * 見下方 isCrossYearUnpaid()——是動態判斷出來的提醒旗標，不是收款狀態本身。
 */
export function derivePaymentStatus(
  amountDue: number,
  amountPaid: number,
  isWaived: boolean
): OfferingPaymentStatusValue {
  if (isWaived) return "WAIVED";
  if (amountDue <= 0) return "PAID"; // 不收費的供品，視為已收清（沒有應收款）
  if (amountPaid <= 0) return "UNPAID";
  if (amountPaid >= amountDue) return "PAID";
  return "PARTIAL";
}

/** 需求「七」：跨年度未收款提醒——認捐年度早於目前年度，且收款狀態仍是未收/部分收款。 */
export function isCrossYearUnpaid(
  claimYear: number,
  currentYear: number,
  paymentStatus: OfferingPaymentStatusValue
): boolean {
  return claimYear < currentYear && (paymentStatus === "UNPAID" || paymentStatus === "PARTIAL");
}

/**
 * 需求「十四」：補印（收據/名單/工作清單/得主名單）不得產生新應收款。這支
 * 函式純粹是「不變量」的可測試表達——呼叫端（src/lib/offeringClaims.ts 的
 * reprintOfferingReceipt()）只會遞增 reprintCount／更新 lastReprintAt，
 * 不會呼叫任何會改變 amountDue 的函式；這裡提供一個小工具給測試直接驗證
 * 「補印前後金額不變」。
 */
export function assertReprintPreservesAmounts(
  before: { amountDue: number; amountPaid: number },
  after: { amountDue: number; amountPaid: number }
): boolean {
  return before.amountDue === after.amountDue && before.amountPaid === after.amountPaid;
}

/** 四捨五入到小數點後兩位（金額計算共用，避免浮點數誤差累積）。 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ============================================================
// 五、分次收款加總（需求「十三」不得只存累計金額，每次收款需獨立保存）
// ============================================================

export type PaymentLedgerEntry = {
  kind: "PAYMENT" | "REFUND" | "TRANSFER_OUT" | "TRANSFER_IN";
  amount: number; // 一律為正數，正負意涵由 kind 決定
};

/**
 * 從「每一筆收款/退款/轉款紀錄」加總出目前的已收金額。PAYMENT／TRANSFER_IN
 * 增加已收金額，REFUND／TRANSFER_OUT 減少已收金額——這是唯一一個允許讀取
 * 「目前累計已收金額」的地方，畫面/API 都應該呼叫這支函式即時加總，而不是
 * 讀取任何單獨快取的「最後金額」欄位（OfferingClaim.amountPaid 本身雖然
 * 有存一份，但每次异动都是由這支函式重新加總後寫回，不是使用者直接修改）。
 */
export function sumPaymentLedger(entries: PaymentLedgerEntry[]): number {
  let total = 0;
  for (const e of entries) {
    if (e.kind === "PAYMENT" || e.kind === "TRANSFER_IN") total += e.amount;
    else total -= e.amount;
  }
  return round2(Math.max(0, total));
}

// ============================================================
// 六、散壽桃麵／壽桃麵塔認捐模式顯示文字（需求「八、九」）
// ============================================================

export const offeringClaimModeLabel: Record<"INDIVIDUAL" | "GROUPED", string> = {
  INDIVIDUAL: "每份分開認捐",
  GROUPED: "合為一組認捐",
};
