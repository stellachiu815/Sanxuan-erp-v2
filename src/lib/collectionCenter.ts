import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  round2,
  formatTransactionNo,
  buildFinanceSourceKey,
  buildAdjustmentFinanceSourceKey,
  buildReconciliationFinanceSourceKey,
  computeReconciliationDifference,
  validateAdjustmentAmount,
  validateAllocationsMatchTotal,
  type AllocationAmountInput,
} from "@/lib/collectionCenterRules";
import {
  getReceivableAdapter,
  listWiredSourceTypes,
  type UniversalReceivableView,
  type PendingReceivableFilters,
} from "@/lib/receivableAdapters";
import { getAllocationReceiptImpact } from "@/lib/receipt";
import { mapWithConcurrency } from "@/lib/concurrency";

/**
 * P2024 修正：收款中心「待收款」一次要問所有已串接來源的 adapter，每個
 * adapter 內部又各自查 2～4 次（來源表 + 付款分錄 + 收據）。過去用
 * Promise.all 全部一起跑，冷啟動時瞬間十幾～二十條連線超過池上限。
 * 這裡把 adapter 的並行數壓在 2，做完一個補一個，結果完全不變。
 */
const RECEIVABLE_ADAPTER_CONCURRENCY = 2;

/**
 * V11.0.1「全宮共用收款中心」核心邏輯——整合驗收修正輪重寫版。
 *
 * 跟 V11.0 版本最大的差異（對應 V11.0.1 需求四、九、十一）：
 *
 * 1. 不再對每一個來源各自寫 if/else 查詢/寫入邏輯，一律透過
 *    `getReceivableAdapter(sourceType)` 從 `receivableAdapters.ts` 的
 *    registry 取用同一份 `ReceivableSourceAdapter` 介面。這裡完全不知道
 *    OfferingClaim/ManualReceivable/UniversalSalvationDetail/
 *    PurificationEntry 各自的資料表長什麼樣子，只知道每個來源都提供
 *    `listPending`／`applyPayment`／`applyReversal` 三個方法。
 * 2. 收款序號改用 `PaymentSequenceCounter` 資料表 + `INSERT ... ON
 *    CONFLICT (year) DO UPDATE ... RETURNING` 一次到位取號，取代 V11.0
 *    「查詢當年度筆數＋1」的作法（兩人同時收款可能算出同一個序號）。這條
 *    SQL 語句本身由 PostgreSQL 保證原子性，不需要額外加鎖。
 * 3. 代收對帳改用 `SELECT ... FOR UPDATE` 先鎖定「這個代收人目前所有待
 *    對帳的交易」再建立對帳紀錄，取代 V11.0「先在交易外查詢、再在交易內
 *    更新」的作法（中間有一段時間窗，兩個對帳批次可能同時認領到同一筆
 *    代收款）。鎖定的資料列在這個資料庫交易 commit 之前，其他交易的
 *    `FOR UPDATE` 查詢會被擋住等待，等到可以繼續查詢時，`WHERE` 條件會
 *    重新核對，已經被對帳掉的交易就不會再出現在第二個對帳批次裡。
 *
 * 真正的收款分錄（OfferingPayment／UniversalSalvationPayment／
 * PurificationPayment）、防止重複收款的「原子條件式 UPDATE」都在各自的
 * adapter 裡實作，這裡只負責：組裝合併收款的多筆分配、產生收款序號、
 * 串接退款/轉款/作廢、彙總報表查詢。
 */

// ============================================================
// 一、共用應收項目檢視——實際實作全部移到 receivableAdapters.ts，
//    這裡只是統一的入口，讓 API／頁面不需要知道有哪些來源、也不需要在
//    畫面裡寫死不同資料表的查詢方式（需求「四、補強既有模組的共用應收
//    介面」）。
// ============================================================

export type { UniversalReceivableView, PendingReceivableFilters };

/** 需求「待收款項」「快速收款」共用：目前所有已串接來源的未收/部分收款清單。 */
export async function listPendingReceivables(filters: PendingReceivableFilters): Promise<UniversalReceivableView[]> {
  const sourceTypes = listWiredSourceTypes();
  // 受控並行：一次最多 RECEIVABLE_ADAPTER_CONCURRENCY 個 adapter 查詢，
  // 取代原本一次全部 Promise.all（P2024 修正，指令四）。
  const lists = await mapWithConcurrency(
    sourceTypes,
    RECEIVABLE_ADAPTER_CONCURRENCY,
    (sourceType) => getReceivableAdapter(sourceType)!.listPending(filters)
  );
  const views = lists.flat();
  return views.sort((a, b) => a.sourceYear - b.sourceYear || a.createdAt.getTime() - b.createdAt.getTime());
}

// ============================================================
// 二、其他臨時應收項目（ManualReceivable）
// ============================================================

