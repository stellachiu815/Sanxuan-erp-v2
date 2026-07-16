import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";
import { resolveOperator, resolveApprover } from "@/lib/operator";
import { canReceipt } from "@/lib/permissions";
import {
  round2,
  resolveReceiptDisplayYear,
  resolveReceiptCounterKey,
  formatReceiptNumber,
  computeReceiptableRemaining,
  validateReceiptLineAmounts,
  validateNumberingConfigInput,
  determinePrintKind,
  type ReceiptLineCandidateInput,
  type ReceiptNumberYearModeValue,
  type ReceiptNumberResetPolicyValue,
} from "@/lib/receiptRules";

/**
 * V11.1「全宮共用收據中心」核心邏輯。
 *
 * ⚠️ 最重要的架構規則（對應需求「三、收據必須以正式收款為來源」）：這個
 * 檔案裡任何一支函式都不會直接查詢或寫入 OfferingClaim／
 * UniversalSalvationDetail／PurificationEntry／ManualReceivable 等原始
 * 應收資料表——收據只能透過 PaymentTransaction／PaymentAllocation 建立，
 * ReceiptLine.paymentAllocationId 是唯一可以追蹤到原始來源的路徑。要開立
 * 收據，資料一定得先經過「原始宮務資料 → 應收 → 正式收款（收款中心）
 * → 收據」這條既有路徑，不會有任何一條捷徑繞過收款中心。
 */

export type CollectionResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/**
 * 判斷一張收據的狀態是否「實際佔用」它底下 ReceiptLine 對應金額的「已開立
 * 收據金額」額度。
 *
 * ⚠️ 這裡刻意排除 REPLACED（已換開），不是只排除 VOIDED（已作廢）——換開
 * 收據的流程（見 reissueReceipt()）會把舊收據狀態改成 REPLACED，同時建立
 * 一張內容相同金額的新收據；如果這裡只排除 VOIDED，舊的 REPLACED 收據跟
 * 新的 ISSUED 收據會被同時當成「有效」重複累計同一筆金額兩次，讓「已開立
 * 收據金額」被灌水成兩倍、「尚可開立金額」變成負數（沙盒測試時用真實
 * PostgreSQL 資料驗證換開情境時發現這個問題並在此修正，詳見交付報告）。
 * DRAFT 狀態本輪程式碼實際上不會產生（issueReceipt/markNoReceiptRequired
 * 一律直接建立 ISSUED 或 NO_RECEIPT_REQUIRED），這裡一併排除只是防禦性寫法。
 */
function isActiveConsumingReceiptStatus(status: string): boolean {
  return status === "ISSUED" || status === "NO_RECEIPT_REQUIRED";
}

// ============================================================
// 一、收據號碼設定與流水號
// ============================================================

export type ReceiptNumberingConfigView = {
  prefix: string;
  yearMode: ReceiptNumberYearModeValue;
  digits: number;
  resetPolicy: ReceiptNumberResetPolicyValue;
  startNumber: number;
  updatedByName: string | null;
  updatedAt: Date;
};

/** 讀取收據號碼設定（全系統唯一一列，migration 已預先塞入預設值，理論上一定存在；防禦性地在真的查不到時自動補建一列預設值）。 */
export async function getReceiptNumberingConfig(): Promise<ReceiptNumberingConfigView> {
  const row = await prisma.receiptNumberingConfig.upsert({
    where: { id: "SINGLETON" },
    update: {},
    create: { id: "SINGLETON" },
  });
  return {
    prefix: row.prefix,
    yearMode: row.yearMode as ReceiptNumberYearModeValue,
    digits: row.digits,
    resetPolicy: row.resetPolicy as ReceiptNumberResetPolicyValue,
    startNumber: row.startNumber,
    updatedByName: row.updatedByName,
    updatedAt: row.updatedAt,
  };
}

export type UpdateNumberingConfigInput = {
  prefix: string;
  yearMode: ReceiptNumberYearModeValue;
  digits: number;
  resetPolicy: ReceiptNumberResetPolicyValue;
  startNumber: number;
  operatorUserId: string;
};

/**
 * 修改收據號碼規則。
 *
 * V11.1.1 新增（對應指令「二、只有最高管理員可以：修改收據號碼規則、
 * 修改起始號碼、重設流水號設定」）：不再只是註解交代「呼叫端要自己檢查」，
 * 這裡直接查資料庫解析 operatorUserId 對應的真實角色，並檢查
 * canReceipt(role, "manageNumbering")——目前權限矩陣只有 SUPER_ADMIN
 * 擁有 manageNumbering，所以效果等同「只有最高管理員可以修改」，且未授權
 * 呼叫（含直接呼叫 API）一律回傳 401/403，不會執行到寫入。
 */
export async function updateReceiptNumberingConfig(
  input: UpdateNumberingConfigInput
): Promise<CollectionResult<ReceiptNumberingConfigView>> {
  const operator = await resolveOperator(input.operatorUserId);
  if (!operator) return { ok: false, status: 401, error: "找不到有效的操作人員身分，請重新選擇目前操作人員" };
  if (!canReceipt(operator.role, "manageNumbering")) {
    return { ok: false, status: 403, error: `目前操作人員（${operator.name}）沒有權限修改收據號碼規則` };
  }

  const validation = validateNumberingConfigInput(input);
  if (!validation.ok) return { ok: false, status: 400, error: validation.error! };

  const before = await getReceiptNumberingConfig();
  const updated = await prisma.receiptNumberingConfig.upsert({
    where: { id: "SINGLETON" },
    update: {
      prefix: input.prefix.trim(),
      yearMode: input.yearMode,
      digits: input.digits,
      resetPolicy: input.resetPolicy,
      startNumber: input.startNumber,
      updatedByName: operator.name,
    },
    create: {
      id: "SINGLETON",
      prefix: input.prefix.trim(),
      yearMode: input.yearMode,
      digits: input.digits,
      resetPolicy: input.resetPolicy,
      startNumber: input.startNumber,
      updatedByName: operator.name,
    },
  });

  await recordVersion({
    entityType: "ReceiptNumberingConfig",
    entityId: "SINGLETON",
    action: "UPDATE",
    beforeData: before,
    afterData: updated,
    operatorName: operator.name,
    changeNote: "設定修改：收據號碼規則",
  });

  return {
    ok: true,
    data: {
      prefix: updated.prefix,
      yearMode: updated.yearMode as ReceiptNumberYearModeValue,
      digits: updated.digits,
      resetPolicy: updated.resetPolicy as ReceiptNumberResetPolicyValue,
      startNumber: updated.startNumber,
      updatedByName: updated.updatedByName,
      updatedAt: updated.updatedAt,
    },
  };
}

