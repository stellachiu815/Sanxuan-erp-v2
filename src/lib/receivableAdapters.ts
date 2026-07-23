import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";
import { resolvePocketPaymentState } from "@/lib/pocketPricing";
import { additionalPrintItemTypeLabel, activityTypeLabel } from "@/lib/labels";
import {
  round2,
  deriveUniversalPaymentStatus,
  isCrossYearUnpaid,
  type UniversalPaymentStatusValue,
  type SourceLifecycleStatus,
} from "@/lib/collectionCenterRules";

/**
 * V11.0.1「全宮共用收款中心」整合驗收修正輪——新增統一的「應收來源介面／
 * Adapter」架構（對應需求「四、補強既有模組的共用應收介面」）。
 *
 * 在這之前（V11.0），收款中心是在 `collectionCenter.ts` 裡用 if/else
 * 針對每個來源各自寫查詢/寫入邏輯，這樣每加一個來源就要在好幾個函式裡
 * 各自加一個分支，容易漏改。這次改成：
 *
 * 1. 每個來源實作同一份 `ReceivableSourceAdapter` 介面（`listPending`／
 *    `applyPayment`／`applyReversal`）。
 * 2. 所有介面對外回傳的資料，統一收斂成 `UniversalReceivableView`——
 *    需求明確列出的 18 個欄位（sourceType/sourceId/householdId/memberId/
 *    payerName/phone/activityId/activityName/itemName/receivableAmount/
 *    paidAmount/unpaidAmount/paymentStatus/sourceYear/sourceDate/
 *    sourceUrl/canCollect/cannotCollectReason）。
 * 3. `collectionCenter.ts` 透過 `getReceivableAdapter(sourceType)` 從
 *    registry 取用，畫面與 API 完全不需要知道底層是哪一張資料表。
 *
 * 目前真正「已串接」（`isWired: true`）的來源：
 * - `OFFERING_CLAIM`（V10.1 供品認捐，沿用既有 offering_claims/offering_payments）
 * - `MANUAL`（收款中心自建的臨時應收項目）
 * - `UNIVERSAL_SALVATION_SPONSOR`（普渡贊普，V11.0.1 新增付款分錄）
 * - `PURIFICATION_ENTRY`（祭改，V11.0.1 新增付款分錄）
 *
 * 其餘來源（平安燈/太歲燈/補庫/添油香/功德金/誦經/其他）本輪仍只是
 * `ReceivableSourceType` enum 裡的保留列舉值，`REGISTERED_BUT_UNWIRED`
 * 常數清楚列出「已有資料但待補強」與「尚不存在」的差異，交付報告會逐一
 * 對照，不假造這些來源的資料。
 */

export type UniversalReceivableView = {
  sourceType: string;
  sourceId: string;
  householdId: string | null;
  memberId: string | null;
  payerName: string;
  phone: string | null;
  activityId: string | null;
  activityName: string | null;
  itemName: string;
  receivableAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  paymentStatus: UniversalPaymentStatusValue;
  sourceYear: number;
  sourceDate: string; // ISO 日期字串（這筆應收建立/登記的日期，供排序/稽核使用）
  sourceUrl: string; // 回到原始模組畫面的深連結
  canCollect: boolean;
  cannotCollectReason: string | null;
  // 以下為畫面顯示方便額外附加的欄位，不在需求列出的 18 個必要欄位內：
  isCrossYear: boolean;
  note: string | null;
  createdAt: Date;
};

export type PendingReceivableFilters = {
  currentYear: number;
  sponsorMemberId?: string;
  sponsorHouseholdId?: string;
  onlyCrossYear?: boolean;
};

export type ApplyPaymentContext = {
  paidOn: Date;
  method: string;
  collectedByName: string | null;
  transactionNo: string;
  operatorName?: string | null;
  /** 預設 "PAYMENT"；轉款轉入目標來源時傳 "TRANSFER_IN"，讓分錄的 kind 正確反映這是轉款而不是一般收款。 */
  kind?: "PAYMENT" | "TRANSFER_IN";
};

export type ApplyPaymentResult = { ledgerId: string | null; label: string; year: number };

export type ApplyReversalContext = {
  reason: string;
  operatorName?: string | null;
  /** 預設 "REFUND"；轉款轉出來源時傳 "TRANSFER_OUT"。 */
  kind?: "REFUND" | "TRANSFER_OUT";
};

export interface ReceivableSourceAdapter {
  sourceType: string;
  isWired: boolean;
  /** 這個來源目前所有未收/部分收款的項目（給待收款項清單／快速收款用）。 */
  listPending(filters: PendingReceivableFilters): Promise<UniversalReceivableView[]>;
  /**
   * 在收款中心自己開的資料庫交易裡，把一筆金額套用到這個來源（建立收款
   * 分錄、更新已收/未收金額）。伺服器端會在這裡面用「原子條件式 UPDATE」
   * 重新檢查最新未收金額，金額不足或來源已不可收款時直接丟出 Error，讓
   * 外層交易整筆回復（不會留下部分寫入的髒資料）。
   */
  applyPayment(
    tx: Prisma.TransactionClient,
    sourceId: string,
    amount: number,
    ctx: ApplyPaymentContext
  ): Promise<ApplyPaymentResult>;
  /** 沖銷一筆金額（退款/轉款/作廢共用），同樣在同一個交易裡原子執行。 */
  applyReversal(tx: Prisma.TransactionClient, sourceId: string, amount: number, ctx: ApplyReversalContext): Promise<void>;
}

// ============================================================
// Adapter 1：OFFERING_CLAIM（V10.1 供品認捐，唯一成熟的既有來源）
// ============================================================

