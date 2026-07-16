import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";
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
      ritualRecord: { deletedAt: null },
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
// Registry
// ============================================================

const ADAPTERS: ReceivableSourceAdapter[] = [
  offeringClaimAdapter,
  manualReceivableAdapter,
  universalSalvationSponsorAdapter,
  purificationEntryAdapter,
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