/** 設定畫面用：預覽「下一張收據」實際會拿到的號碼（只是預覽用的查詢，不會真的消耗流水號）。 */
export async function previewNextReceiptNumber(sampleDate: Date = new Date()): Promise<string> {
  const config = await getReceiptNumberingConfig();
  const displayYear = resolveReceiptDisplayYear(config.yearMode, sampleDate);
  const counterKey = resolveReceiptCounterKey(config.resetPolicy, displayYear);
  const counter = await prisma.receiptSequenceCounter.findUnique({ where: { yearKey: counterKey } });
  const nextSeq = (counter?.currentValue ?? config.startNumber - 1) + 1;
  return formatReceiptNumber(config, displayYear, nextSeq);
}

// ============================================================
// 二、待開立收據：計算每一筆 PaymentAllocation 尚可開立收據金額
// ============================================================

export type PendingReceiptAllocationView = {
  allocationId: string;
  paymentTransactionId: string;
  transactionNo: string;
  paidOn: Date;
  payerName: string;
  householdId: string | null;
  memberId: string | null;
  sourceType: string;
  sourceLabel: string;
  sourceYear: number | null;
  methodType: string;
  collectedByName: string | null;
  isAgentCollected: boolean;
  allocationAmount: number;
  receiptedAmount: number;
  remainingAmount: number;
  receiptStatus: string;
};

export type PendingReceiptFilters = {
  dateFrom?: Date;
  dateTo?: Date;
  payerName?: string;
  payerPhone?: string;
  householdId?: string;
  transactionNo?: string;
  sourceType?: string;
  methodType?: string;
  collectedByName?: string;
  receiptStatus?: "NOT_LINKED" | "LINKED";
};

/**
 * 需求「六、待開立收據」：顯示已收款但尚未完整開立收據的分配項目。
 *
 * 依專案既有慣例（見 collectionCenter.ts getMonthlyCollectionReport()），
 * 用 findMany + include 一次撈出關聯資料，再用 JS 手動加總計算每筆分配的
 * 「已開立/尚可開立收據金額」，不使用 Prisma groupBy——避免引入這個檔案
 * 是本輪唯一使用、缺乏既有前例可以對照驗證正確性的查詢方式。
 */
export async function listPendingReceiptAllocations(
  filters: PendingReceiptFilters = {}
): Promise<PendingReceiptAllocationView[]> {
  const where: Prisma.PaymentAllocationWhereInput = {
    paymentTransaction: { status: "COMPLETED" },
  };
  if (filters.sourceType) where.sourceType = filters.sourceType as never;
  if (filters.transactionNo) {
    where.paymentTransaction = { ...where.paymentTransaction, transactionNo: { contains: filters.transactionNo } };
  }
  if (filters.householdId) {
    where.paymentTransaction = { ...where.paymentTransaction, payerHouseholdId: filters.householdId };
  }
  if (filters.payerName) {
    where.paymentTransaction = {
      ...where.paymentTransaction,
      payerNameSnapshot: { contains: filters.payerName },
    };
  }
  if (filters.payerPhone) {
    where.paymentTransaction = {
      ...where.paymentTransaction,
      payerPhoneSnapshot: { contains: filters.payerPhone },
    };
  }
  if (filters.methodType) {
    where.paymentTransaction = { ...where.paymentTransaction, methodType: filters.methodType as never };
  }
  if (filters.collectedByName) {
    where.paymentTransaction = {
      ...where.paymentTransaction,
      collectedByName: { contains: filters.collectedByName },
    };
  }
  if (filters.dateFrom || filters.dateTo) {
    where.paymentTransaction = {
      ...where.paymentTransaction,
      paidOn: {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      },
    };
  }
  if (filters.receiptStatus) where.receiptStatus = filters.receiptStatus;

  const allocations = await prisma.paymentAllocation.findMany({
    where,
    include: {
      paymentTransaction: true,
      adjustments: true,
      receiptLines: { include: { receipt: true } },
    },
    orderBy: [{ paymentTransaction: { paidOn: "desc" } }, { createdAt: "asc" }],
  });

  return allocations
    .map((a) => {
      const adjustmentReduction = round2(
        a.adjustments
          .filter((adj) => adj.adjustmentType === "REFUND" || adj.adjustmentType === "TRANSFER_TO_OTHER" || adj.adjustmentType === "VOID_INCOMPLETE")
          .reduce((s, adj) => s + Number(adj.amount), 0)
      );
      const receiptedAmount = round2(
        a.receiptLines
          .filter((line) => isActiveConsumingReceiptStatus(line.receipt.status))
          .reduce((s, line) => s + Number(line.amount), 0)
      );
      const remainingAmount = computeReceiptableRemaining(Number(a.amount), adjustmentReduction, receiptedAmount);
      return {
        allocationId: a.id,
        paymentTransactionId: a.paymentTransactionId,
        transactionNo: a.paymentTransaction.transactionNo,
        paidOn: a.paymentTransaction.paidOn,
        payerName: a.paymentTransaction.payerNameSnapshot,
        householdId: a.paymentTransaction.payerHouseholdId,
        memberId: a.paymentTransaction.payerMemberId,
        sourceType: a.sourceType,
        sourceLabel: a.sourceLabel,
        sourceYear: a.sourceYear,
        methodType: a.paymentTransaction.methodType,
        collectedByName: a.paymentTransaction.collectedByName,
        isAgentCollected: a.paymentTransaction.isAgentCollected,
        allocationAmount: Number(a.amount),
        receiptedAmount,
        remainingAmount,
        receiptStatus: a.receiptStatus,
      };
    })
    .filter((v) => v.remainingAmount > 0);
}