const offeringClaimAdapter: ReceivableSourceAdapter = {
  sourceType: "OFFERING_CLAIM",
  isWired: true,

  async listPending(filters) {
    const where: Prisma.OfferingClaimWhereInput = {
      deletedAt: null,
      status: "ACTIVE",
      paymentStatus: { in: ["UNPAID", "PARTIAL"] },
    };
    if (filters.sponsorMemberId) where.sponsorMemberId = filters.sponsorMemberId;
    if (filters.sponsorHouseholdId) where.sponsorHouseholdId = filters.sponsorHouseholdId;

    const claims = await prisma.offeringClaim.findMany({
      where,
      include: { offeringType: true, activity: true, floralSlot: true },
      orderBy: [{ year: "asc" }, { createdAt: "asc" }],
    });

    return claims
      .map((c) => {
        const contextParts = [`${c.activity.year}年度${c.activity.name}`];
        if (c.floralSlot) contextParts.push(`農曆${c.floralSlot.lunarMonth}月${c.floralSlot.lunarDay}日`);
        const paymentStatus = deriveUniversalPaymentStatus({
          lifecycleStatus: mapOfferingClaimStatus(c.status),
          amountDue: Number(c.amountDue),
          amountPaid: Number(c.amountPaid),
          isWaived: c.paymentStatus === "WAIVED",
        });
        const view: UniversalReceivableView = {
          sourceType: "OFFERING_CLAIM",
          sourceId: c.id,
          householdId: c.sponsorHouseholdId,
          memberId: c.sponsorMemberId,
          payerName: c.sponsorNameSnapshot,
          phone: c.phoneSnapshot,
          activityId: c.activityId,
          activityName: c.activity.name,
          itemName: c.offeringType.name,
          receivableAmount: Number(c.amountDue),
          paidAmount: Number(c.amountPaid),
          unpaidAmount: Number(c.amountUnpaid),
          paymentStatus,
          sourceYear: c.year,
          sourceDate: c.createdAt.toISOString(),
          sourceUrl: `/offering-center/activity/${c.activityId}`,
          canCollect: c.status === "ACTIVE" && Number(c.amountUnpaid) > 0,
          cannotCollectReason: c.status !== "ACTIVE" ? "認捐狀態不是有效，無法收款" : null,
          isCrossYear: isCrossYearUnpaid(c.year, filters.currentYear, c.paymentStatus),
          note: c.note,
          createdAt: c.createdAt,
        };
        return view;
      })
      .filter((v) => (filters.onlyCrossYear ? v.isCrossYear : true));
  },

  async applyPayment(tx, sourceId, amount, ctx) {
    // 原子條件式 UPDATE：WHERE 子句直接把「狀態必須有效」「未收金額必須
    // 足夠」寫進同一條 SQL，PostgreSQL 保證這條 UPDATE 本身是原子操作，
    // 兩個人同時對同一筆認捐送出收款時，只有一個人能真的把未收金額扣下去，
    // 另一個人會拿到 0 rows、直接失敗，不會發生「兩人都收款成功、未收
    // 金額變成負數」的情況。
    const rows = await tx.$queryRaw<
      { id: string; amountDue: Prisma.Decimal; amountPaid: Prisma.Decimal; amountUnpaid: Prisma.Decimal }[]
    >`
      UPDATE "offering_claims"
      SET "amountPaid" = "amountPaid" + ${amount},
          "amountUnpaid" = GREATEST("amountDue" - ("amountPaid" + ${amount}), 0)
      WHERE "id" = ${sourceId} AND "status" = 'ACTIVE' AND "deletedAt" IS NULL AND "amountUnpaid" >= ${amount}
      RETURNING "id", "amountDue", "amountPaid", "amountUnpaid"
    `;
    if (rows.length === 0) {
      const current = await tx.offeringClaim.findUnique({ where: { id: sourceId } });
      if (!current || current.deletedAt) throw new Error(`找不到這筆供品認捐資料（${sourceId}）`);
      if (current.status !== "ACTIVE") throw new Error(`「${current.sponsorNameSnapshot}」這筆認捐目前不是有效狀態，無法收款`);
      throw new Error(`收款金額超過目前未收金額（可能剛被其他人收款），請重新整理後再試`);
    }
    const updated = rows[0];
    const paymentStatus =
      Number(updated.amountPaid) <= 0
        ? "UNPAID"
        : Number(updated.amountPaid) >= Number(updated.amountDue)
        ? "PAID"
        : "PARTIAL";
    await tx.offeringClaim.update({ where: { id: sourceId }, data: { paymentStatus } });

    const claim = await tx.offeringClaim.findUnique({ where: { id: sourceId }, include: { offeringType: true, activity: true } });
    const payment = await tx.offeringPayment.create({
      data: {
        offeringClaimId: sourceId,
        kind: ctx.kind ?? "PAYMENT",
        amount,
        paidOn: ctx.paidOn,
        method: ctx.method,
        collectedByName: ctx.collectedByName,
        note: `[全宮共用收款中心合併收款 ${ctx.transactionNo}]`,
      },
    });
    await recordVersion(
      {
        entityType: "OfferingClaim",
        entityId: sourceId,
        action: "UPDATE",
        operatorName: ctx.operatorName,
        changeNote: `收款中心合併收款 ${amount} 元（${ctx.transactionNo}）`,
      },
      tx
    );
    return {
      ledgerId: payment.id,
      label: `${claim?.offeringType.name ?? "供品"}－${claim?.sponsorNameSnapshot ?? ""}（${claim?.activity.year ?? ""}年度${claim?.activity.name ?? ""}）`,
      year: claim?.year ?? ctx.paidOn.getFullYear() - 1911,
    };
  },

  async applyReversal(tx, sourceId, amount, ctx) {
    const claim = await tx.offeringClaim.findUnique({ where: { id: sourceId }, include: { payments: true } });
    if (!claim) throw new Error("找不到這筆供品認捐資料");
    await tx.offeringPayment.create({
      data: { offeringClaimId: sourceId, kind: ctx.kind ?? "REFUND", amount, paidOn: new Date(), reason: ctx.reason },
    });
    const paidTotal = [...claim.payments, { kind: "PAYMENT" as const, amount }]
      .filter((p) => p.kind === "PAYMENT" || p.kind === "TRANSFER_IN")
      .reduce((s, p) => s + Number(p.amount), 0);
    // 這裡刻意重新查詢一次完整分錄加總（而不是只做 amountPaid - amount），
    // 因為沖銷是退款/轉款情境，需要跟既有 recordOfferingPayment 系列函式
    // 用同一套「加總所有分錄」算法，避免兩套算法不同步。
    const allPayments = await tx.offeringPayment.findMany({ where: { offeringClaimId: sourceId } });
    const paid = allPayments
      .filter((p) => p.kind === "PAYMENT" || p.kind === "TRANSFER_IN")
      .reduce((s, p) => s + Number(p.amount), 0);
    const refunded = allPayments
      .filter((p) => p.kind === "REFUND" || p.kind === "TRANSFER_OUT")
      .reduce((s, p) => s + Number(p.amount), 0);
    const amountPaid = round2(Math.max(0, paid - refunded));
    const amountDue = Number(claim.amountDue);
    const updated = await tx.offeringClaim.update({
      where: { id: sourceId },
      data: {
        amountPaid,
        amountUnpaid: round2(Math.max(0, amountDue - amountPaid)),
        paymentStatus: amountPaid <= 0 ? "UNPAID" : amountPaid >= amountDue ? "PAID" : "PARTIAL",
      },
    });
    await recordVersion(
      { entityType: "OfferingClaim", entityId: sourceId, action: "UPDATE", beforeData: claim, afterData: updated, operatorName: ctx.operatorName, changeNote: `收款中心沖銷 ${amount} 元：${ctx.reason}` },
      tx
    );
    void paidTotal; // 保留計算式作為交叉檢查文件用途，實際採用的是重新查詢後的 paid/refunded
  },
};

function mapOfferingClaimStatus(status: string): SourceLifecycleStatus {
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "REFUND_PENDING") return "REFUND_PENDING";
  if (status === "REFUNDED") return "REFUNDED";
  return "ACTIVE";
}

// ============================================================
// Adapter 2：MANUAL（收款中心自建的臨時應收項目）
// ============================================================

