/**
 * V14.4「白米年度配額」純邏輯（指令四／五）。
 *
 * 刻意不 import Prisma Client（只用型別與純函式），可直接用
 * `npx tsx --test tests/*.test.ts` 執行——與 additionalPrintItemRules.ts／
 * registrationItems.ts 等既有純規則檔一致。
 *
 * 白米不是固定商品，而是每年度由神明指派「總斤數」與「每斤金額」的認購項目：
 * - 每年可能不同，不可寫死、不可直接固定沿用去年。
 * - 收款完全沿用既有應收／收款／分次／未收／活動帳本（RitualRegistrationItem
 *   contentKind=RICE + receivableAdapters），這裡只負責「配額與計價」純規則。
 */

/** 四捨五入到 2 位（沿用全專案 Decimal(12,2) 慣例）。 */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ============================================================
// 一、白米年度設定
// ============================================================

export type RiceYearConfig = {
  /** 年度總斤數（神明指派）。null＝尚未設定。 */
  totalKg: number | null;
  /** 每斤金額。null＝尚未設定。 */
  unitPrice: number | null;
  /** 是否開放認購。 */
  open: boolean;
};

/** 年度白米是否可以認購（已設定總斤數與單價、且開放）。 */
export function isRiceRegistrationOpen(cfg: RiceYearConfig): boolean {
  return cfg.open && cfg.totalKg !== null && cfg.totalKg > 0 && cfg.unitPrice !== null && cfg.unitPrice >= 0;
}

// ============================================================
// 二、應收金額（建立當下鎖定單價）
// ============================================================

/**
 * 白米認購應收金額＝認購斤數 × 該年度每斤金額。
 * 正式建立報名時，unitPrice 應存成 RitualRegistrationItem.lockedUnitPrice，
 * 之後修改年度單價不回頭改動已建立報名（指令四／五、驗收 13）。
 * unitPrice 為 null（年度尚未設定單價）時回 null——不可假裝成 0。
 */
export function computeRiceAmountDue(kg: number, unitPrice: number | null): number | null {
  if (unitPrice === null || !Number.isFinite(unitPrice) || unitPrice < 0) return null;
  if (!Number.isFinite(kg) || kg <= 0) return 0;
  return round2(kg * unitPrice);
}

// ============================================================
// 三、剩餘斤數（由有效正式報名即時彙總，不做快取增減）
// ============================================================

export type RiceRegistrationLike = {
  kg: number;
  /** 是否為有效正式認購（未取消／未刪除／未作廢／非未確認匯入草稿）。 */
  isValid: boolean;
};

/**
 * 有效認購總斤數：只加總 isValid 的認購（排除已取消／已刪除／作廢／未正式確認
 * 的匯入草稿）。呼叫端應以資料庫的「有效正式資料」查出後傳入，或於 transaction
 * 內重新彙總，避免累積誤差（指令四）。
 */
export function sumValidRiceKg(registrations: RiceRegistrationLike[]): number {
  let total = 0;
  for (const r of registrations) {
    if (r.isValid && Number.isFinite(r.kg) && r.kg > 0) total += r.kg;
  }
  return round2(total);
}

export type RiceQuotaSummary = {
  totalKg: number;
  registeredKg: number;
  /** 剩餘可認購斤數＝總斤數 − 有效認購斤數（可為負，代表已超額）。 */
  remainingKg: number;
  isOverbooked: boolean;
};

/**
 * 年度白米配額彙總。剩餘斤數＝totalKg − 有效認購斤數；一律以有效正式資料
 * 重新彙總為準（傳入的 registeredKg 應來自 sumValidRiceKg / DB 彙總）。
 */
export function computeRiceQuota(totalKg: number | null, registeredKg: number): RiceQuotaSummary {
  const total = totalKg !== null && Number.isFinite(totalKg) && totalKg > 0 ? round2(totalKg) : 0;
  const registered = round2(Math.max(0, registeredKg));
  const remaining = round2(total - registered);
  return {
    totalKg: total,
    registeredKg: registered,
    remainingKg: remaining,
    isOverbooked: remaining < 0,
  };
}

// ============================================================
// 四、超額認購檢查（指令四／七、驗收 14）
// ============================================================

export type Role = "SUPER_ADMIN" | "ADMIN" | "STAFF" | "READONLY" | "FINANCE_CLERK";

export type RiceOverageDecision =
  | { ok: true; overage: false }
  | { ok: true; overage: true; requiresReason: true }
  | { ok: false; reason: string; remainingKg: number };

/**
 * 判斷一筆「新增／調整為 requestedKg 斤」的認購是否可建立。
 * - remainingKg：本次認購納入前的剩餘斤數（編輯既有認購時，應先扣除該筆原斤數再算）。
 * - 未超額（requestedKg ≤ remainingKg）：一律可建立。
 * - 超額：READONLY／STAFF 一律不得超額建立（回 ok:false，畫面顯示剩餘斤數）；
 *   SUPER_ADMIN／ADMIN 可超額，但必須留下操作人／時間／原因（requiresReason=true）。
 * 不可默默產生負數而無提示——超額一律要嘛擋下、要嘛帶原因放行。
 */
export function checkRiceOverage(
  role: Role,
  requestedKg: number,
  remainingKg: number,
  reason?: string | null
): RiceOverageDecision {
  const over = round2(requestedKg - remainingKg) > 0;
  if (!over) return { ok: true, overage: false };
  // 超額：
  if (role === "SUPER_ADMIN" || role === "ADMIN") {
    if (!reason || !reason.trim()) {
      return { ok: false, reason: "超額認購必須填寫原因", remainingKg };
    }
    return { ok: true, overage: true, requiresReason: true };
  }
  return { ok: false, reason: `剩餘斤數不足（剩 ${remainingKg} 斤），一般人員不得超額認購`, remainingKg };
}