/** 供單筆分配（開立/驗證前）重新查詢最新的「尚可開立收據金額」，避免 TOCTOU（查完到送出之間資料被別人異動）。 */
async function getAllocationReceiptSnapshot(
  allocationId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<{ allocation: Prisma.PaymentAllocationGetPayload<{ include: { adjustments: true; receiptLines: { include: { receipt: true } }; paymentTransaction: true } }>; remaining: number } | null> {
  const allocation = await tx.paymentAllocation.findUnique({
    where: { id: allocationId },
    include: { adjustments: true, receiptLines: { include: { receipt: true } }, paymentTransaction: true },
  });
  if (!allocation) return null;
  const adjustmentReduction = round2(
    allocation.adjustments
      .filter((adj) => adj.adjustmentType === "REFUND" || adj.adjustmentType === "TRANSFER_TO_OTHER" || adj.adjustmentType === "VOID_INCOMPLETE")
      .reduce((s, adj) => s + Number(adj.amount), 0)
  );
  const receiptedAmount = round2(
    allocation.receiptLines
      .filter((line) => isActiveConsumingReceiptStatus(line.receipt.status))
      .reduce((s, line) => s + Number(line.amount), 0)
  );
  const remaining = computeReceiptableRemaining(Number(allocation.amount), adjustmentReduction, receiptedAmount);
  return { allocation, remaining };
}

// ============================================================
// 三、開立收據（合併開立／分項開立／標記不需開立）
// ============================================================

export type IssueReceiptLineInput = {
  allocationId: string;
  amount: number;
  itemName?: string; // 不填則沿用 PaymentAllocation.sourceLabel
};

export type IssueReceiptInput = {
  lines: IssueReceiptLineInput[];
  receiptType?: "MERGED" | "SPLIT_ITEM";
  receiptDate?: Date; // 不填則沿用該筆收款的 paidOn
  payerName?: string; // 不填則沿用收款交易的 payerNameSnapshot
  note?: string;
  idempotencyKey?: string | null;
  createdByName?: string | null;
};

/**
 * 開立收據——同時支援「合併開立」（lines 有多筆，來自同一筆收款交易）與
 * 「分項開立」（lines 只有一筆；使用者對同一筆收款重複呼叫這支函式數次，
 * 每次一筆，就會產生數張各自獨立的收據）。
 *
 * 核心防呆（對應需求「五」）：
 * 1. 所有 lines 的 allocationId 必須屬於同一筆 PaymentTransaction——不允許
 *    跨越不同收款交易的分配合併開立在同一張收據上（一張收據只對應一筆
 *    正式收款交易，見 Receipt.paymentTransactionId 是單一外鍵，不是陣列）。
 * 2. 每一筆 line 的金額都會用交易內剛查到的「即時」尚可開立收據金額重新
 *    驗證一次，不相信呼叫端傳來的舊資料，避免兩人同時開立造成超額開立。
 */
export async function issueReceipt(
  input: IssueReceiptInput,
  operatorName?: string | null
): Promise<CollectionResult<{ id: string; receiptNumber: string | null }>> {
  if (!input.lines?.length) return { ok: false, status: 400, error: "請至少選擇一筆收款分配項目" };

  const idempotencyKey = input.idempotencyKey?.trim() || null;
  if (idempotencyKey) {
    const existing = await prisma.receipt.findUnique({ where: { idempotencyKey } });
    if (existing) return { ok: true, data: { id: existing.id, receiptNumber: existing.receiptNumber } };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const snapshots = [];
      for (const line of input.lines) {
        const snapshot = await getAllocationReceiptSnapshot(line.allocationId, tx);
        if (!snapshot) throw new Error(`找不到收款分配項目 ${line.allocationId}`);
        snapshots.push({ line, ...snapshot });
      }

      const transactionIds = new Set(snapshots.map((s) => s.allocation.paymentTransactionId));
      if (transactionIds.size > 1) {
        throw new Error("同一張收據的所有項目必須來自同一筆收款交易，請分開開立");
      }

      const candidateLines: ReceiptLineCandidateInput[] = snapshots.map((s) => ({
        allocationId: s.line.allocationId,
        amount: s.line.amount,
        remaining: s.remaining,
      }));
      const validation = validateReceiptLineAmounts(candidateLines);
      if (!validation.ok) throw new Error(validation.error!);

      const paymentTransaction = snapshots[0].allocation.paymentTransaction;
      const totalAmount = round2(input.lines.reduce((s, l) => s + l.amount, 0));
      const receiptDate = input.receiptDate ?? paymentTransaction.paidOn;

      const config = await getConfigWithinTx(tx);
      const displayYear = resolveReceiptDisplayYear(config.yearMode, receiptDate);
      const counterKey = resolveReceiptCounterKey(config.resetPolicy, displayYear);

      const seqRows = await tx.$queryRaw<{ currentValue: number }[]>`
        INSERT INTO "receipt_sequence_counters" ("yearKey", "currentValue")
        VALUES (${counterKey}, ${config.startNumber})
        ON CONFLICT ("yearKey") DO UPDATE SET "currentValue" = "receipt_sequence_counters"."currentValue" + 1
        RETURNING "currentValue"
      `;
      const receiptNumber = formatReceiptNumber(config, displayYear, seqRows[0].currentValue);

      const receipt = await tx.receipt.create({
        data: {
          receiptNumber,
          idempotencyKey,
          receiptDate,
          payerName: input.payerName?.trim() || paymentTransaction.payerNameSnapshot,
          householdId: paymentTransaction.payerHouseholdId,
          memberId: paymentTransaction.payerMemberId,
          paymentTransactionId: paymentTransaction.id,
          totalAmount,
          receiptType: input.receiptType ?? "MERGED",
          status: "ISSUED",
          createdByName: input.createdByName?.trim() || operatorName?.trim() || null,
          note: input.note?.trim() || null,
        },
      });

      let displayOrder = 0;
      for (const s of snapshots) {
        await tx.receiptLine.create({
          data: {
            receiptId: receipt.id,
            paymentAllocationId: s.allocation.id,
            sourceType: s.allocation.sourceType,
            sourceId: s.allocation.sourceId,
            itemName: s.line.itemName?.trim() || s.allocation.sourceLabel,
            amount: s.line.amount,
            displayOrder: displayOrder++,
          },
        });
        await tx.paymentAllocation.update({
          where: { id: s.allocation.id },
          data: { receiptStatus: "LINKED", receiptNumber },
        });
      }

      await recordVersion(
        {
          entityType: "Receipt",
          entityId: receipt.id,
          action: "CREATE",
          afterData: receipt,
          operatorName,
          changeNote: `開立收據 ${receiptNumber}`,
        },
        tx
      );

      return receipt;
    });

    return { ok: true, data: { id: result.id, receiptNumber: result.receiptNumber } };
  } catch (err) {
    const isDuplicateIdempotencyKey =
      err instanceof Prisma.PrismaClientKnownRequestError && (err as { code: string }).code === "P2002";
    if (idempotencyKey && isDuplicateIdempotencyKey) {
      const existing = await prisma.receipt.findUnique({ where: { idempotencyKey } });
      if (existing) return { ok: true, data: { id: existing.id, receiptNumber: existing.receiptNumber } };
    }
    const message = err instanceof Error ? err.message : "開立收據時發生錯誤";
    return { ok: false, status: 400, error: message };
  }
}