const manualReceivableAdapter: ReceivableSourceAdapter = {
  sourceType: "MANUAL",
  isWired: true,

  async listPending(filters) {
    const where: Prisma.ManualReceivableWhereInput = { deletedAt: null, status: { in: ["UNPAID", "PARTIAL"] } };
    if (filters.sponsorMemberId) where.payerMemberId = filters.sponsorMemberId;
    if (filters.sponsorHouseholdId) where.payerHouseholdId = filters.sponsorHouseholdId;

    const rows = await prisma.manualReceivable.findMany({ where, orderBy: [{ year: "asc" }, { createdAt: "asc" }] });
    return rows
      .map((r) => {
        const view: UniversalReceivableView = {
          sourceType: "MANUAL",
          sourceId: r.id,
          householdId: r.payerHouseholdId,
          memberId: r.payerMemberId,
          payerName: r.payerNameSnapshot,
          phone: r.payerPhoneSnapshot,
          activityId: null,
          activityName: null,
          itemName: r.title,
          receivableAmount: Number(r.amountDue),
          paidAmount: Number(r.amountPaid),
          unpaidAmount: Number(r.amountUnpaid),
          paymentStatus: deriveUniversalPaymentStatus({
            lifecycleStatus: r.status === "CANCELLED" ? "CANCELLED" : "ACTIVE",
            amountDue: Number(r.amountDue),
            amountPaid: Number(r.amountPaid),
            isWaived: r.status === "WAIVED",
          }),
          sourceYear: r.year,
          sourceDate: r.createdAt.toISOString(),
          sourceUrl: `/collection-center/quick-payment`,
          canCollect: r.status !== "CANCELLED" && Number(r.amountUnpaid) > 0,
          cannotCollectReason: r.status === "CANCELLED" ? "這筆臨時應收項目已取消" : null,
          isCrossYear: r.year < filters.currentYear && (r.status === "UNPAID" || r.status === "PARTIAL"),
          note: r.note,
          createdAt: r.createdAt,
        };
        return view;
      })
      .filter((v) => (filters.onlyCrossYear ? v.isCrossYear : true));
  },

  async applyPayment(tx, sourceId, amount, ctx) {
    const rows = await tx.$queryRaw<
      { id: string; amountDue: Prisma.Decimal; amountPaid: Prisma.Decimal }[]
    >`
      UPDATE "manual_receivables"
      SET "amountPaid" = "amountPaid" + ${amount},
          "amountUnpaid" = GREATEST("amountDue" - ("amountPaid" + ${amount}), 0)
      WHERE "id" = ${sourceId} AND "status" != 'CANCELLED' AND "deletedAt" IS NULL AND "amountUnpaid" >= ${amount}
      RETURNING "id", "amountDue", "amountPaid"
    `;
    if (rows.length === 0) {
      const current = await tx.manualReceivable.findUnique({ where: { id: sourceId } });
      if (!current || current.deletedAt) throw new Error(`找不到這筆臨時應收項目（${sourceId}）`);
      if (current.status === "CANCELLED") throw new Error(`「${current.title}」已取消，無法收款`);
      throw new Error(`收款金額超過目前未收金額（可能剛被其他人收款），請重新整理後再試`);
    }
    const updated = rows[0];
    const status = Number(updated.amountPaid) <= 0 ? "UNPAID" : Number(updated.amountPaid) >= Number(updated.amountDue) ? "PAID" : "PARTIAL";
    const receivable = await tx.manualReceivable.update({ where: { id: sourceId }, data: { status } });
    void ctx;
    return { ledgerId: null, label: `${receivable.title}－${receivable.payerNameSnapshot}（${receivable.year}年度）`, year: receivable.year };
  },

  async applyReversal(tx, sourceId, amount, ctx) {
    const receivable = await tx.manualReceivable.findUnique({ where: { id: sourceId } });
    if (!receivable) throw new Error("找不到這筆臨時應收項目");
    const amountPaid = round2(Math.max(0, Number(receivable.amountPaid) - amount));
    const amountDue = Number(receivable.amountDue);
    await tx.manualReceivable.update({
      where: { id: sourceId },
      data: {
        amountPaid,
        amountUnpaid: round2(Math.max(0, amountDue - amountPaid)),
        status: amountPaid <= 0 ? "UNPAID" : amountPaid >= amountDue ? "PAID" : "PARTIAL",
      },
    });
    void ctx;
  },
};

// ============================================================
// Adapter 3：UNIVERSAL_SALVATION_SPONSOR（普渡贊普，V11.0.1 新串接）
// ============================================================

const universalSalvationSponsorAdapter: ReceivableSourceAdapter = {
  sourceType: "UNIVERSAL_SALVATION_SPONSOR",
  isWired: true,

  async listPending(filters) {
    const where: Prisma.UniversalSalvationDetailWhereInput = {
      isSponsor: true,
      amountUnpaid: { gt: 0 },
      /**
       * V13.4 指令七：**草稿不得進入待收款。**
       * 只有 RitualRecord.status = CONFIRMED 的報名才是有效應收。
       * DRAFT 階段可以先填金額，但不可收款、不可開收據、不可正式列印。
       */
      ritualRecord: { deletedAt: null, status: "CONFIRMED" },
    };
    const rows = await prisma.universalSalvationDetail.findMany({
      where,
      include: { ritualRecord: { include: { household: true } } },
    });
    let filtered = rows;
    if (filters.sponsorHouseholdId) filtered = filtered.filter((r) => r.ritualRecord.householdId === filters.sponsorHouseholdId);
    // 贊普是掛在「戶」層級（UniversalSalvationDetail 沒有 memberId），
    // 用信眾搜尋時只能比對到戶長/主要聯絡人，這裡誠實地不強行湊一個
    // memberId——sponsorMemberId 篩選對這個來源不適用時直接回傳空清單，
    // 避免顯示錯誤的配對。
    if (filters.sponsorMemberId) filtered = [];

    return filtered
      .map((r) => {
        const view: UniversalReceivableView = {
          sourceType: "UNIVERSAL_SALVATION_SPONSOR",
          sourceId: r.id,
          householdId: r.ritualRecord.householdId,
          memberId: null,
          payerName: r.yangshangName || r.ritualRecord.household.contactName || r.ritualRecord.household.name,
          phone: r.ritualRecord.household.phone,
          activityId: r.ritualRecord.templeEventId,
          activityName: `${r.ritualRecord.year}年度普渡`,
          itemName: "普渡贊普",
          receivableAmount: Number(r.amountDue),
          paidAmount: Number(r.amountPaid),
          unpaidAmount: Number(r.amountUnpaid),
          paymentStatus: deriveUniversalPaymentStatus({
            lifecycleStatus: "ACTIVE",
            amountDue: Number(r.amountDue),
            amountPaid: Number(r.amountPaid),
            isWaived: false,
          }),
          sourceYear: r.ritualRecord.year,
          sourceDate: r.createdAt.toISOString(),
          sourceUrl: `/household/${r.ritualRecord.householdId}`,
          canCollect: Number(r.amountUnpaid) > 0,
          cannotCollectReason: null,
          isCrossYear: isCrossYearUnpaid(r.ritualRecord.year, filters.currentYear, Number(r.amountPaid) >= Number(r.amountDue) ? "PAID" : Number(r.amountPaid) > 0 ? "PARTIAL" : "UNPAID"),
          note: r.sponsorNotes,
          createdAt: r.createdAt,
        };
        return view;
      })
      .filter((v) => (filters.onlyCrossYear ? v.isCrossYear : true));
  },

  async applyPayment(tx, sourceId, amount, ctx) {
    const rows = await tx.$queryRaw<
      { id: string; amountDue: Prisma.Decimal; amountPaid: Prisma.Decimal }[]
    >`
      UPDATE "universal_salvation_details"
      SET "amountPaid" = "amountPaid" + ${amount},
          "amountUnpaid" = GREATEST("amountDue" - ("amountPaid" + ${amount}), 0)
      WHERE "id" = ${sourceId} AND "isSponsor" = true AND "amountUnpaid" >= ${amount}
      RETURNING "id", "amountDue", "amountPaid"
    `;
    if (rows.length === 0) {
      const current = await tx.universalSalvationDetail.findUnique({ where: { id: sourceId } });
      if (!current || !current.isSponsor) throw new Error(`找不到這筆贊普資料（${sourceId}）`);
      throw new Error(`收款金額超過目前未收金額（可能剛被其他人收款），請重新整理後再試`);
    }
    const detail = await tx.universalSalvationDetail.findUnique({ where: { id: sourceId }, include: { ritualRecord: { include: { household: true } } } });
    const payment = await tx.universalSalvationPayment.create({
      data: {
        universalSalvationDetailId: sourceId,
        kind: ctx.kind ?? "PAYMENT",
        amount,
        paidOn: ctx.paidOn,
        method: ctx.method,
        collectedByName: ctx.collectedByName,
        note: `[全宮共用收款中心合併收款 ${ctx.transactionNo}]`,
      },
    });
    await recordVersion(
      { entityType: "UniversalSalvationDetail", entityId: sourceId, action: "UPDATE", operatorName: ctx.operatorName, changeNote: `收款中心合併收款 ${amount} 元（${ctx.transactionNo}）` },
      tx
    );
    return {
      ledgerId: payment.id,
      label: `普渡贊普－${detail?.ritualRecord.household.name ?? ""}（${detail?.ritualRecord.year ?? ""}年度普渡）`,
      year: detail?.ritualRecord.year ?? ctx.paidOn.getFullYear() - 1911,
    };
  },

  async applyReversal(tx, sourceId, amount, ctx) {
    const detail = await tx.universalSalvationDetail.findUnique({ where: { id: sourceId } });
    if (!detail) throw new Error("找不到這筆贊普資料");
    await tx.universalSalvationPayment.create({
      data: { universalSalvationDetailId: sourceId, kind: ctx.kind ?? "REFUND", amount, paidOn: new Date(), reason: ctx.reason },
    });
    const allPayments = await tx.universalSalvationPayment.findMany({ where: { universalSalvationDetailId: sourceId } });
    const paid = allPayments.filter((p) => p.kind === "PAYMENT" || p.kind === "TRANSFER_IN").reduce((s, p) => s + Number(p.amount), 0);
    const refunded = allPayments.filter((p) => p.kind === "REFUND" || p.kind === "TRANSFER_OUT").reduce((s, p) => s + Number(p.amount), 0);
    const amountPaid = round2(Math.max(0, paid - refunded));
    const amountDue = Number(detail.amountDue);
    await tx.universalSalvationDetail.update({
      where: { id: sourceId },
      data: { amountPaid, amountUnpaid: round2(Math.max(0, amountDue - amountPaid)) },
    });
  },
};