export type CreateManualReceivableInput = {
  title: string;
  year: number;
  payerMemberId?: string | null;
  payerHouseholdId?: string | null;
  payerNameSnapshot: string;
  payerPhoneSnapshot?: string | null;
  amountDue: number;
  note?: string | null;
  createdByName?: string | null;
};

export async function createManualReceivable(input: CreateManualReceivableInput) {
  if (!Number.isFinite(input.amountDue) || input.amountDue < 0) {
    return { ok: false as const, status: 400, error: "請輸入正確的應收金額" };
  }
  const created = await prisma.manualReceivable.create({
    data: {
      title: input.title.trim(),
      year: input.year,
      payerMemberId: input.payerMemberId ?? null,
      payerHouseholdId: input.payerHouseholdId ?? null,
      payerNameSnapshot: input.payerNameSnapshot.trim(),
      payerPhoneSnapshot: input.payerPhoneSnapshot?.trim() || null,
      amountDue: round2(input.amountDue),
      amountUnpaid: round2(input.amountDue),
      note: input.note?.trim() || null,
      createdByName: input.createdByName?.trim() || null,
    },
  });
  return { ok: true as const, data: created };
}

// ============================================================
// 三、合併收款（一筆 PaymentTransaction ＋ 多筆 PaymentAllocation）
// ============================================================

export type CreatePaymentAllocationInput = AllocationAmountInput & {
  sourceType: string;
  sourceId: string;
  note?: string | null;
};

export type CreatePaymentTransactionInput = {
  paidOn: Date;
  totalAmount: number;
  methodType: "CASH" | "BANK_TRANSFER" | "MOBILE_PAYMENT" | "CHECK" | "OTHER";
  methodNote?: string | null;
  bankName?: string | null;
  bankAccountLast5?: string | null;
  checkNumber?: string | null;
  payerMemberId?: string | null;
  payerHouseholdId?: string | null;
  payerNameSnapshot: string;
  payerPhoneSnapshot?: string | null;
  collectedByName?: string | null;
  isAgentCollected?: boolean;
  agentName?: string | null;
  note?: string | null;
  createdByName?: string | null;
  allocations: CreatePaymentAllocationInput[];
  /**
   * 需求「九、重複送出防護」：畫面在使用者按下確認收款的當下產生一組隨機
   * 識別碼（例如 crypto.randomUUID()），同一次送出（包含連點兩下、或網路
   * 自動重送）都帶同一組值。伺服器端會先查詢是否已經有這組識別碼的收款
   * 交易，有的話直接回傳既有結果；資料庫的 unique 限制是最終防線，見下方
   * `createMergedPaymentTransaction()` 的說明。
   */
  idempotencyKey?: string | null;
};

/**
 * receiptImpact 是選填欄位（V11.1「全宮共用收據中心」新增）：只有
 * createAllocationAdjustment()／voidPaymentTransaction() 在偵測到這筆分配
 * 已經開立過有效收據、且呼叫端還沒有明確確認（acknowledgeReceiptImpact）
 * 時才會帶這個欄位，其餘既有呼叫端完全不受影響（這個欄位為 undefined 時
 * 跟 V11.0.2 之前的回傳形狀完全相同）。
 */
export type CollectionResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; receiptImpact?: { activeReceiptNumbers: string[]; totalReceiptedAmount: number } };