async function getConfigWithinTx(tx: Prisma.TransactionClient) {
  const row = await tx.receiptNumberingConfig.upsert({
    where: { id: "SINGLETON" },
    update: {},
    create: { id: "SINGLETON" },
  });
  return {
    prefix: row.prefix,
    yearMode: row.yearMode as ReceiptNumberYearModeValue,
    digits: row.digits,
    resetPolicy: row.resetPolicy as ReceiptNumberResetPolicyValue,
    startNumber: row.startNumber,
  };
}

export type MarkNoReceiptRequiredInput = {
  allocationId: string;
  amount: number; // 通常是該筆分配目前全部尚可開立金額，允許只標記其中一部分
  reason: string; // V11.1.1 新增：必填，需求「三」明確要求標記不需開立要記錄原因
  operatorUserId: string; // V11.1.1 新增：必填，需求「三」明確要求限制授權人員操作
};

/**
 * 需求「六、待開立收據」操作之一：標記不需開立。仍然會建立一筆
 * status=NO_RECEIPT_REQUIRED 的 Receipt（不佔用正式收據號碼），讓「已處理
 * /尚可開立金額」的計算不用另外分岔邏輯，也讓這個決定留下稽核紀錄
 * （需求「十九」）。
 *
 * V11.1.1 新增（對應指令「三、補齊『標記不需開立』權限」）：這是獨立於
 * 一般開立權限（issue）之外的權限（markNoReceiptRequired），且必須真的
 * 查詢資料庫驗證操作人身分與角色，不是只在畫面隱藏按鈕；同時要求填寫
 * 原因，並提供 revokeNoReceiptRequired() 讓授權人員撤銷。
 */