// ============================================================
// Adapter 4：PURIFICATION_ENTRY（祭改，V11.0.1 新串接）
// ============================================================

const purificationEntryAdapter: ReceivableSourceAdapter = {
  sourceType: "PURIFICATION_ENTRY",
  isWired: true,

  async listPending(filters) {
    const where: Prisma.PurificationEntryWhereInput = {
      deletedAt: null,
      status: "ACTIVE",
      feeStatus: "CHARGEABLE",
      amountUnpaid: { gt: 0 },
      /**
       * V13.4 指令七：**草稿不得進入待收款。**
       * 只有 RitualRecord.status = CONFIRMED 的報名才是有效應收。
       * DRAFT 階段可以先填金額，但不可收款、不可開收據、不可正式列印。
       */
      ritualRecord: { deletedAt: null, status: "CONFIRMED" },
    };
    if (filters.sponsorMemberId) where.memberId = filters.sponsorMemberId;
    const rows = await prisma.purificationEntry.findMany({
      where,
      include: { member: true, ritualRecord: { include: { household: true } }, templeEvent: true },
    });
    let filtered = rows;
    if (filters.sponsorHouseholdId) filtered = filtered.filter((r) => r.ritualRecord.householdId === filters.sponsorHouseholdId);

    return filtered
      .map((r) => {
        const payerName = r.isTemporaryName ? r.manualDisplayName ?? "（未填寫姓名）" : r.member?.name ?? "（信眾資料異常）";
        const phone = r.isTemporaryName ? r.manualPhone : null;
        const view: UniversalReceivableView = {
          sourceType: "PURIFICATION_ENTRY",
          sourceId: r.id,
          householdId: r.ritualRecord.householdId,
          memberId: r.memberId,
          payerName,
          phone,
          activityId: r.templeEventId,
          activityName: r.templeEvent.name,
          itemName: `祭改（編號 ${r.number ?? "尚未編號"}）`,
          receivableAmount: Number(r.amountDue ?? 0),
          paidAmount: Number(r.amountPaid),
          unpaidAmount: Number(r.amountUnpaid),
          paymentStatus: deriveUniversalPaymentStatus({
            lifecycleStatus: r.status === "CANCELLED" ? "CANCELLED" : "ACTIVE",
            amountDue: r.amountDue ? Number(r.amountDue) : null,
            amountPaid: Number(r.amountPaid),
            isWaived: false,
          }),
          sourceYear: r.templeEvent.year,
          sourceDate: r.registeredAt.toISOString(),
          sourceUrl: `/purification/${r.templeEventId}`,
          canCollect: r.status === "ACTIVE" && Number(r.amountUnpaid) > 0,
          cannotCollectReason: r.status !== "ACTIVE" ? "祭改報名狀態不是有效，無法收款" : null,
          isCrossYear: r.templeEvent.year < filters.currentYear && Number(r.amountUnpaid) > 0,
          note: r.notes,
          createdAt: r.registeredAt,
        };
        return view;
      })
      .filter((v) => (filters.onlyCrossYear ? v.isCrossYear : true));
  },

  async applyPayment(tx, sourceId, amount, ctx) {
    const rows = await tx.$queryRaw<
      { id: string; amountDue: Prisma.Decimal | null; amountPaid: Prisma.Decimal }[]
    >`
      UPDATE "purification_entries"
      SET "amountPaid" = "amountPaid" + ${amount},
          "amountUnpaid" = GREATEST(COALESCE("amountDue", 0) - ("amountPaid" + ${amount}), 0)
      WHERE "id" = ${sourceId} AND "status" = 'ACTIVE' AND "feeStatus" = 'CHARGEABLE' AND "deletedAt" IS NULL AND "amountUnpaid" >= ${amount}
      RETURNING "id", "amountDue", "amountPaid"
    `;
    if (rows.length === 0) {
      const current = await tx.purificationEntry.findUnique({ where: { id: sourceId } });
      if (!current || current.deletedAt) throw new Error(`找不到這筆祭改報名資料（${sourceId}）`);
      if (current.feeStatus !== "CHARGEABLE") throw new Error(`這筆祭改報名尚未設定為收費，無法收款`);
      if (current.status !== "ACTIVE") throw new Error(`這筆祭改報名狀態不是有效，無法收款`);
      throw new Error(`收款金額超過目前未收金額（可能剛被其他人收款），請重新整理後再試`);
    }
    const updated = rows[0];
    const paymentStatus: "UNPAID" | "PARTIAL" | "PAID" =
      Number(updated.amountPaid) <= 0 ? "UNPAID" : Number(updated.amountPaid) >= Number(updated.amountDue ?? 0) ? "PAID" : "PARTIAL";
    // 同步既有 paymentStatus/paymentAmount 舊欄位，讓既有祭改畫面（還沒
    // 改讀新欄位前）看到的資料不會顯得完全過時、跟新的收款分錄脫節。
    await tx.purificationEntry.update({ where: { id: sourceId }, data: { paymentStatus, paymentAmount: updated.amountPaid } });

    const entry = await tx.purificationEntry.findUnique({ where: { id: sourceId }, include: { member: true, templeEvent: true } });
    const payment = await tx.purificationPayment.create({
      data: {
        purificationEntryId: sourceId,
        kind: ctx.kind ?? "PAYMENT",
        amount,
        paidOn: ctx.paidOn,
        method: ctx.method,
        collectedByName: ctx.collectedByName,
        note: `[全宮共用收款中心合併收款 ${ctx.transactionNo}]`,
      },
    });
    await recordVersion(
      { entityType: "PurificationEntry", entityId: sourceId, action: "UPDATE", operatorName: ctx.operatorName, changeNote: `收款中心合併收款 ${amount} 元（${ctx.transactionNo}）` },
      tx
    );
    return {
      ledgerId: payment.id,
      label: `祭改（編號${entry?.number ?? ""}）－${entry?.isTemporaryName ? entry?.manualDisplayName : entry?.member?.name ?? ""}（${entry?.templeEvent.year ?? ""}年度）`,
      year: entry?.templeEvent.year ?? ctx.paidOn.getFullYear() - 1911,
    };
  },

  async applyReversal(tx, sourceId, amount, ctx) {
    const entry = await tx.purificationEntry.findUnique({ where: { id: sourceId } });
    if (!entry) throw new Error("找不到這筆祭改報名資料");
    await tx.purificationPayment.create({
      data: { purificationEntryId: sourceId, kind: ctx.kind ?? "REFUND", amount, paidOn: new Date(), reason: ctx.reason },
    });
    const allPayments = await tx.purificationPayment.findMany({ where: { purificationEntryId: sourceId } });
    const paid = allPayments.filter((p) => p.kind === "PAYMENT" || p.kind === "TRANSFER_IN").reduce((s, p) => s + Number(p.amount), 0);
    const refunded = allPayments.filter((p) => p.kind === "REFUND" || p.kind === "TRANSFER_OUT").reduce((s, p) => s + Number(p.amount), 0);
    const amountPaid = round2(Math.max(0, paid - refunded));
    const amountDue = Number(entry.amountDue ?? 0);
    const paymentStatus: "UNPAID" | "PARTIAL" | "PAID" = amountPaid <= 0 ? "UNPAID" : amountPaid >= amountDue ? "PAID" : "PARTIAL";
    await tx.purificationEntry.update({
      where: { id: sourceId },
      data: { amountPaid, amountUnpaid: round2(Math.max(0, amountDue - amountPaid)), paymentStatus, paymentAmount: amountPaid },
    });
  },
};