/** 需求「合併收款」：一次真實收款事件，內含多筆分配，一律只建立一筆 PaymentTransaction。 */
export async function createMergedPaymentTransaction(
  input: CreatePaymentTransactionInput,
  operatorName?: string | null
): Promise<CollectionResult<{ id: string; transactionNo: string }>> {
  const validation = validateAllocationsMatchTotal(input.allocations, input.totalAmount);
  if (!validation.ok) return { ok: false, status: 400, error: validation.error! };

  for (const a of input.allocations) {
    const adapter = getReceivableAdapter(a.sourceType);
    if (!adapter || !adapter.isWired) {
      return { ok: false, status: 400, error: `「${a.sourceType}」這個來源本輪尚未真正串接，無法建立收款` };
    }
  }

  const idempotencyKey = input.idempotencyKey?.trim() || null;

  // 需求「九、重複送出防護」：預先查詢是否已經有這組識別碼的收款交易。
  // 這是常見情況的快速路徑（使用者連點兩下，第二次請求晚一點點送達）；
  // 真正的安全網是下面 unique constraint 擋下同時送達的請求，見 catch 區塊。
  if (idempotencyKey) {
    const existing = await prisma.paymentTransaction.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return { ok: true, data: { id: existing.id, transactionNo: existing.transactionNo } };
    }
  }

  const year = input.paidOn.getFullYear() - 1911;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 需求「十一、修正收款編號併發問題」：用 PaymentSequenceCounter 這張
      // 「每年度一列」的資料表，透過 `INSERT ... ON CONFLICT ... DO UPDATE
      // ... RETURNING` 一次到位完成「若不存在就從1開始，若存在就原子遞增
      // 並取回新值」。PostgreSQL 保證這一整條語句是原子操作，兩個人同時
      // 收款也只會有一個人拿到某個序號，不需要事後靠 unique constraint
      // 擋錯、要求使用者重新送出。
      const seqRows = await tx.$queryRaw<{ currentValue: number }[]>`
        INSERT INTO "payment_sequence_counters" ("year", "currentValue")
        VALUES (${year}, 1)
        ON CONFLICT ("year") DO UPDATE SET "currentValue" = "payment_sequence_counters"."currentValue" + 1
        RETURNING "currentValue"
      `;
      const transactionNo = formatTransactionNo(year, seqRows[0].currentValue);

      const transaction = await tx.paymentTransaction.create({
        data: {
          transactionNo,
          idempotencyKey,
          paidOn: input.paidOn,
          totalAmount: round2(input.totalAmount),
          methodType: input.methodType,
          methodNote: input.methodNote?.trim() || null,
          bankName: input.bankName?.trim() || null,
          bankAccountLast5: input.bankAccountLast5?.trim() || null,
          checkNumber: input.checkNumber?.trim() || null,
          payerMemberId: input.payerMemberId ?? null,
          payerHouseholdId: input.payerHouseholdId ?? null,
          payerNameSnapshot: input.payerNameSnapshot.trim(),
          payerPhoneSnapshot: input.payerPhoneSnapshot?.trim() || null,
          collectedByName: input.collectedByName?.trim() || null,
          isAgentCollected: input.isAgentCollected ?? false,
          agentName: input.isAgentCollected ? input.agentName?.trim() || null : null,
          agentRemittanceStatus: input.isAgentCollected ? "PENDING" : null,
          note: input.note?.trim() || null,
          createdByName: input.createdByName?.trim() || null,
        },
      });

      // 需求「九、防止重複收款」：每一筆分配都透過對應 adapter 的
      // applyPayment() 執行——實際的「重新檢查最新未收金額／本次金額是否
      // 超過未收金額／是否為可收款來源」都在 adapter 內用「原子條件式
      // UPDATE」完成，任何一筆分配失敗，這裡的 throw 會讓外層
      // prisma.$transaction 整筆回復，不會留下部分寫入的髒資料。
      for (const allocation of input.allocations) {
        const adapter = getReceivableAdapter(allocation.sourceType)!;
        const applyResult = await adapter.applyPayment(tx, allocation.sourceId, allocation.amount, {
          paidOn: input.paidOn,
          method: input.methodType,
          collectedByName: input.collectedByName?.trim() || null,
          transactionNo,
          operatorName,
        });

        await tx.paymentAllocation.create({
          data: {
            paymentTransactionId: transaction.id,
            sourceType: allocation.sourceType as never,
            sourceId: allocation.sourceId,
            // 這兩個既有欄位只有 OFFERING_CLAIM／MANUAL 用得到，其餘來源
            // （普渡贊普、祭改）目前用 sourceType/sourceId 這組多型參照
            // 追蹤，不需要另外增加專屬外鍵欄位。
            sourceOfferingPaymentId: allocation.sourceType === "OFFERING_CLAIM" ? applyResult.ledgerId : null,
            manualReceivableId: allocation.sourceType === "MANUAL" ? allocation.sourceId : null,
            sourceLabel: applyResult.label,
            sourceYear: applyResult.year,
            amount: allocation.amount,
            financeSourceKey: buildFinanceSourceKey(allocation.sourceType, allocation.sourceId, transaction.id),
            note: allocation.note?.trim() || null,
          },
        });
      }

      return transaction;
    });

    return { ok: true, data: { id: result.id, transactionNo: result.transactionNo } };
  } catch (err) {
    // 需求「九、重複送出防護」的最終安全網：就算兩個請求幾乎同時通過上面
    // 的預先查詢（都查不到既有交易），資料庫的 idempotencyKey unique
    // 限制仍然會讓第二個請求的 INSERT 失敗（Prisma 錯誤代碼 P2002）。這裡
    // 攔截這個特定錯誤，改成查詢並回傳「先送到」的那一筆結果，讓重複送出
    // 表現為「回傳同一筆收款結果」，而不是回傳錯誤訊息或建立第二筆
    // PaymentTransaction。
    const isDuplicateIdempotencyKey =
      err instanceof Prisma.PrismaClientKnownRequestError && (err as { code: string }).code === "P2002";
    if (idempotencyKey && isDuplicateIdempotencyKey) {
      const existing = await prisma.paymentTransaction.findUnique({ where: { idempotencyKey } });
      if (existing) {
        return { ok: true, data: { id: existing.id, transactionNo: existing.transactionNo } };
      }
    }
    const message = err instanceof Error ? err.message : "建立收款時發生錯誤";
    return { ok: false, status: 400, error: message };
  }
}

// ============================================================
// 四、收款紀錄查詢
// ============================================================

export type PaymentTransactionListFilters = {
  isAgentCollected?: boolean;
  agentName?: string;
  agentRemittanceStatus?: string;
  status?: string;
  paidFrom?: Date;
  paidTo?: Date;
};