export async function markNoReceiptRequired(
  input: MarkNoReceiptRequiredInput
): Promise<CollectionResult<{ id: string }>> {
  if (!input.reason?.trim()) return { ok: false, status: 400, error: "標記不需開立請填寫原因" };

  const operator = await resolveOperator(input.operatorUserId);
  if (!operator) return { ok: false, status: 401, error: "找不到有效的操作人員身分，請重新選擇目前操作人員" };
  if (!canReceipt(operator.role, "markNoReceiptRequired")) {
    return { ok: false, status: 403, error: `目前操作人員（${operator.name}）沒有權限標記不需開立` };
  }

  const snapshot = await getAllocationReceiptSnapshot(input.allocationId);
  if (!snapshot) return { ok: false, status: 404, error: "找不到這筆收款分配項目" };

  const validation = validateReceiptLineAmounts([
    { allocationId: input.allocationId, amount: input.amount, remaining: snapshot.remaining },
  ]);
  if (!validation.ok) return { ok: false, status: 400, error: validation.error! };

  try {
    const receipt = await prisma.$transaction(async (tx) => {
      const created = await tx.receipt.create({
        data: {
          receiptDate: snapshot.allocation.paymentTransaction.paidOn,
          payerName: snapshot.allocation.paymentTransaction.payerNameSnapshot,
          householdId: snapshot.allocation.paymentTransaction.payerHouseholdId,
          memberId: snapshot.allocation.paymentTransaction.payerMemberId,
          paymentTransactionId: snapshot.allocation.paymentTransactionId,
          totalAmount: round2(input.amount),
          status: "NO_RECEIPT_REQUIRED",
          createdByName: operator.name,
          note: `標記不需開立原因：${input.reason.trim()}`,
        },
      });
      await tx.receiptLine.create({
        data: {
          receiptId: created.id,
          paymentAllocationId: snapshot.allocation.id,
          sourceType: snapshot.allocation.sourceType,
          sourceId: snapshot.allocation.sourceId,
          itemName: snapshot.allocation.sourceLabel,
          amount: round2(input.amount),
        },
      });
      await tx.paymentAllocation.update({
        where: { id: snapshot.allocation.id },
        data: { receiptStatus: "LINKED" },
      });
      await recordVersion(
        {
          entityType: "Receipt",
          entityId: created.id,
          action: "UPDATE",
          afterData: created,
          operatorName: operator.name,
          changeNote: `標記不需開立，原因：${input.reason.trim()}`,
        },
        tx
      );
      return created;
    });
    return { ok: true, data: { id: receipt.id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "標記不需開立時發生錯誤";
    return { ok: false, status: 400, error: message };
  }
}

export type RevokeNoReceiptRequiredInput = {
  reason: string;
  operatorUserId: string;
};

/**
 * 撤銷「標記不需開立」（對應指令「三」：允許授權人員撤銷標記，撤銷後
 * 重新回到待開立收據）。實作方式：把這筆 NO_RECEIPT_REQUIRED 的 Receipt
 * 改成 VOIDED（不是刪除——需求「十一」的精神同樣適用：已建立的紀錄
 * 不能直接刪除，要留下可查詢的歷史），VOIDED／REPLACED 都不算「有效佔用
 * 額度」的狀態（見 isActiveConsumingReceiptStatus()），所以撤銷後
 * recalculateAllocationReceiptStatus() 會讓這筆 PaymentAllocation 的
 * receiptStatus 自動退回 NOT_LINKED，待開立收據清單就會重新顯示它。
 */
export async function revokeNoReceiptRequired(
  receiptId: string,
  input: RevokeNoReceiptRequiredInput
): Promise<CollectionResult<{ id: string }>> {
  if (!input.reason?.trim()) return { ok: false, status: 400, error: "撤銷標記請填寫原因" };

  const operator = await resolveOperator(input.operatorUserId);
  if (!operator) return { ok: false, status: 401, error: "找不到有效的操作人員身分，請重新選擇目前操作人員" };
  if (!canReceipt(operator.role, "markNoReceiptRequired")) {
    return { ok: false, status: 403, error: `目前操作人員（${operator.name}）沒有權限撤銷標記不需開立` };
  }

  const receipt = await prisma.receipt.findUnique({ where: { id: receiptId }, include: { lines: true } });
  if (!receipt) return { ok: false, status: 404, error: "找不到這筆紀錄" };
  if (receipt.status !== "NO_RECEIPT_REQUIRED") {
    return { ok: false, status: 400, error: "這筆紀錄目前不是「不需開立」狀態，無法撤銷" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.receipt.update({
        where: { id: receiptId },
        data: {
          status: "VOIDED",
          voidReason: `撤銷標記不需開立：${input.reason.trim()}`,
          voidedAt: new Date(),
          voidedByName: operator.name,
          approvedByName: operator.name,
        },
      });
      await recalculateAllocationReceiptStatus(
        tx,
        receipt.lines.map((l) => l.paymentAllocationId)
      );
      await recordVersion(
        {
          entityType: "Receipt",
          entityId: receiptId,
          action: "VOID",
          beforeData: receipt,
          afterData: { status: "VOIDED" },
          operatorName: operator.name,
          changeNote: `撤銷標記不需開立，原因：${input.reason.trim()}`,
        },
        tx
      );
    });
    return { ok: true, data: { id: receiptId } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "撤銷標記時發生錯誤";
    return { ok: false, status: 400, error: message };
  }
}

// ============================================================
// 四、收據查詢／詳細內容
// ============================================================

export async function getReceiptDetail(id: string) {
  return prisma.receipt.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { displayOrder: "asc" } },
      printLogs: { orderBy: { printedAt: "desc" } },
      paymentTransaction: { include: { allocations: true } },
      originalReceipt: true,
      replacedByReceipts: true,
      household: true,
      member: true,
    },
  });
}

export type ReceiptListFilters = {
  receiptNumber?: string;
  payerName?: string;
  payerPhone?: string;
  householdId?: string;
  transactionNo?: string;
  dateFrom?: Date;
  dateTo?: Date;
  amountFrom?: number;
  amountTo?: number;
  status?: string;
  onlyReprinted?: boolean;
  onlyReissued?: boolean;
};

export async function listReceipts(filters: ReceiptListFilters = {}) {
  const where: Prisma.ReceiptWhereInput = {};
  if (filters.receiptNumber) where.receiptNumber = { contains: filters.receiptNumber };
  if (filters.payerName) where.payerName = { contains: filters.payerName };
  if (filters.householdId) where.householdId = filters.householdId;
  if (filters.status) where.status = filters.status as never;
  if (filters.dateFrom || filters.dateTo) {
    where.receiptDate = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }
  if (filters.amountFrom !== undefined || filters.amountTo !== undefined) {
    where.totalAmount = {
      ...(filters.amountFrom !== undefined ? { gte: filters.amountFrom } : {}),
      ...(filters.amountTo !== undefined ? { lte: filters.amountTo } : {}),
    };
  }
  if (filters.transactionNo || filters.payerPhone) {
    where.paymentTransaction = {
      ...(filters.transactionNo ? { transactionNo: { contains: filters.transactionNo } } : {}),
      ...(filters.payerPhone ? { payerPhoneSnapshot: { contains: filters.payerPhone } } : {}),
    };
  }

  const receipts = await prisma.receipt.findMany({
    where,
    include: { lines: true, printLogs: true, paymentTransaction: true },
    orderBy: [{ receiptDate: "desc" }, { createdAt: "desc" }],
  });

  return receipts
    .filter((r) => (filters.onlyReprinted ? r.printLogs.some((p) => p.kind === "REPRINT") : true))
    .filter((r) => (filters.onlyReissued ? r.originalReceiptId !== null || r.status === "REPLACED" : true));
}

// ============================================================
// 五、收據列印／補印
// ============================================================

export type PrintReceiptInput = {
  printedByName?: string | null;
  reason?: string; // 補印必填
  deviceInfo?: string;
};

export async function printReceipt(
  receiptId: string,
  input: PrintReceiptInput
): Promise<CollectionResult<{ kind: "ORIGINAL_PRINT" | "REPRINT" }>> {
  const receipt = await prisma.receipt.findUnique({ where: { id: receiptId } });
  if (!receipt) return { ok: false, status: 404, error: "找不到這張收據" };
  if (receipt.status === "VOIDED") return { ok: false, status: 400, error: "這張收據已經作廢，無法列印" };
  if (!receipt.receiptNumber) return { ok: false, status: 400, error: "這張收據沒有正式收據號碼，無法列印（可能是「不需開立」的紀錄）" };

  const kind = determinePrintKind(receipt.printCount);
  if (kind === "REPRINT" && !input.reason?.trim()) {
    return { ok: false, status: 400, error: "補印必須填寫原因" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.receiptPrintLog.create({
      data: {
        receiptId,
        receiptNumber: receipt.receiptNumber!,
        kind,
        printedByName: input.printedByName?.trim() || null,
        reason: input.reason?.trim() || null,
        deviceInfo: input.deviceInfo?.trim() || null,
      },
    });
    await tx.receipt.update({ where: { id: receiptId }, data: { printCount: { increment: 1 } } });
    await recordVersion(
      {
        entityType: "Receipt",
        entityId: receiptId,
        action: "PRINT",
        afterData: { printKind: kind, printedByName: input.printedByName, reason: input.reason },
        operatorName: input.printedByName,
        changeNote: kind === "ORIGINAL_PRINT" ? "正式列印" : `補印：${input.reason}`,
      },
      tx
    );
  });

  return { ok: true, data: { kind } };
}