// ============================================================
// Adapter 5：ADDITIONAL_PRINT_ITEM（寶袋等附加列印項目，V13.3B 新串接）
// ============================================================

/**
 * 計算一筆附加列印項目目前的已收金額。
 *
 * ⚠️ V13.3B 的關鍵設計決定（對應指令第四階段之 10／11）：
 *
 * 其他四個來源（供品／贊普／祭改）各自有**專屬的收款分錄表**
 * （OfferingPayment／UniversalSalvationPayment／PurificationPayment），
 * 所以它們可以在自己的資料表上維護 amountPaid 欄位。
 *
 * **AdditionalPrintItem 沒有這樣的分錄表**，而且它的 `paymentId` 是單一
 * 欄位——一筆寶袋可能分多次收款（部分付款、補收），單一 paymentId
 * 根本無法表達。因此：
 *
 *   唯一真實來源 = PaymentAllocation（收） − PaymentAdjustment（退／轉／作廢）
 *
 * `AdditionalPrintItem.isPaid` / `paymentId` 兩個舊欄位**保留但不作為真實
 * 來源**：isPaid 由這裡算出的結果同步回寫（方便列表查詢），paymentId 維持
 * 相容用途、不再被任何邏輯讀取。這一點在 schema 註解也寫清楚了，避免日後
 * 有人誤把 isPaid 當成可信任的判斷依據。
 */
async function sumAdditionalPrintItemPaid(
  client: Prisma.TransactionClient | typeof prisma,
  itemIds: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (itemIds.length === 0) return result;

  const SOURCE_TYPE = "ADDITIONAL_PRINT_ITEM" as Prisma.PaymentAllocationWhereInput["sourceType"];

  /**
   * ⚠️ 沖銷（退款／轉出／作廢）的來源連結方式必須看清楚，這裡踩過一次坑：
   *
   * `PaymentAdjustment.targetSourceType` / `targetSourceId` **只在
   * TRANSFER_TO_OTHER（轉款）時寫入**，用來記錄「錢轉去哪裡」——
   * 那是**轉入端**，不是被沖銷的來源。
   * REFUND 與 VOID_INCOMPLETE 這兩種的這兩個欄位一律是 null
   * （見 src/lib/collectionCenter.ts 的 createPaymentAdjustment）。
   *
   * 真正指向「被沖銷的是哪一筆來源」的是 `sourceAllocationId`
   * → PaymentAllocation.sourceType / sourceId。
   *
   * 所以這裡用 sourceAllocation 關聯過濾，不是用 targetSourceType。
   * 用錯的話，退款完全不會被扣除，已收金額會永遠停在退款前的數字。
   */
  const [allocations, adjustments, transferIns] = await Promise.all([
    client.paymentAllocation.findMany({
      where: {
        // 這個 enum 值由 20260723000000 migration 新增
        sourceType: SOURCE_TYPE,
        sourceId: { in: itemIds },
      },
      select: { sourceId: true, amount: true },
    }),
    // 沖銷：被退款／轉出／作廢的分配，其來源就是這些寶袋
    client.paymentAdjustment.findMany({
      where: {
        sourceAllocation: { sourceType: SOURCE_TYPE, sourceId: { in: itemIds } },
        adjustmentType: { in: ["REFUND", "TRANSFER_TO_OTHER", "VOID_INCOMPLETE"] },
      },
      select: {
        amount: true,
        adjustmentType: true,
        sourceAllocation: { select: { sourceId: true } },
      },
    }),
    // 轉入：別筆來源的錢轉進這些寶袋（targetSourceType 才是這個用途）
    client.paymentAdjustment.findMany({
      where: {
        adjustmentType: "TRANSFER_TO_OTHER",
        targetSourceType: SOURCE_TYPE as Prisma.PaymentAdjustmentWhereInput["targetSourceType"],
        targetSourceId: { in: itemIds },
      },
      select: { targetSourceId: true, amount: true },
    }),
  ]);

  for (const a of allocations) {
    result.set(a.sourceId, round2((result.get(a.sourceId) ?? 0) + Number(a.amount)));
  }
  for (const adj of adjustments) {
    const sid = adj.sourceAllocation?.sourceId;
    if (!sid) continue;
    // RETAIN_AS_OVERPAYMENT 已在 where 排除——「保留為溢收」代表錢還在宮裡，
    // 不減少已收金額。
    result.set(sid, round2((result.get(sid) ?? 0) - Number(adj.amount)));
  }
  for (const t of transferIns) {
    if (!t.targetSourceId) continue;
    result.set(t.targetSourceId, round2((result.get(t.targetSourceId) ?? 0) + Number(t.amount)));
  }

  // 不允許負數（理論上不會發生，防禦性處理）
  for (const [k, v] of result) result.set(k, round2(Math.max(0, v)));
  return result;
}

/** 已收金額變動後，同步回寫 isPaid 快照。isPaid 不是真實來源，只是查詢便利欄位。 */
async function syncAdditionalPrintItemPaidFlag(
  tx: Prisma.TransactionClient,
  itemId: string
): Promise<void> {
  const item = await tx.additionalPrintItem.findUnique({ where: { id: itemId } });
  if (!item) return;
  const paidMap = await sumAdditionalPrintItemPaid(tx, [itemId]);
  const amountPaid = paidMap.get(itemId) ?? 0;
  const subtotal = Number(item.subtotal ?? 0);
  const state = resolvePocketPaymentState(subtotal, amountPaid);
  if (item.isPaid !== state.isPaid) {
    await tx.additionalPrintItem.update({ where: { id: itemId }, data: { isPaid: state.isPaid } });
  }
}

/**
 * V13.3B：取得單筆附加列印項目目前的已收金額（對外公開）。
 *
 * 供 additionalPrintItems.ts 的 CRUD 財務防呆使用——修改金額、取消、
 * 刪除之前，都必須先知道這筆已經收了多少錢。
 *
 * 真實來源是 PaymentAllocation − PaymentAdjustment，不是 isPaid 欄位。
 */
export async function getAdditionalPrintItemPaidAmount(itemId: string): Promise<number> {
  const map = await sumAdditionalPrintItemPaid(prisma, [itemId]);
  return map.get(itemId) ?? 0;
}

/**
 * V13.3B：**批次**取得多筆附加列印項目的已收金額。
 *
 * ⚠️ 避免 N+1（指令「API 回傳資料」明確要求）：一次讀取多筆項目時，
 * 必須用這一支，不可以在迴圈裡逐筆呼叫 getAdditionalPrintItemPaidAmount()。
 *
 * 內部只發出 3 次查詢（分配／沖銷／轉入），與項目筆數無關。
 */
export async function getAdditionalPrintItemPaidAmounts(
  itemIds: string[]
): Promise<Map<string, number>> {
  return sumAdditionalPrintItemPaid(prisma, itemIds);
}

