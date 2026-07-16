import { round2, derivePaymentStatus, isCrossYearUnpaid } from "@/lib/offeringRules";

/**
 * V11.0「全宮共用收款中心」核心業務規則（純函式、不 import Prisma / 不連線
 * 資料庫）。比照 V10.1 src/lib/offeringRules.ts 的既有慣例獨立成這一個檔案，
 * 方便在沙盒環境用 `tsx --test` 直接驗證，不用等到能夠 `npm install` 之後
 * 才能測試最容易出錯的金額計算規則。
 *
 * 這裡刻意重新 export（re-export）round2/derivePaymentStatus/isCrossYearUnpaid，
 * 讓收款中心的程式碼統一從這個檔案 import 收款相關的共用規則——實際計算
 * 邏輯仍然是 offeringRules.ts 裡同一份，不是另外複製一套，避免兩邊算法
 * 之後被改得不一致。
 */
export { round2, derivePaymentStatus, isCrossYearUnpaid };

// ============================================================
// 一、合併收款：多筆分配金額必須加總等於收款總額
// ============================================================

export type AllocationAmountInput = { amount: number };

/**
 * 需求「合併收款」：一次收款（PaymentTransaction）底下可能有多筆分配
 * （PaymentAllocation），例如龜3000+花果1500+燈600+油香2000=7100。這裡驗證
 * 每一筆分配金額都是正數，且加總必須「剛好」等於使用者輸入的收款總額，
 * 不允許有金額對不上的合併收款被建立。
 */
export function validateAllocationsMatchTotal(
  allocations: AllocationAmountInput[],
  totalAmount: number
): { ok: boolean; error: string | null } {
  if (!allocations.length) return { ok: false, error: "至少需要一筆分配項目" };
  for (const a of allocations) {
    if (!Number.isFinite(a.amount) || a.amount <= 0) {
      return { ok: false, error: "每一筆分配金額都必須是大於 0 的數字" };
    }
  }
  const sum = round2(allocations.reduce((s, a) => s + a.amount, 0));
  if (sum !== round2(totalAmount)) {
    return { ok: false, error: `分配金額加總（${sum}）與收款總額（${round2(totalAmount)}）不相符` };
  }
  return { ok: true, error: null };
}

// ============================================================
// 二、收款序號
// ============================================================

/** 收款序號格式：PT-{年度}-{6位數流水號}，例如 PT-115-000001。 */
export function formatTransactionNo(year: number, sequence: number): string {
  return `PT-${year}-${String(sequence).padStart(6, "0")}`;
}

// ============================================================
// 三、財務來源識別碼（防重複入帳預留機制）
// ============================================================

/**
 * 財務來源識別碼：{來源類型}:{來源id}:{收款交易id}。這個組合本身就保證
 * 「同一個來源在同一筆收款交易裡只會有一個財務識別碼」，搭配資料庫的
 * unique 限制，作為未來財務中心「同一筆收款不會被重複計入收入」的預留
 * 防重複機制（本輪沒有任何程式碼真正寫入財務中心資料表）。
 */
export function buildFinanceSourceKey(sourceType: string, sourceId: string, paymentTransactionId: string): string {
  return `${sourceType}:${sourceId}:${paymentTransactionId}`;
}

/**
 * V11.0.1 新增：退款/轉款/作廢也是一次獨立的金融事件，同樣需要防重複入帳的
 * 財務來源識別碼——格式 `ADJUSTMENT:{分配紀錄id}:{調整紀錄id}`，跟上面
 * `buildFinanceSourceKey` 是兩組不同命名空間的識別碼（分別對應
 * PaymentAllocation.financeSourceKey／PaymentAdjustment.financeSourceKey 兩個
 * 各自獨立 unique 的欄位），不會互相阻擋合法的「先收款、後退款」流程。
 */
export function buildAdjustmentFinanceSourceKey(sourceAllocationId: string, adjustmentId: string): string {
  return `ADJUSTMENT:${sourceAllocationId}:${adjustmentId}`;
}

/**
 * V11.0.2 新增：代收對帳批次自己的財務識別碼——格式
 * `RECONCILIATION:{代收人}:{對帳紀錄id}`，是第三組獨立命名空間。代收繳回
 * 是「資金持有狀態移轉」，不是第二次收入，所以這個識別碼刻意不用
 * `buildFinanceSourceKey()`（收入事件專用）的格式，避免將來財務中心把它
 * 誤判成收入型識別碼。
 */
export function buildReconciliationFinanceSourceKey(agentName: string, reconciliationRecordId: string): string {
  return `RECONCILIATION:${agentName}:${reconciliationRecordId}`;
}

// ============================================================
// 四、代收對帳：差異金額與是否需要填寫原因
// ============================================================

export function computeReconciliationDifference(
  expectedAmount: number,
  actualAmount: number
): { differenceAmount: number; requiresReason: boolean } {
  const differenceAmount = round2(actualAmount - expectedAmount);
  return { differenceAmount, requiresReason: differenceAmount !== 0 };
}

// ============================================================
// 五、退款／轉款／保留溢收／作廢：金額不得超過原始分配金額
// ============================================================

export function validateAdjustmentAmount(
  allocationAmount: number,
  adjustmentAmount: number
): { ok: boolean; error: string | null } {
  if (!Number.isFinite(adjustmentAmount) || adjustmentAmount <= 0) {
    return { ok: false, error: "請輸入正確的調整金額" };
  }
  if (round2(adjustmentAmount) > round2(allocationAmount)) {
    return { ok: false, error: "調整金額不得超過原始分配金額" };
  }
  return { ok: true, error: null };
}