export async function listPaymentTransactions(filters: PaymentTransactionListFilters = {}) {
  const where: Prisma.PaymentTransactionWhereInput = {};
  if (filters.isAgentCollected !== undefined) where.isAgentCollected = filters.isAgentCollected;
  if (filters.agentName) where.agentName = filters.agentName;
  if (filters.agentRemittanceStatus) where.agentRemittanceStatus = filters.agentRemittanceStatus as never;
  if (filters.status) where.status = filters.status as never;
  if (filters.paidFrom || filters.paidTo) {
    where.paidOn = {};
    if (filters.paidFrom) where.paidOn.gte = filters.paidFrom;
    if (filters.paidTo) where.paidOn.lte = filters.paidTo;
  }
  return prisma.paymentTransaction.findMany({
    where,
    include: { allocations: true, adjustments: true },
    orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
  });
}

export async function getPaymentTransaction(id: string) {
  return prisma.paymentTransaction.findUnique({
    where: { id },
    include: { allocations: { include: { adjustments: true } }, adjustments: true },
  });
}

// ============================================================
// 五、退款／轉款／保留溢收（分配層級）與整筆作廢（交易層級）
// ============================================================

export type CreateAllocationAdjustmentInput = {
  allocationId: string;
  adjustmentType: "REFUND" | "TRANSFER_TO_OTHER" | "RETAIN_AS_OVERPAYMENT";
  amount: number;
  reason: string;
  operatorName?: string | null;
  approvedByName?: string | null;
  targetSourceType?: string;
  targetSourceId?: string;
  /** V11.1 新增：需求「十四、退款與收據關係」——若這筆分配已經開立過有效
   *  收據，第一次呼叫（acknowledgeReceiptImpact 未傳或為 false）會被擋下，
   *  回傳 receiptImpact 讓畫面顯示提示「此筆付款已開立收據，退款後需確認
   *  是否作廢或換開收據」；使用者確認後帶 true 重新送出才會真的執行。 */
  acknowledgeReceiptImpact?: boolean;
};

/**
 * 需求「退款/轉款」四選項中的前三種（保留為分配層級的調整，因為一筆合併
 * 收款底下可能只需要針對其中一項退款，不代表整筆收款都要作廢）。第四種
 * 「作廢未完成」見下方 voidPaymentTransaction()（整筆交易層級）。
 */