// ============================================================
// 六、收據作廢／換開
// ============================================================

/**
 * 收據作廢／換開共用的「操作人＋核准人」驗證（對應指令「四、補齊收據
 * 作廢與換開的核准控制」）：
 * 1. 操作人必須真實存在、未停用，且角色有權限執行這個動作（void／reissue）。
 * 2. 核准人必須真實存在、未停用，且是授權管理人員（ADMIN 或 SUPER_ADMIN）。
 * 3. 操作人與核准人不可為同一人，除非操作人是 SUPER_ADMIN 執行緊急處理
 *    （isEmergencyOverride=true）且填寫了特殊緊急原因。
 * 這裡回傳的是「已驗證過的真實姓名」，不是直接信任呼叫端傳來的文字——
 * 對應指令「不得只在資料表預留 approvedByName，卻沒有真正驗證」。
 */
async function resolveVoidOrReissueParties(input: {
  operatorUserId: string;
  approverUserId: string;
  isEmergencyOverride?: boolean;
  emergencyReason?: string;
  requiredAction: "void" | "reissue";
}): Promise<CollectionResult<{ operatorName: string; approverName: string }>> {
  const operator = await resolveOperator(input.operatorUserId);
  if (!operator) return { ok: false, status: 401, error: "找不到有效的操作人員身分，請重新選擇目前操作人員" };
  if (!canReceipt(operator.role, input.requiredAction)) {
    const actionLabel = input.requiredAction === "void" ? "作廢" : "換開";
    return { ok: false, status: 403, error: `目前操作人員（${operator.name}）沒有權限執行${actionLabel}` };
  }

  const approverCheck = await resolveApprover(input.approverUserId);
  if (!approverCheck.ok) return approverCheck;
  const approver = approverCheck.approver;

  if (operator.id === approver.id) {
    const isEmergency =
      operator.role === "SUPER_ADMIN" && input.isEmergencyOverride === true && !!input.emergencyReason?.trim();
    if (!isEmergency) {
      return {
        ok: false,
        status: 400,
        error:
          "操作人與核准人不可為同一人。若確實為最高管理員緊急處理，請開啟「緊急處理」選項並填寫特殊緊急原因。",
      };
    }
  }

  return { ok: true, data: { operatorName: operator.name, approverName: approver.name } };
}

export type VoidReceiptInput = {
  reason: string;
  operatorUserId: string;
  approverUserId: string;
  isEmergencyOverride?: boolean;
  emergencyReason?: string;
};

/**
 * 作廢收據——只改變 Receipt 自己的狀態，完全不觸碰 PaymentTransaction／
 * PaymentAllocation（需求「十一」明確禁止作廢收據時自動退款或影響財務
 * 收入）。作廢後 PaymentAllocation.receiptStatus 需要重新計算（如果作廢
 * 後這筆分配已經沒有任何有效收據，退回 NOT_LINKED，讓待開立列表重新
 * 顯示它）。
 *
 * V11.1.1 新增（對應指令「四」）：operatorUserId／approverUserId 都會經過
 * resolveVoidOrReissueParties() 真正查資料庫驗證身分、角色、以及「操作人
 * 不可等於核准人」規則，voidedByName／approvedByName 一律用驗證過的真實
 * 姓名寫入，不再信任呼叫端直接傳來的文字。
 */
export async function voidReceipt(
  receiptId: string,
  input: VoidReceiptInput
): Promise<CollectionResult<{ id: string }>> {
  if (!input.reason?.trim()) return { ok: false, status: 400, error: "作廢請填寫原因" };

  const parties = await resolveVoidOrReissueParties({ ...input, requiredAction: "void" });
  if (!parties.ok) return parties;
  const { operatorName, approverName } = parties.data;

  const receipt = await prisma.receipt.findUnique({ where: { id: receiptId }, include: { lines: true } });
  if (!receipt) return { ok: false, status: 404, error: "找不到這張收據" };
  if (receipt.status === "VOIDED") return { ok: false, status: 400, error: "這張收據已經作廢過了" };
  if (receipt.status === "REPLACED") return { ok: false, status: 400, error: "這張收據已經被換開取代，無法再單獨作廢" };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.receipt.update({
        where: { id: receiptId },
        data: {
          status: "VOIDED",
          voidReason: input.reason.trim(),
          voidedAt: new Date(),
          voidedByName: operatorName,
          approvedByName: approverName,
        },
      });
      await recalculateAllocationReceiptStatus(
        tx,
        receipt.lines.map((l) => l.paymentAllocationId)
      );
      await recordVersion(
        {
          entityType: "Receipt",
          entityId: receiptId,
          action: "VOID",
          beforeData: receipt,
          afterData: { status: "VOIDED", voidReason: input.reason },
          operatorName,
          changeNote: `作廢原因：${input.reason}；核准人：${approverName}`,
        },
        tx
      );
    });
    return { ok: true, data: { id: receiptId } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "作廢收據時發生錯誤";
    return { ok: false, status: 400, error: message };
  }
}