// ============================================================
// 六、統一付款狀態（V11.0.1 新增）——所有應收來源共用同一套計算規則
// ============================================================

/**
 * 需求「統一付款狀態計算」的 8 種狀態。這是收款中心「顯示層」使用的
 * 通用狀態，跟各模組自己既有的狀態欄位（例如 OfferingClaimStatus／
 * OfferingPaymentStatus 兩個獨立欄位）不是同一件事——這支函式負責把
 * 每個來源自己的「生命週期狀態」＋「金額」統一收斂成這 8 種狀態，讓畫面
 * 不需要為不同來源各自寫一套文字或計算公式。
 */
export type UniversalPaymentStatusValue =
  | "UNPAID"
  | "PARTIAL"
  | "PAID"
  | "WAIVED"
  | "CANCELLED"
  | "REFUND_PENDING"
  | "REFUNDED"
  | "TRANSFERRED";

/** 各來源自己的生命週期狀態，統一收斂成這 5 種再交給下面的函式判斷。 */
export type SourceLifecycleStatus = "ACTIVE" | "CANCELLED" | "REFUND_PENDING" | "REFUNDED" | "TRANSFERRED";

export function deriveUniversalPaymentStatus(input: {
  lifecycleStatus: SourceLifecycleStatus;
  amountDue: number | null;
  amountPaid: number;
  isWaived: boolean;
}): UniversalPaymentStatusValue {
  if (input.lifecycleStatus === "CANCELLED") return "CANCELLED";
  if (input.lifecycleStatus === "REFUND_PENDING") return "REFUND_PENDING";
  if (input.lifecycleStatus === "REFUNDED") return "REFUNDED";
  if (input.lifecycleStatus === "TRANSFERRED") return "TRANSFERRED";
  if (input.isWaived) return "WAIVED";
  const amountDue = input.amountDue ?? 0;
  if (amountDue <= 0) return "PAID";
  if (input.amountPaid <= 0) return "UNPAID";
  if (input.amountPaid >= amountDue) return "PAID";
  return "PARTIAL";
}

// ============================================================
// 七、防止重複收款：本次金額不得超過「即時」未收金額
// ============================================================

/**
 * 送出收款前的最後一道純邏輯檢查（伺服器端在資料庫交易裡，用剛查到的
 * 最新 amountUnpaid 呼叫這支函式；真正防止「兩人同時收款」的機制是
 * collectionCenter.ts 用資料庫原子條件式 UPDATE 達成，這支函式只是把
 * 「本次金額是否超過未收金額」這條純數學規則抽出來單獨測試）。
 */
// ============================================================
// 八、祭改收費狀態變更規則（V11.0.2 新增，從 src/lib/purification.ts 抽出
//    純邏輯，讓「未設定/收費/免收」三態切換規則可以獨立測試）
// ============================================================

export type PurificationFeeStatusValue = "UNSET" | "CHARGEABLE" | "WAIVED";

export type ResolveFeeStatusInput = {
  feeStatus?: PurificationFeeStatusValue;
  amountDue?: number | null;
  existingFeeStatus: PurificationFeeStatusValue;
  existingAmountDue: number | null;
  existingAmountPaid: number;
};

export type ResolveFeeStatusResult =
  | { ok: true; feeStatus?: PurificationFeeStatusValue; amountDue: number | null; amountUnpaid: number }
  | { ok: false; error: string };

/**
 * 需求「不得將空白金額自動當成零元已付款」：設為 CHARGEABLE（收費）卻沒有
 * 可用的應收金額時直接擋下；設為 WAIVED（免收）或 UNSET（尚未設定）一律
 * 明確清空應收/未收金額（不是留著舊值，也不是猜一個 0）。
 */
export function resolveFeeStatusUpdate(input: ResolveFeeStatusInput): ResolveFeeStatusResult {
  if (input.feeStatus !== undefined) {
    if (input.feeStatus === "CHARGEABLE") {
      const amountDue = input.amountDue ?? input.existingAmountDue;
      if (amountDue === null || amountDue === undefined) {
        return { ok: false, error: "設定為收費時，請填寫應收金額" };
      }
      return {
        ok: true,
        feeStatus: "CHARGEABLE",
        amountDue,
        amountUnpaid: Math.max(0, amountDue - input.existingAmountPaid),
      };
    }
    // WAIVED（免收）或 UNSET（尚未設定）
    return { ok: true, feeStatus: input.feeStatus, amountDue: null, amountUnpaid: 0 };
  }

  if (input.amountDue !== undefined && input.existingFeeStatus === "CHARGEABLE") {
    const amountDue = input.amountDue ?? 0;
    return { ok: true, amountDue, amountUnpaid: Math.max(0, amountDue - input.existingAmountPaid) };
  }

  // 兩者都沒有變更：維持原狀，不動 amountDue/amountUnpaid。
  return { ok: true, amountDue: input.existingAmountDue, amountUnpaid: Math.max(0, (input.existingAmountDue ?? 0) - input.existingAmountPaid) };
}

export function validatePaymentDoesNotExceedUnpaid(
  amount: number,
  currentAmountUnpaid: number
): { ok: boolean; error: string | null } {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "請輸入正確的收款金額" };
  }
  if (round2(amount) > round2(currentAmountUnpaid)) {
    return { ok: false, error: `收款金額（${round2(amount)}）超過目前未收金額（${round2(currentAmountUnpaid)}），可能資料已被其他人異動，請重新整理後再試` };
  }
  return { ok: true, error: null };
}