const additionalPrintItemAdapter: ReceivableSourceAdapter = {
  sourceType: "ADDITIONAL_PRINT_ITEM",
  isWired: true,

  async listPending(filters) {
    /**
     * 只列出「確實要收費、且還沒收足」的項目：
     *   - isChargeable = true（免費贈送不進待收款）
     *   - subtotal > 0
     *   - deletedAt = null（已刪除的不出現）
     *   - status ≠ CANCELLED（已取消的不出現）
     */
    const where: Prisma.AdditionalPrintItemWhereInput = {
      isChargeable: true,
      subtotal: { gt: 0 },
      deletedAt: null,
      status: { not: "CANCELLED" },
      /**
       * V13.4 指令七：**草稿不得進入待收款。**
       * 只有 RitualRecord.status = CONFIRMED 的報名才是有效應收。
       * DRAFT 階段可以先填金額，但不可收款、不可開收據、不可正式列印。
       */
      ritualRecord: { deletedAt: null, status: "CONFIRMED" },
    };
    if (filters.sponsorHouseholdId) where.householdId = filters.sponsorHouseholdId;
    if (filters.sponsorMemberId) where.memberId = filters.sponsorMemberId;

    const items = await prisma.additionalPrintItem.findMany({
      where,
      include: {
        household: true,
        member: true,
        ritualRecord: { include: { household: true } },
        activity: true,
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    if (items.length === 0) return [];

    const paidMap = await sumAdditionalPrintItemPaid(prisma, items.map((i) => i.id));

    return items
      .map((item) => {
        const subtotal = Number(item.subtotal ?? 0);
        const amountPaid = paidMap.get(item.id) ?? 0;
        const state = resolvePocketPaymentState(subtotal, amountPaid);
        // 已收足的不列入待收款
        if (state.amountUnpaid <= 0) return null;

        const year = item.ritualRecord.year;
        const typeLabel = additionalPrintItemTypeLabel[item.itemType] ?? item.itemType;
        const householdName = item.ritualRecord.household.name;

        const view: UniversalReceivableView = {
          sourceType: "ADDITIONAL_PRINT_ITEM",
          sourceId: item.id,
          householdId: item.ritualRecord.householdId,
          memberId: item.memberId,
          payerName: item.member?.name || item.ritualRecord.household.contactName || householdName,
          phone: item.ritualRecord.household.phone,
          activityId: item.activityId,
          activityName: item.activity?.name ?? `${year}年度普渡`,
          itemName:
            `${typeLabel}－${item.printName}` +
            `（${householdName}，${year}年度普渡，數量 ${item.quantity}` +
            `${item.unitPrice ? `，單價 ${Number(item.unitPrice)} 元` : ""}）`,
          receivableAmount: subtotal,
          paidAmount: amountPaid,
          unpaidAmount: state.amountUnpaid,
          paymentStatus: state.status === "PARTIAL" ? "PARTIAL" : "UNPAID",
          sourceYear: year,
          sourceDate: item.createdAt.toISOString(),
          sourceUrl: `/household/${item.ritualRecord.householdId}/rituals/universal-salvation`,
          canCollect: true,
          cannotCollectReason: null,
          isCrossYear: isCrossYearUnpaid(year, filters.currentYear, state.status === "PARTIAL" ? "PARTIAL" : "UNPAID"),
          note: item.note,
          createdAt: item.createdAt,
        };
        return view;
      })
      .filter((v): v is UniversalReceivableView => v !== null)
      .filter((v) => (filters.onlyCrossYear ? v.isCrossYear : true));
  },

  async applyPayment(tx, sourceId, amount, ctx) {
    /**
     * 防超額與防重複入帳。
     *
     * ⚠️ 與其他 adapter 的差異：它們在自己的資料表上有 amountUnpaid 欄位，
     * 可以用「原子條件式 UPDATE」一次完成檢查＋扣減。寶袋的已收金額是
     * 從 PaymentAllocation 推導的，沒有這樣的欄位可以原子更新。
     *
     * 因此改用 **SELECT ... FOR UPDATE 鎖住這一列**，在同一個交易內
     * 重新計算已收金額並檢查。行鎖確保同時兩個人收同一筆寶袋時，
     * 第二個人會等第一個人的交易結束後才讀到最新金額，不會雙雙通過檢查。
     */
    const locked = await tx.$queryRaw<{ id: string; subtotal: Prisma.Decimal | null; isChargeable: boolean; deletedAt: Date | null; status: string }[]>`
      SELECT "id", "subtotal", "isChargeable", "deletedAt", "status"
      FROM "additional_print_items"
      WHERE "id" = ${sourceId}
      FOR UPDATE
    `;
    if (locked.length === 0) throw new Error(`找不到這筆附加列印項目（${sourceId}）`);
    const row = locked[0];
    if (row.deletedAt) throw new Error("這筆項目已被刪除，無法收款");
    if (row.status === "CANCELLED") throw new Error("這筆項目已取消，無法收款");
    if (!row.isChargeable) throw new Error("這筆項目設定為免費，無法收款");

    const subtotal = Number(row.subtotal ?? 0);
    const paidMap = await sumAdditionalPrintItemPaid(tx, [sourceId]);
    const alreadyPaid = paidMap.get(sourceId) ?? 0;
    const unpaid = round2(Math.max(0, subtotal - alreadyPaid));

    if (amount > unpaid) {
      throw new Error(
        `收款金額 ${amount} 元超過目前未收金額 ${unpaid} 元（可能剛被其他人收款），請重新整理後再試`
      );
    }

    const item = await tx.additionalPrintItem.findUnique({
      where: { id: sourceId },
      include: { ritualRecord: { include: { household: true } } },
    });

    await recordVersion(
      {
        entityType: "AdditionalPrintItem",
        entityId: sourceId,
        action: "UPDATE",
        operatorName: ctx.operatorName,
        changeNote: `收款中心合併收款 ${amount} 元（${ctx.transactionNo}）`,
      },
      tx
    );

    // isPaid 是快照，收款後同步。真實來源仍是 PaymentAllocation。
    // ⚠️ 此時本次的 PaymentAllocation 尚未建立（由收款中心外層在 adapter
    // 回傳後才寫入），所以這裡先用「已收 + 本次金額」推算最終狀態。
    const finalState = resolvePocketPaymentState(subtotal, round2(alreadyPaid + amount));
    await tx.additionalPrintItem.update({
      where: { id: sourceId },
      data: { isPaid: finalState.isPaid },
    });

    const typeLabel = item ? additionalPrintItemTypeLabel[item.itemType] ?? item.itemType : "附加列印項目";
    return {
      // 寶袋沒有專屬分錄表，ledgerId 用來源自身 id
      // （PaymentAllocation 本身就是這個來源的正式分錄）
      ledgerId: sourceId,
      label: `${typeLabel}－${item?.printName ?? ""}（${item?.ritualRecord.household.name ?? ""}，${item?.ritualRecord.year ?? ""}年度普渡）`,
      year: item?.ritualRecord.year ?? ctx.paidOn.getFullYear() - 1911,
    };
  },

  async applyReversal(tx, sourceId, _amount, _ctx) {
    /**
     * 退款／轉款／作廢。
     *
     * 實際的沖銷金額由收款中心寫入 PaymentAdjustment（targetSourceType=
     * ADDITIONAL_PRINT_ITEM），這裡不重複建立分錄——寶袋沒有自己的分錄表，
     * PaymentAdjustment 就是唯一紀錄。
     *
     * 這支只負責把 isPaid 快照同步回正確狀態，讓這筆寶袋重新回到
     * 待收款清單（未收或部分付款）。
     */
    const item = await tx.additionalPrintItem.findUnique({ where: { id: sourceId } });
    if (!item) throw new Error("找不到這筆附加列印項目");
    await syncAdditionalPrintItemPaidFlag(tx, sourceId);
  },
};


// ============================================================
// Adapter 6：LANTERN_REGISTRATION（年度燈，V13.4 新串接）
// ============================================================

const lanternRegistrationAdapter: ReceivableSourceAdapter = {
  sourceType: "LANTERN_REGISTRATION",
  isWired: true,

  async listPending(filters) {
    const where: Prisma.LanternRegistrationWhereInput = {
      deletedAt: null,
      amountUnpaid: { gt: 0 },
      /**
       * V13.4 指令七：草稿不得進入待收款。
       * 只有 CONFIRMED 的報名才是有效應收。
       */
      ritualRecord: { deletedAt: null, status: "CONFIRMED" },
    };
    if (filters.sponsorHouseholdId) {
      where.ritualRecord = {
        deletedAt: null,
        status: "CONFIRMED",
        householdId: filters.sponsorHouseholdId,
      };
    }

    const rows = await prisma.lanternRegistration.findMany({
      where,
      include: {
        ritualRecord: {
          include: {
            household: true,
            templeEvent: true,
            participants: { where: { deletedAt: null }, take: 3 },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    return rows
      .map((r) => {
        const rec = r.ritualRecord;
        const typeLabel = activityTypeLabel[rec.activityType] ?? rec.activityType;
        const names = rec.participants.map((p) => p.nameSnapshot).join("、");
        const amountDue = Number(r.amountDue);
        const amountPaid = Number(r.amountPaid);
        const amountUnpaid = Number(r.amountUnpaid);

        const view: UniversalReceivableView = {
          sourceType: "LANTERN_REGISTRATION",
          sourceId: r.id,
          householdId: rec.householdId,
          memberId: null,
          payerName: rec.household.contactName || rec.household.name,
          phone: rec.household.phone,
          activityId: rec.templeEventId,
          activityName: rec.templeEvent?.name ?? `${rec.year}年度${typeLabel}`,
          itemName: `${typeLabel}（${rec.household.name}${names ? `：${names}` : ""}）`,
          receivableAmount: amountDue,
          paidAmount: amountPaid,
          unpaidAmount: amountUnpaid,
          paymentStatus: amountPaid <= 0 ? "UNPAID" : "PARTIAL",
          sourceYear: rec.year,
          sourceDate: r.createdAt.toISOString(),
          sourceUrl: `/registration/${rec.id}`,
          canCollect: true,
          cannotCollectReason: null,
          isCrossYear: isCrossYearUnpaid(
            rec.year,
            filters.currentYear,
            amountPaid <= 0 ? "UNPAID" : "PARTIAL"
          ),
          note: r.notes,
          createdAt: r.createdAt,
        };
        return view;
      })
      .filter((v) => (filters.onlyCrossYear ? v.isCrossYear : true));
  },

  async applyPayment(tx, sourceId, amount, ctx) {
    /**
     * 原子條件式 UPDATE：狀態與未收金額寫在同一條 SQL 的 WHERE，
     * 兩人同時收同一筆時只有一個會成功（比照贊普／供品既有做法）。
     *
     * ⚠️ 同時檢查主檔必須是 CONFIRMED——草稿不可收款。
     */
    const rows = await tx.$queryRaw<
      { id: string; amountDue: Prisma.Decimal; amountPaid: Prisma.Decimal }[]
    >`
      UPDATE "lantern_registrations" AS lr
      SET "amountPaid" = lr."amountPaid" + ${amount},
          "amountUnpaid" = GREATEST(lr."amountDue" - (lr."amountPaid" + ${amount}), 0)
      FROM "ritual_records" AS rr
      WHERE lr."id" = ${sourceId}
        AND lr."ritualRecordId" = rr."id"
        AND lr."deletedAt" IS NULL
        AND rr."deletedAt" IS NULL
        AND rr."status" = 'CONFIRMED'
        AND lr."amountUnpaid" >= ${amount}
      RETURNING lr."id", lr."amountDue", lr."amountPaid"
    `;
    if (rows.length === 0) {
      const current = await tx.lanternRegistration.findUnique({
        where: { id: sourceId },
        include: { ritualRecord: true },
      });
      if (!current || current.deletedAt) throw new Error(`找不到這筆年度燈報名（${sourceId}）`);
      if (current.ritualRecord.status !== "CONFIRMED") {
        throw new Error("這筆年度燈報名尚未確認，無法收款");
      }
      throw new Error("收款金額超過目前未收金額（可能剛被其他人收款），請重新整理後再試");
    }

    const reg = await tx.lanternRegistration.findUnique({
      where: { id: sourceId },
      include: { ritualRecord: { include: { household: true, templeEvent: true } } },
    });

    await recordVersion(
      {
        entityType: "LanternRegistration",
        entityId: sourceId,
        action: "UPDATE",
        operatorName: ctx.operatorName,
        changeNote: `收款中心合併收款 ${amount} 元（${ctx.transactionNo}）`,
      },
      tx
    );

    const typeLabel = reg
      ? activityTypeLabel[reg.ritualRecord.activityType] ?? reg.ritualRecord.activityType
      : "年度燈";
    return {
      // 年度燈沒有專屬分錄表，PaymentAllocation 本身就是正式分錄
      ledgerId: sourceId,
      label: `${typeLabel}－${reg?.ritualRecord.household.name ?? ""}（${reg?.ritualRecord.year ?? ""}年度）`,
      year: reg?.ritualRecord.year ?? ctx.paidOn.getFullYear() - 1911,
    };
  },

  async applyReversal(tx, sourceId, amount, _ctx) {
    const reg = await tx.lanternRegistration.findUnique({ where: { id: sourceId } });
    if (!reg) throw new Error("找不到這筆年度燈報名");

    const amountPaid = round2(Math.max(0, Number(reg.amountPaid) - amount));
    const amountDue = Number(reg.amountDue);
    await tx.lanternRegistration.update({
      where: { id: sourceId },
      data: {
        amountPaid,
        amountUnpaid: round2(Math.max(0, amountDue - amountPaid)),
      },
    });
  },
};

// ============================================================
// Adapter 7～10：V14 多項目架構的收費項目（RitualRegistrationItem）
//
// 白米／訂桌／龍鳳燈／補庫四種收費來源都存在同一張 ritual_registration_items，
// 用同一個工廠產生 adapter，依報名項目 key 過濾，避免四套重複程式。
// 全部沿用既有：DRAFT 不進待收款、原子條件式 UPDATE、不吞錯、金額用 Decimal。
// ============================================================

function makeRegistrationItemAdapter(
  sourceType: string,
  itemKeys: string[],
  fallbackLabel: string
): ReceivableSourceAdapter {
  return {
    sourceType,
    isWired: true,

    async listPending(filters) {
      const where: Prisma.RitualRegistrationItemWhereInput = {
        deletedAt: null,
        // DRAFT／CANCELLED 項目不進待收款（指令七）——即使主報名已確認，
        // 之後新增、尚未確認的項目也不得進待收款。
        status: "CONFIRMED",
        amountUnpaid: { gt: 0 },
        registrationItemType: { key: { in: itemKeys } },
        ritualRecord: { deletedAt: null, status: "CONFIRMED" },
      };
      if (filters.sponsorHouseholdId) {
        where.ritualRecord = {
          deletedAt: null,
          status: "CONFIRMED",
          householdId: filters.sponsorHouseholdId,
        };
      }

      const rows = await prisma.ritualRegistrationItem.findMany({
        where,
        include: {
          registrationItemType: true,
          ritualRecord: { include: { household: true, templeEvent: true } },
          // V14.2：普渡牌位正式關聯——收款中心顯示同一筆 UniversalSalvationEntry 的名稱。
          universalSalvationEntry: { select: { displayName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      });

      return rows
        .map((r) => {
          const rec = r.ritualRecord;
          // 名稱優先讀正式關聯的牌位（超拔祖先→周姓歷代祖先、乙位正魂→○○○乙位正魂、
          // 冤親→當事人姓名），退回自訂名稱／項目型別名。
          const itemName =
            r.universalSalvationEntry?.displayName ?? r.customName ?? r.registrationItemType.name;
          const amountDue = Number(r.amountDue);
          const amountPaid = Number(r.amountPaid);
          const amountUnpaid = Number(r.amountUnpaid);
          const view: UniversalReceivableView = {
            sourceType,
            sourceId: r.id,
            householdId: rec.householdId,
            memberId: r.memberId,
            payerName: rec.household.contactName || rec.household.name,
            phone: rec.household.phone,
            activityId: rec.templeEventId,
            activityName: rec.templeEvent?.name ?? `${rec.year}年度${r.registrationItemType.activityGroupName}`,
            itemName: `${itemName}（${rec.household.name}）`,
            receivableAmount: amountDue,
            paidAmount: amountPaid,
            unpaidAmount: amountUnpaid,
            paymentStatus: amountPaid <= 0 ? "UNPAID" : "PARTIAL",
            sourceYear: rec.year,
            sourceDate: r.createdAt.toISOString(),
            sourceUrl: `/registration/${rec.id}`,
            canCollect: true,
            cannotCollectReason: null,
            isCrossYear: isCrossYearUnpaid(
              rec.year,
              filters.currentYear,
              amountPaid <= 0 ? "UNPAID" : "PARTIAL"
            ),
            note: r.notes,
            createdAt: r.createdAt,
          };
          return view;
        })
        .filter((v) => (filters.onlyCrossYear ? v.isCrossYear : true));
    },

    async applyPayment(tx, sourceId, amount, ctx) {
      const rows = await tx.$queryRaw<
        { id: string; amountDue: Prisma.Decimal; amountPaid: Prisma.Decimal }[]
      >`
        UPDATE "ritual_registration_items" AS ri
        SET "amountPaid" = ri."amountPaid" + ${amount},
            "amountUnpaid" = GREATEST(ri."amountDue" - (ri."amountPaid" + ${amount}), 0)
        FROM "ritual_records" AS rr
        WHERE ri."id" = ${sourceId}
          AND ri."ritualRecordId" = rr."id"
          AND ri."deletedAt" IS NULL
          AND rr."deletedAt" IS NULL
          AND rr."status" = 'CONFIRMED'
          AND ri."amountUnpaid" >= ${amount}
        RETURNING ri."id", ri."amountDue", ri."amountPaid"
      `;
      if (rows.length === 0) {
        const current = await tx.ritualRegistrationItem.findUnique({
          where: { id: sourceId },
          include: { ritualRecord: true },
        });
        if (!current || current.deletedAt) throw new Error(`找不到這筆報名項目（${sourceId}）`);
        if (current.ritualRecord.status !== "CONFIRMED") {
          throw new Error("這筆報名尚未確認，無法收款");
        }
        throw new Error("收款金額超過目前未收金額（可能剛被其他人收款），請重新整理後再試");
      }

      const item = await tx.ritualRegistrationItem.findUnique({
        where: { id: sourceId },
        include: { registrationItemType: true, ritualRecord: { include: { household: true } } },
      });
      await recordVersion(
        {
          entityType: "RitualRegistrationItem",
          entityId: sourceId,
          action: "UPDATE",
          operatorName: ctx.operatorName,
          changeNote: `收款中心合併收款 ${amount} 元（${ctx.transactionNo}）`,
        },
        tx
      );
      return {
        ledgerId: sourceId,
        label: `${item?.registrationItemType.name ?? fallbackLabel}－${item?.ritualRecord.household.name ?? ""}（${item?.ritualRecord.year ?? ""}年度）`,
        year: item?.ritualRecord.year ?? ctx.paidOn.getFullYear() - 1911,
      };
    },

    async applyReversal(tx, sourceId, amount, _ctx) {
      const item = await tx.ritualRegistrationItem.findUnique({ where: { id: sourceId } });
      if (!item) throw new Error("找不到這筆報名項目");
      const amountPaid = round2(Math.max(0, Number(item.amountPaid) - amount));
      const amountDue = Number(item.amountDue);
      await tx.ritualRegistrationItem.update({
        where: { id: sourceId },
        data: {
          amountPaid,
          amountUnpaid: round2(Math.max(0, amountDue - amountPaid)),
        },
      });
    },
  };
}

const riceRegistrationAdapter = makeRegistrationItemAdapter("RICE_REGISTRATION", ["US_RICE"], "白米登記");
const celebrationTableAdapter = makeRegistrationItemAdapter("CELEBRATION_TABLE", ["CELEBRATION_TABLE"], "宮慶訂桌");
const dragonPhoenixLanternAdapter = makeRegistrationItemAdapter("DRAGON_PHOENIX_LANTERN", ["DRAGON_PHOENIX"], "龍鳳燈");
const storageTrousersAdapter = makeRegistrationItemAdapter("STORAGE_TROUSERS", ["STORAGE_TROUSERS"], "補庫");
// V14.2：普渡四類牌位（超拔祖先／乙位正魂／累世冤親債主／無緣子女）年度單價收費，
// 沿用同一套 RitualRegistrationItem adapter，讓應收進待收款／收款中心／首頁統計。
const universalSalvationTabletAdapter = makeRegistrationItemAdapter(
  "UNIVERSAL_SALVATION_TABLET",
  ["US_ANCESTOR", "US_ZHENGHUN", "US_YUANQIN", "US_WUYUAN"],
  "普渡牌位"
);

// ============================================================
// Registry
// ============================================================

const ADAPTERS: ReceivableSourceAdapter[] = [
  offeringClaimAdapter,
  manualReceivableAdapter,
  universalSalvationSponsorAdapter,
  purificationEntryAdapter,
  additionalPrintItemAdapter,
  lanternRegistrationAdapter,
  riceRegistrationAdapter,
  celebrationTableAdapter,
  dragonPhoenixLanternAdapter,
  storageTrousersAdapter,
  universalSalvationTabletAdapter,
];

const ADAPTER_MAP = new Map(ADAPTERS.map((a) => [a.sourceType, a]));

export function getReceivableAdapter(sourceType: string): ReceivableSourceAdapter | undefined {
  return ADAPTER_MAP.get(sourceType);
}

export function listWiredSourceTypes(): string[] {
  return ADAPTERS.filter((a) => a.isWired).map((a) => a.sourceType);
}

/**
 * 需求「七、其他尚未建立的來源」要求交付報告清楚區分「已有資料但待補強」
 * 與「尚不存在」——這裡直接把調查結論寫成常數，交付報告與程式碼共用同一份
 * 事實，不會兩邊各寫一次、之後改了忘記同步。
 */
export const RESERVED_SOURCE_NOTES: Record<string, string> = {
  PEACE_LANTERN: "尚不存在：平安燈目前沒有對應的活動類型與登記資料。",
  TAISUI_LANTERN: "尚不存在：太歲燈目前沒有收費欄位或登記資料。",
  TREASURY_REPAYMENT: "尚不存在：補庫目前沒有收費欄位或登記資料。",
  TEMPLE_CELEBRATION_OTHER: "尚不存在：宮慶目前的收費資料已經透過 OFFERING_CLAIM（供品認捐）串接，沒有其他獨立的宮慶應收資料。",
  DEITY_BIRTHDAY: "尚不存在：神明聖誕目前的收費資料已經透過 OFFERING_CLAIM（供品認捐）串接。",
  OIL_INCENSE_DONATION: "尚不存在：添油香目前沒有對應的登記或收費資料表。",
  MERIT_DONATION: "尚不存在：功德金目前沒有對應的登記或收費資料表。",
  DHARMA_ASSEMBLY: "尚不存在：法會報名目前沒有對應的活動類型與登記資料。",
  SUTRA_CHANTING: "尚不存在：誦經目前沒有對應的登記或收費資料表。",
  OTHER_TEMPLE_ACTIVITY: "尚不存在：目前沒有對應的通用「其他宮務活動」登記資料表。",
};