async function recalculateAllocationReceiptStatus(tx: Prisma.TransactionClient, allocationIds: string[]) {
  for (const allocationId of new Set(allocationIds)) {
    const activeLines = await tx.receiptLine.findMany({
      where: { paymentAllocationId: allocationId, receipt: { status: { in: ["ISSUED", "NO_RECEIPT_REQUIRED"] } } },
      include: { receipt: true },
      orderBy: { createdAt: "desc" },
    });
    if (activeLines.length === 0) {
      await tx.paymentAllocation.update({
        where: { id: allocationId },
        data: { receiptStatus: "NOT_LINKED", receiptNumber: null },
      });
    } else {
      await tx.paymentAllocation.update({
        where: { id: allocationId },
        data: { receiptStatus: "LINKED", receiptNumber: activeLines[0].receipt.receiptNumber },
      });
    }
  }
}

export type ReissueReceiptInput = {
  payerName?: string;
  lineOverrides?: { receiptLineId: string; itemName?: string; amount?: number }[];
  reason: string;
  operatorUserId: string;
  approverUserId: string;
  isEmergencyOverride?: boolean;
  emergencyReason?: string;
};

/**
 * 換開收據（需求「十二」）：1. 作廢原收據（狀態改為 REPLACED，不是
 * VOIDED，跟單純作廢區分）；2. 建立內容經過更正的新收據，取得新的正式
 * 號碼；3. 新舊收據透過 originalReceiptId 互相關聯；4. 收款金額不重複
 * 計算——新收據的每一筆明細金額必須等於原收據對應明細的金額（只能更正
 * 姓名／項目名稱等顯示內容，不能趁換開偷偷增加金額，見下方驗證）。
 *
 * V11.1.1 新增（對應指令「四」）：operatorUserId／approverUserId 都會經過
 * resolveVoidOrReissueParties() 真正查資料庫驗證身分、角色、以及「操作人
 * 不可等於核准人」規則。
 */
export async function reissueReceipt(
  oldReceiptId: string,
  input: ReissueReceiptInput
): Promise<CollectionResult<{ id: string; receiptNumber: string | null }>> {
  if (!input.reason?.trim()) return { ok: false, status: 400, error: "換開請填寫原因" };

  const parties = await resolveVoidOrReissueParties({ ...input, requiredAction: "reissue" });
  if (!parties.ok) return parties;
  const { operatorName, approverName } = parties.data;

  const oldReceipt = await prisma.receipt.findUnique({ where: { id: oldReceiptId }, include: { lines: true } });
  if (!oldReceipt) return { ok: false, status: 404, error: "找不到這張收據" };
  if (oldReceipt.status === "VOIDED") return { ok: false, status: 400, error: "已作廢的收據無法換開，如需重開請直接開立新收據" };
  if (oldReceipt.status === "REPLACED") return { ok: false, status: 400, error: "這張收據已經換開過了" };
  if (!oldReceipt.receiptNumber) return { ok: false, status: 400, error: "「不需開立」的紀錄無法換開" };

  const overrideMap = new Map((input.lineOverrides ?? []).map((o) => [o.receiptLineId, o]));
  for (const line of oldReceipt.lines) {
    const override = overrideMap.get(line.id);
    if (override?.amount !== undefined && round2(override.amount) !== round2(Number(line.amount))) {
      return { ok: false, status: 400, error: "換開收據不得變更明細金額，收款金額不得重複計算——如需調整金額請走收款中心的退款/轉款流程" };
    }
  }

  try {
    const newReceipt = await prisma.$transaction(async (tx) => {
      await tx.receipt.update({
        where: { id: oldReceiptId },
        data: {
          status: "REPLACED",
          voidReason: `換開：${input.reason.trim()}`,
          voidedAt: new Date(),
          voidedByName: operatorName,
          approvedByName: approverName,
        },
      });

      const config = await getConfigWithinTx(tx);
      const displayYear = resolveReceiptDisplayYear(config.yearMode, oldReceipt.receiptDate);
      const counterKey = resolveReceiptCounterKey(config.resetPolicy, displayYear);
      const seqRows = await tx.$queryRaw<{ currentValue: number }[]>`
        INSERT INTO "receipt_sequence_counters" ("yearKey", "currentValue")
        VALUES (${counterKey}, ${config.startNumber})
        ON CONFLICT ("yearKey") DO UPDATE SET "currentValue" = "receipt_sequence_counters"."currentValue" + 1
        RETURNING "currentValue"
      `;
      const newReceiptNumber = formatReceiptNumber(config, displayYear, seqRows[0].currentValue);

      const created = await tx.receipt.create({
        data: {
          receiptNumber: newReceiptNumber,
          receiptDate: oldReceipt.receiptDate,
          payerName: input.payerName?.trim() || oldReceipt.payerName,
          householdId: oldReceipt.householdId,
          memberId: oldReceipt.memberId,
          paymentTransactionId: oldReceipt.paymentTransactionId,
          totalAmount: oldReceipt.totalAmount,
          receiptType: oldReceipt.receiptType,
          status: "ISSUED",
          originalReceiptId: oldReceiptId,
          createdByName: operatorName,
          note: oldReceipt.note,
        },
      });

      for (const line of oldReceipt.lines) {
        const override = overrideMap.get(line.id);
        await tx.receiptLine.create({
          data: {
            receiptId: created.id,
            paymentAllocationId: line.paymentAllocationId,
            sourceType: line.sourceType,
            sourceId: line.sourceId,
            activityId: line.activityId,
            itemName: override?.itemName?.trim() || line.itemName,
            amount: line.amount,
            displayOrder: line.displayOrder,
          },
        });
        await tx.paymentAllocation.update({
          where: { id: line.paymentAllocationId },
          data: { receiptStatus: "LINKED", receiptNumber: newReceiptNumber },
        });
      }

      await recordVersion(
        {
          entityType: "Receipt",
          entityId: oldReceiptId,
          action: "REISSUE",
          beforeData: oldReceipt,
          afterData: { newReceiptId: created.id, newReceiptNumber },
          operatorName,
          changeNote: `換開原因：${input.reason}；核准人：${approverName}；新收據號碼：${newReceiptNumber}`,
        },
        tx
      );

      return created;
    });
    return { ok: true, data: { id: newReceipt.id, receiptNumber: newReceipt.receiptNumber } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "換開收據時發生錯誤";
    return { ok: false, status: 400, error: message };
  }
}

// ============================================================
// 七、收據統計／首頁提醒卡
// ============================================================

export async function getReceiptHomeSummary() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [pending, todayIssued, monthIssued, voided, latest] = await Promise.all([
    listPendingReceiptAllocations(),
    prisma.receipt.count({ where: { status: "ISSUED", receiptTime: { gte: startOfToday } } }),
    prisma.receipt.count({ where: { status: "ISSUED", receiptTime: { gte: startOfMonth } } }),
    prisma.receipt.count({ where: { status: "VOIDED" } }),
    prisma.receipt.findFirst({ where: { receiptNumber: { not: null } }, orderBy: { createdAt: "desc" } }),
  ]);

  return {
    pendingCount: pending.length,
    pendingAmount: round2(pending.reduce((s, p) => s + p.remainingAmount, 0)),
    todayIssuedCount: todayIssued,
    monthIssuedCount: monthIssued,
    voidedCount: voided,
    latestReceiptNumber: latest?.receiptNumber ?? null,
  };
}

