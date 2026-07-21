/**
 * V13.3B：寶袋計價規則的**唯一真實來源**。
 *
 * 純函式、零相依，可直接用 node 測試。
 *
 * ── 三層價格來源，優先順序由高到低 ──────────────────────────
 *   1. 單筆寶袋自己的 unitPrice（AdditionalPrintItem.unitPrice）
 *      —— 建立當下的**快照**，之後年度預設價再怎麼改都不會動到它
 *   2. 該年度活動的預設價（TempleEvent.pocketUnitPrice）
 *      —— 只在**新增**寶袋時帶入，不會回頭重算既有資料
 *   3. 系統預設 300（DEFAULT_POCKET_UNIT_PRICE）
 *      —— 舊活動的 pocketUnitPrice 是 NULL 時的 fallback
 *
 * ⚠️ 為什麼 subtotal 必須永遠重算、不能信任前端：
 * 前端可以送任意 subtotal。若伺服器直接採用，等於讓使用者自訂應收金額。
 * 所以 computePocketSubtotal() 是唯一產生 subtotal 的地方，
 * 所有 CRUD 路徑都必須經過它。
 */

/** 系統預設寶袋單價（元）。舊活動 pocketUnitPrice 為 null 時使用。 */
export const DEFAULT_POCKET_UNIT_PRICE = 300;

/**
 * 取得「新增寶袋時」應該帶入的單價。
 *
 * @param activityPocketUnitPrice 該年度活動的 TempleEvent.pocketUnitPrice
 *        （Decimal 轉成 number 後傳入；null／undefined 代表活動沒設定）
 */
export function resolvePocketUnitPrice(
  activityPocketUnitPrice: number | null | undefined
): number {
  if (
    activityPocketUnitPrice === null ||
    activityPocketUnitPrice === undefined ||
    !Number.isFinite(activityPocketUnitPrice) ||
    activityPocketUnitPrice < 0
  ) {
    return DEFAULT_POCKET_UNIT_PRICE;
  }
  return activityPocketUnitPrice;
}

export type PocketSubtotalInput = {
  isChargeable: boolean;
  /** 單價。isChargeable 為 true 時必填 */
  unitPrice: number | null | undefined;
  quantity: number;
};

export type PocketSubtotalResult =
  | { ok: true; subtotal: number }
  | { ok: false; error: string };

/**
 * 計算寶袋應收小計。**這是唯一允許產生 subtotal 的函式。**
 *
 * 規則（指令第四階段）：
 *   - quantity 必須大於 0
 *   - unitPrice 不得小於 0
 *   - subtotal 永遠 = quantity × unitPrice，不接受前端傳入
 *   - isChargeable=false → subtotal 固定 0（免費贈送，不進待收款）
 */
export function computePocketSubtotal(input: PocketSubtotalInput): PocketSubtotalResult {
  const { isChargeable, unitPrice, quantity } = input;

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, error: "數量必須是大於 0 的整數" };
  }

  // 免費贈送：小計固定 0，不進待收款清單
  if (!isChargeable) {
    return { ok: true, subtotal: 0 };
  }

  if (unitPrice === null || unitPrice === undefined || !Number.isFinite(unitPrice)) {
    return { ok: false, error: "收費項目必須設定單價" };
  }
  if (unitPrice < 0) {
    return { ok: false, error: "單價不得小於 0" };
  }

  // 以「分」為單位運算後再還原，避免浮點數誤差（例如 0.1 * 3 !== 0.3）
  const cents = Math.round(unitPrice * 100) * quantity;
  return { ok: true, subtotal: cents / 100 };
}

/**
 * 依實際已收金額判斷付款狀態。
 *
 * ⚠️ 指令第四階段之 9：isPaid **不得由前端切換**，必須依實際分配款項判斷。
 * 這支是唯一的判斷邏輯，CRUD 與 adapter 都用它。
 */
export function resolvePocketPaymentState(subtotal: number, amountPaid: number): {
  isPaid: boolean;
  amountUnpaid: number;
  status: "FREE" | "UNPAID" | "PARTIAL" | "PAID";
} {
  const due = Number.isFinite(subtotal) ? subtotal : 0;
  const paid = Number.isFinite(amountPaid) ? amountPaid : 0;
  const unpaid = Math.max(Math.round((due - paid) * 100) / 100, 0);

  if (due <= 0) {
    // 免費項目：不進待收款，也不算「已付款」
    return { isPaid: false, amountUnpaid: 0, status: "FREE" };
  }
  if (paid <= 0) return { isPaid: false, amountUnpaid: unpaid, status: "UNPAID" };
  if (paid >= due) return { isPaid: true, amountUnpaid: 0, status: "PAID" };
  return { isPaid: false, amountUnpaid: unpaid, status: "PARTIAL" };
}

export type PocketMutationGuard =
  | { ok: true }
  | { ok: false; error: string };

/**
 * 修改數量／單價前的財務防呆（指令第五階段之二）。
 *
 * 規則：新的 subtotal **不得小於已收金額**。
 * 否則會出現「已收 600、應收被改成 300」這種無法對帳的狀態。
 */
export function assertSubtotalNotBelowPaid(
  newSubtotal: number,
  amountPaid: number
): PocketMutationGuard {
  if (amountPaid > 0 && newSubtotal < amountPaid) {
    return {
      ok: false,
      error:
        `這筆寶袋已收款 ${amountPaid} 元，新的應收金額 ${newSubtotal} 元低於已收金額。` +
        `請先辦理退款或沖銷差額後，再調整數量或單價。`,
    };
  }
  return { ok: true };
}

/**
 * 取消／刪除前的財務防呆（指令第五階段之三、四）。
 *
 * 已有任何付款分配的寶袋，一律不得直接取消或刪除——
 * 必須先完成退款／沖銷，才能讓帳目保持一致。
 */
export function assertNoPaymentBeforeRemoval(
  amountPaid: number,
  action: "取消" | "刪除" | "永久刪除"
): PocketMutationGuard {
  if (amountPaid > 0) {
    return {
      ok: false,
      error:
        `這筆寶袋已有 ${amountPaid} 元的收款紀錄，不能直接${action}。` +
        `請先於收款中心辦理退款或沖銷，完成後才能${action}。`,
    };
  }
  return { ok: true };
}