export async function createAllocationAdjustment(
  input: CreateAllocationAdjustmentInput
): Promise<CollectionResult<{ id: string }>> {
  if (!input.reason?.trim()) return { ok: false, status: 400, error: "請填寫原因" };
  if (input.adjustmentType !== "RETAIN_AS_OVERPAYMENT" && !input.approvedByName?.trim()) {
    return { ok: false, status: 400, error: "退款／轉款需要填寫核准人" };
  }

  const allocation = await prisma.paymentAllocation.findUnique({ where: { id: input.allocationId } });
  if (!allocation) return { ok: false, status: 404, error: "找不到這筆分配紀錄" };

  const amountCheck = validateAdjustmentAmount(Number(allocation.amount), input.amount);
  if (!amountCheck.ok) return { ok: false, status: 400, error: amountCheck.error! };

  // 需求「十四」：退款／轉款會實際沖銷這筆分配的金額，若已經開立過有效
  // 收據，必須先提示、等使用者明確確認才能繼續（RETAIN_AS_OVERPAYMENT
  // 不沖銷來源金額，不需要這個提示）。
  if (input.adjustmentType !== "RETAIN_AS_OVERPAYMENT" && !input.acknowledgeReceiptImpact) {
    const impact = await getAllocationReceiptImpact(input.allocationId);
    if (impact.hasActiveReceipts) {
      return {
        ok: false,
        status: 409,
        error: `此筆付款已開立收據（${impact.activeReceiptNumbers.join("、")}），退款後需確認是否作廢或換開收據。請確認後再次送出。`,
        receiptImpact: { activeReceiptNumbers: impact.activeReceiptNumbers, totalReceiptedAmount: impact.totalReceiptedAmount },
      };
    }
  }

  if (input.adjustmentType === "TRANSFER_TO_OTHER") {
    if (!input.targetSourceType || !input.targetSourceId) {
      return { ok: false, status: 400, error: "轉款必須指定目標應收項目" };
    }
    const targetAdapter = getReceivableAdapter(input.targetSourceType);
    if (!targetAdapter || !targetAdapter.isWired) {
      return { ok: false, status: 400, error: `目標來源「${input.targetSourceType}」尚未真正串接，無法轉款` };
    }
  }

  try {
    const adjustment = await prisma.$transaction(async (tx) => {
      // RETAIN_AS_OVERPAYMENT：只記錄意圖，錢已經確實收到，來源本身不變動、
      // 不產生任何收款分錄的沖銷，等未來實際用於抵用其他項目時再另外處理。
      if (input.adjustmentType === "RETAIN_AS_OVERPAYMENT") {
        const created = await tx.paymentAdjustment.create({
          data: {
            paymentTransactionId: allocation.paymentTransactionId,
            sourceAllocationId: allocation.id,
            adjustmentType: "RETAIN_AS_OVERPAYMENT",
            amount: input.amount,
            reason: input.reason.trim(),
            operatorName: input.operatorName?.trim() || null,
          },
        });
        return tx.paymentAdjustment.update({
          where: { id: created.id },
          data: { financeSourceKey: buildAdjustmentFinanceSourceKey(allocation.id, created.id) },
        });
      }

      const sourceAdapter = getReceivableAdapter(allocation.sourceType);
      if (!sourceAdapter) throw new Error(`來源「${allocation.sourceType}」目前無法辨識，無法退款/轉款`);

      // REFUND／TRANSFER_TO_OTHER：都需要先在來源沖銷這筆金額。
      await sourceAdapter.applyReversal(tx, allocation.sourceId, input.amount, {
        reason: input.reason.trim(),
        operatorName: input.operatorName,
        kind: input.adjustmentType === "TRANSFER_TO_OTHER" ? "TRANSFER_OUT" : "REFUND",
      });

      let targetLedgerId: string | null = null;
      if (input.adjustmentType === "TRANSFER_TO_OTHER") {
        const targetAdapter = getReceivableAdapter(input.targetSourceType!)!;
        const transferResult = await targetAdapter.applyPayment(tx, input.targetSourceId!, input.amount, {
          paidOn: new Date(),
          method: "TRANSFER",
          collectedByName: input.operatorName ?? null,
          transactionNo: `ADJ-${allocation.paymentTransactionId}`,
          operatorName: input.operatorName,
          kind: "TRANSFER_IN",
        });
        targetLedgerId = transferResult.ledgerId;
      }

      const created = await tx.paymentAdjustment.create({
        data: {
          paymentTransactionId: allocation.paymentTransactionId,
          sourceAllocationId: allocation.id,
          adjustmentType: input.adjustmentType,
          amount: input.amount,
          reason: input.reason.trim(),
          targetSourceType: input.adjustmentType === "TRANSFER_TO_OTHER" ? (input.targetSourceType as never) : null,
          targetSourceId: input.adjustmentType === "TRANSFER_TO_OTHER" ? input.targetSourceId : null,
          targetOfferingPaymentId:
            input.adjustmentType === "TRANSFER_TO_OTHER" && input.targetSourceType === "OFFERING_CLAIM"
              ? targetLedgerId
              : null,
          operatorName: input.operatorName?.trim() || null,
          approvedByName: input.approvedByName?.trim() || null,
        },
      });
      return tx.paymentAdjustment.update({
        where: { id: created.id },
        data: { financeSourceKey: buildAdjustmentFinanceSourceKey(allocation.id, created.id) },
      });
    });

    return { ok: true, data: { id: adjustment.id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "建立退款/轉款時發生錯誤";
    return { ok: false, status: 400, error: message };
  }
}

/** 需求「退款/轉款」第四選項：整筆收款登錄錯誤時作廢，沖銷底下所有分配的金額。
 *  V11.1 新增第五個參數 acknowledgeReceiptImpact：規則同上方 createAllocationAdjustment()，
 *  只要底下任何一筆分配已經開立過有效收據，第一次呼叫會被擋下並回傳
 *  receiptImpact 提示，使用者確認後帶 true 才會真的執行作廢。 */
export async function voidPaymentTransaction(
  id: string,
  reason: string,
  operatorName?: string | null,
  approvedByName?: string | null,
  acknowledgeReceiptImpact = false
): Promise<CollectionResult<{ id: string }>> {
  if (!reason?.trim()) return { ok: false, status: 400, error: "作廢請填寫原因" };
  if (!approvedByName?.trim()) return { ok: false, status: 400, error: "作廢需要填寫核准人" };

  const transaction = await prisma.paymentTransaction.findUnique({ where: { id }, include: { allocations: true } });
  if (!transaction) return { ok: false, status: 404, error: "找不到這筆收款交易" };
  if (transaction.status === "VOIDED") return { ok: false, status: 400, error: "這筆收款已經作廢過了" };

  if (!acknowledgeReceiptImpact) {
    const impacts = await Promise.all(transaction.allocations.map((a) => getAllocationReceiptImpact(a.id)));
    const activeReceiptNumbers: string[] = Array.from(
      new Set(impacts.flatMap((i): string[] => i.activeReceiptNumbers))
    );
    if (activeReceiptNumbers.length > 0) {
      return {
        ok: false,
        status: 409,
        error: `此筆收款已開立收據（${activeReceiptNumbers.join("、")}），作廢後需確認是否作廢或換開收據。請確認後再次送出。`,
        receiptImpact: {
          activeReceiptNumbers,
          totalReceiptedAmount: round2(impacts.reduce((s, i) => s + i.totalReceiptedAmount, 0)),
        },
      };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const allocation of transaction.allocations) {
        const adapter = getReceivableAdapter(allocation.sourceType);
        if (!adapter) throw new Error(`來源「${allocation.sourceType}」目前無法辨識，無法作廢`);

        await adapter.applyReversal(tx, allocation.sourceId, Number(allocation.amount), {
          reason: reason.trim(),
          operatorName,
          kind: "REFUND",
        });

        const createdAdjustment = await tx.paymentAdjustment.create({
          data: {
            paymentTransactionId: transaction.id,
            sourceAllocationId: allocation.id,
            adjustmentType: "VOID_INCOMPLETE",
            amount: Number(allocation.amount),
            reason: reason.trim(),
            operatorName: operatorName?.trim() || null,
            approvedByName: approvedByName?.trim() || null,
          },
        });
        await tx.paymentAdjustment.update({
          where: { id: createdAdjustment.id },
          data: { financeSourceKey: buildAdjustmentFinanceSourceKey(allocation.id, createdAdjustment.id) },
        });
      }
      await tx.paymentTransaction.update({
        where: { id },
        data: {
          status: "VOIDED",
          voidedAt: new Date(),
          voidedByName: operatorName?.trim() || null,
          voidReason: reason.trim(),
        },
      });
    });
    return { ok: true, data: { id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "作廢時發生錯誤";
    return { ok: false, status: 400, error: message };
  }
}

// ============================================================
// 六、代收管理與代收對帳
// ============================================================

export async function listAgentPendingTransactions(agentName: string) {
  return prisma.paymentTransaction.findMany({
    where: {
      isAgentCollected: true,
      agentName,
      status: "COMPLETED",
      agentRemittanceStatus: { in: ["PENDING", "PARTIALLY_REMITTED"] },
    },
    include: { allocations: true },
    orderBy: [{ paidOn: "asc" }],
  });
}

/**
 * 「目前所有代收人、所有尚未繳回的收款交易」共用查詢——抽出這個小函式只是
 * 為了讓 getAgentPendingSummary()（依代收人分組）跟 getCollectionHomeSummary()
 * （首頁 Dashboard 需要的「最長未繳回天數」，V11.2 新增）用同一份查詢條件，
 * 不要各自重複寫一次一模一樣的 where 條件（避免兩處日後改了忘記同步）。
 */
async function fetchAgentPendingTransactions() {
  return prisma.paymentTransaction.findMany({
    where: { isAgentCollected: true, status: "COMPLETED", agentRemittanceStatus: { in: ["PENDING", "PARTIALLY_REMITTED"] } },
  });
}

/** 首頁「代收提醒卡」：依代收人分組的待繳回總額。 */
export async function getAgentPendingSummary() {
  const pending = await fetchAgentPendingTransactions();
  const byAgent = new Map<string, { agentName: string; count: number; totalAmount: number }>();
  for (const t of pending) {
    const key = t.agentName ?? "（未填寫代收人）";
    const entry = byAgent.get(key) ?? { agentName: key, count: 0, totalAmount: 0 };
    entry.count += 1;
    entry.totalAmount = round2(entry.totalAmount + Number(t.totalAmount));
    byAgent.set(key, entry);
  }
  return Array.from(byAgent.values()).sort((a, b) => b.totalAmount - a.totalAmount);
}

export type CreateAgentReconciliationInput = {
  agentName: string;
  periodLabel: string;
  actualAmount: number;
  differenceReason?: string | null;
  reconciledByName?: string | null;
  note?: string | null;
};

/**
 * 需求「十、代收款邏輯再次驗證」＋「同一筆代收款不得加入兩個尚未完成的
 * 對帳批次」：用 `SELECT ... FOR UPDATE` 在同一個資料庫交易裡先鎖定這個
 * 代收人目前所有待對帳的交易列，才計算應繳回金額、建立對帳紀錄。這些列
 * 在這個交易 commit 之前會保持鎖定狀態——如果另一個人同時對同一個代收人
 * 送出第二個對帳批次，那個查詢會被擋住等待，等到可以繼續查詢時，
 * `agentRemittanceStatus IN ('PENDING','PARTIALLY_REMITTED')` 這個條件會
 * 重新核對，這批已經被第一個對帳批次改成 RECONCILED 的交易就不會再出現，
 * 不會有兩個對帳批次同時認領到同一筆代收款的情況，也不需要在資料庫新增
 * 一個額外的「對帳中」狀態。
 */
export async function createAgentReconciliation(
  input: CreateAgentReconciliationInput
): Promise<CollectionResult<{ id: string }>> {
  try {
    const record = await prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string; totalAmount: Prisma.Decimal }[]>`
        SELECT "id", "totalAmount" FROM "payment_transactions"
        WHERE "isAgentCollected" = true
          AND "agentName" = ${input.agentName}
          AND "status" = 'COMPLETED'
          AND "agentRemittanceStatus" IN ('PENDING', 'PARTIALLY_REMITTED')
        FOR UPDATE
      `;

      if (claimed.length === 0) {
        throw new Error(`代收人「${input.agentName}」目前沒有待對帳的收款交易`);
      }

      const expectedAmount = round2(claimed.reduce((s, t) => s + Number(t.totalAmount), 0));
      const { differenceAmount, requiresReason } = computeReconciliationDifference(expectedAmount, input.actualAmount);

      if (requiresReason && !input.differenceReason?.trim()) {
        throw new Error("實際繳回金額與應繳回金額不同，必須填寫差異原因");
      }

      const created = await tx.agentReconciliationRecord.create({
        data: {
          agentName: input.agentName,
          periodLabel: input.periodLabel,
          expectedAmount,
          actualAmount: round2(input.actualAmount),
          differenceAmount,
          differenceReason: input.differenceReason?.trim() || null,
          reconciledByName: input.reconciledByName?.trim() || null,
          note: input.note?.trim() || null,
        },
      });

      // 需求「八、再次驗證財務防重複識別」：代收繳回是「資金移轉」事件，
      // 不是收入事件，這裡給它自己獨立的識別碼命名空間（見
      // buildReconciliationFinanceSourceKey 的說明），不會跟
      // PaymentAllocation／PaymentAdjustment 的收入/退款識別碼混用。
      const withKey = await tx.agentReconciliationRecord.update({
        where: { id: created.id },
        data: { financeSourceKey: buildReconciliationFinanceSourceKey(input.agentName, created.id) },
      });

      // 這些交易列從上面的 SELECT ... FOR UPDATE 開始就已經鎖定，這裡的
      // updateMany 只是把鎖定期間算好的結果正式寫入，不會有競態窗口。
      await tx.paymentTransaction.updateMany({
        where: { id: { in: claimed.map((t) => t.id) } },
        data: { agentRemittanceStatus: "RECONCILED", agentReconciliationRecordId: created.id },
      });

      return withKey;
    });

    return { ok: true, data: { id: record.id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "建立代收對帳時發生錯誤";
    return { ok: false, status: 400, error: message };
  }
}

// ============================================================
// 七、首頁提醒卡彙總
// ============================================================

export type CollectionHomeSummary = {
  pendingReceivableCount: number;
  pendingReceivableAmount: number;
  crossYearUnpaidCount: number;
  agentPendingCount: number;
  agentPendingAmount: number;
  /**
   * V11.2 首頁 Dashboard 新增（需求「五、代收待繳回」：最長未繳回天數）。
   * 用目前所有「代收且尚未繳回」交易中，距離收款當天（paidOn）最久的一筆，
   * 跟 now 相差的天數；完全沒有待繳回交易時為 0（畫面顯示「—」，不是 0天）。
   */
  agentPendingLongestDays: number;
};

export async function getCollectionHomeSummary(currentYear: number, now: Date = new Date()): Promise<CollectionHomeSummary> {
  const [pending, agentPendingTransactions] = await Promise.all([
    listPendingReceivables({ currentYear }),
    fetchAgentPendingTransactions(),
  ]);
  const agentPendingLongestDays = agentPendingTransactions.reduce((max, t) => {
    const days = Math.floor((now.getTime() - t.paidOn.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(max, days);
  }, 0);
  return {
    pendingReceivableCount: pending.length,
    pendingReceivableAmount: round2(pending.reduce((s, p) => s + p.unpaidAmount, 0)),
    crossYearUnpaidCount: pending.filter((p) => p.isCrossYear).length,
    agentPendingCount: agentPendingTransactions.length,
    agentPendingAmount: round2(agentPendingTransactions.reduce((s, t) => s + Number(t.totalAmount), 0)),
    agentPendingLongestDays,
  };
}

export type TodayCollectionSummary = { count: number; totalAmount: number };

/** 首頁 Dashboard（需求「三、今日收款」）：今天（伺服器本地日期）已完成的收款交易筆數與金額加總。 */
export async function getTodayCollectionSummary(now: Date = new Date()): Promise<TodayCollectionSummary> {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const transactions = await prisma.paymentTransaction.findMany({
    where: { status: "COMPLETED", paidOn: { gte: startOfToday, lt: startOfTomorrow } },
  });

  return {
    count: transactions.length,
    totalAmount: round2(transactions.reduce((s, t) => s + Number(t.totalAmount), 0)),
  };
}

// ============================================================
// 八、月結收款報表
// ============================================================
//
// 需求「十四、月結報表修正」：分開顯示宮內直接收款／代收尚未繳回／代收
// 已繳回，「代收繳回」不得再計為第二次收入——代收對帳（createAgentReconciliation）
// 只更新 agentRemittanceStatus，從來不會建立第二筆 PaymentTransaction 或
// PaymentAllocation，所以這裡的 totalAmount／bySourceType 加總本來就只計一次，
// 不需要另外排除「代收繳回」；報表只需要額外把 isAgentCollected 的交易依
// agentRemittanceStatus 分成「尚未繳回」與「已繳回（RECONCILED）」兩組分開
// 顯示即可。

export async function getMonthlyCollectionReport(year: number, month: number) {
  const solarYear = year + 1911;
  const from = new Date(Date.UTC(solarYear, month - 1, 1));
  const to = new Date(Date.UTC(solarYear, month, 1));

  const transactions = await prisma.paymentTransaction.findMany({
    where: { paidOn: { gte: from, lt: to } },
    include: { allocations: true, adjustments: true },
    orderBy: [{ paidOn: "asc" }],
  });

  const completed = transactions.filter((t) => t.status === "COMPLETED");
  const voided = transactions.filter((t) => t.status === "VOIDED");

  const bySourceType = new Map<string, { sourceType: string; count: number; amount: number }>();
  const byMethodType = new Map<string, { methodType: string; count: number; amount: number }>();
  let crossYearAmount = 0;
  let refundAmount = 0;
  let transferAmount = 0;

  for (const t of completed) {
    const methodEntry = byMethodType.get(t.methodType) ?? { methodType: t.methodType, count: 0, amount: 0 };
    methodEntry.count += 1;
    methodEntry.amount = round2(methodEntry.amount + Number(t.totalAmount));
    byMethodType.set(t.methodType, methodEntry);

    for (const a of t.allocations) {
      const sourceEntry = bySourceType.get(a.sourceType) ?? { sourceType: a.sourceType, count: 0, amount: 0 };
      sourceEntry.count += 1;
      sourceEntry.amount = round2(sourceEntry.amount + Number(a.amount));
      bySourceType.set(a.sourceType, sourceEntry);

      if (a.sourceYear !== null && a.sourceYear !== year) crossYearAmount = round2(crossYearAmount + Number(a.amount));
    }
    for (const adj of t.adjustments) {
      if (adj.adjustmentType === "REFUND") refundAmount = round2(refundAmount + Number(adj.amount));
      if (adj.adjustmentType === "TRANSFER_TO_OTHER") transferAmount = round2(transferAmount + Number(adj.amount));
    }
  }

  const agentCollectedTransactions = completed.filter((t) => t.isAgentCollected);
  const agentCollectedTotal = round2(agentCollectedTransactions.reduce((s, t) => s + Number(t.totalAmount), 0));
  // 「已代收未繳回」：agentRemittanceStatus 還停在 PENDING/PARTIALLY_REMITTED。
  const agentUncollectedRemittedTotal = round2(
    agentCollectedTransactions
      .filter((t) => t.agentRemittanceStatus === "PENDING" || t.agentRemittanceStatus === "PARTIALLY_REMITTED")
      .reduce((s, t) => s + Number(t.totalAmount), 0)
  );
  // 「代收已繳回」：agentRemittanceStatus 已經是 RECONCILED（對帳完成）。
  // 這筆金額本來就已經包含在上面 completed 的 totalAmount 加總裡（收款當下
  // 就算一次收入），這裡只是分開標示「歸類為代收、且已完成對帳」，不會
  // 因為對帳而重複計入 totalAmount。
  const agentRemittedTotal = round2(
    agentCollectedTransactions
      .filter((t) => t.agentRemittanceStatus === "RECONCILED")
      .reduce((s, t) => s + Number(t.totalAmount), 0)
  );
  const directCollectedTotal = round2(
    completed.filter((t) => !t.isAgentCollected).reduce((s, t) => s + Number(t.totalAmount), 0)
  );

  // 需求「七、修正月結報表空值」：現金/銀行轉帳/支票這三種最常被單獨引用
  // 的收款方式，額外攤平成獨立欄位，本月完全沒有該收款方式時一律回傳 0，
  // 不回傳 undefined——`byMethodType` 這個 Map 只會收錄「本月真的有出現」
  // 的收款方式，用 `?? 0` 讓沒出現的方式明確補 0，而不是讓畫面/CSV 拿到
  // undefined 之後顯示空白或 NaN。
  const cashAmount = byMethodType.get("CASH")?.amount ?? 0;
  const bankTransferAmount = byMethodType.get("BANK_TRANSFER")?.amount ?? 0;
  const chequeAmount = byMethodType.get("CHECK")?.amount ?? 0;

  return {
    year,
    month,
    transactionCount: completed.length,
    totalAmount: round2(completed.reduce((s, t) => s + Number(t.totalAmount), 0)),
    directCollectedTotal,
    bySourceType: Array.from(bySourceType.values()),
    byMethodType: Array.from(byMethodType.values()),
    cashAmount,
    bankTransferAmount,
    chequeAmount,
    agentCollectedTotal,
    agentUncollectedRemittedTotal,
    agentRemittedTotal,
    voidedCount: voided.length,
    voidedAmount: round2(voided.reduce((s, t) => s + Number(t.totalAmount), 0)),
    refundAmount,
    transferAmount,
    crossYearReceivedAmount: crossYearAmount,
    transactions: completed,
  };
}