export type ReceiptStatsFilters = { dateFrom?: Date; dateTo?: Date };

export async function getReceiptStats(filters: ReceiptStatsFilters = {}) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  const where: Prisma.ReceiptWhereInput = {};
  if (filters.dateFrom || filters.dateTo) {
    where.receiptDate = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }

  const receipts = await prisma.receipt.findMany({
    where,
    include: { lines: true, printLogs: true },
  });

  const issued = receipts.filter((r) => r.status === "ISSUED" || r.status === "REPLACED");
  const voided = receipts.filter((r) => r.status === "VOIDED");
  const noReceiptRequired = receipts.filter((r) => r.status === "NO_RECEIPT_REQUIRED");
  // 換開後只計算新的有效收據；REPLACED 狀態本身代表「已經被換開取代」，
  // 它自己的金額不應該重複計入有效開立金額——換開鏈最終只有鏈尾那一張
  // status=ISSUED 的收據才是目前有效版本。
  const effectiveIssued = receipts.filter((r) => r.status === "ISSUED");

  const [todayCount, monthCount, yearCount] = await Promise.all([
    prisma.receipt.count({ where: { ...where, status: "ISSUED", receiptTime: { gte: startOfToday } } }),
    prisma.receipt.count({ where: { ...where, status: "ISSUED", receiptTime: { gte: startOfMonth } } }),
    prisma.receipt.count({ where: { ...where, status: "ISSUED", receiptTime: { gte: startOfYear } } }),
  ]);

  const reprintCount = receipts.reduce((s, r) => s + r.printLogs.filter((p) => p.kind === "REPRINT").length, 0);
  const reissuedCount = receipts.filter((r) => r.status === "REPLACED").length;

  const byActivity = new Map<string, { activityId: string; count: number; amount: number }>();
  const byItem = new Map<string, { itemName: string; count: number; amount: number }>();
  const byOperator = new Map<string, { operatorName: string; count: number; amount: number }>();

  for (const r of effectiveIssued) {
    const operatorKey = r.createdByName ?? "（未填寫）";
    const opEntry = byOperator.get(operatorKey) ?? { operatorName: operatorKey, count: 0, amount: 0 };
    opEntry.count += 1;
    opEntry.amount = round2(opEntry.amount + Number(r.totalAmount));
    byOperator.set(operatorKey, opEntry);

    for (const line of r.lines) {
      if (line.activityId) {
        const actEntry = byActivity.get(line.activityId) ?? { activityId: line.activityId, count: 0, amount: 0 };
        actEntry.count += 1;
        actEntry.amount = round2(actEntry.amount + Number(line.amount));
        byActivity.set(line.activityId, actEntry);
      }
      const itemEntry = byItem.get(line.itemName) ?? { itemName: line.itemName, count: 0, amount: 0 };
      itemEntry.count += 1;
      itemEntry.amount = round2(itemEntry.amount + Number(line.amount));
      byItem.set(line.itemName, itemEntry);
    }
  }

  return {
    todayIssuedCount: todayCount,
    monthIssuedCount: monthCount,
    yearIssuedCount: yearCount,
    totalIssuedAmount: round2(effectiveIssued.reduce((s, r) => s + Number(r.totalAmount), 0)),
    voidedCount: voided.length,
    reissuedCount,
    reprintCount,
    noReceiptRequiredAmount: round2(noReceiptRequired.reduce((s, r) => s + Number(r.totalAmount), 0)),
    byActivity: Array.from(byActivity.values()),
    byItem: Array.from(byItem.values()),
    byOperator: Array.from(byOperator.values()),
  };
}

// ============================================================
// 八、退款／作廢與收據關聯提示（供 collectionCenter.ts 呼叫）
// ============================================================

export type AllocationReceiptImpact = {
  hasActiveReceipts: boolean;
  activeReceiptNumbers: string[];
  totalReceiptedAmount: number;
};

/**
 * 需求「十四、退款與收據關係」：若已開收據的付款之後要退款/作廢，系統必須
 * 提示「此筆付款已開立收據，退款後需確認是否作廢或換開收據」。這支函式
 * 讓 collectionCenter.ts 的退款/轉款/作廢 API 在執行前先查詢，回傳結果由
 * API 層決定是否需要使用者二次確認（見 src/lib/collectionCenter.ts 的
 * createAllocationAdjustment／voidPaymentTransaction 呼叫端）。
 */
export async function getAllocationReceiptImpact(allocationId: string): Promise<AllocationReceiptImpact> {
  const activeLines = await prisma.receiptLine.findMany({
    where: { paymentAllocationId: allocationId, receipt: { status: "ISSUED" } },
    include: { receipt: true },
  });
  return {
    hasActiveReceipts: activeLines.length > 0,
    activeReceiptNumbers: activeLines.map((l) => l.receipt.receiptNumber).filter((n): n is string => !!n),
    totalReceiptedAmount: round2(activeLines.reduce((s, l) => s + Number(l.amount), 0)),
  };
}
