import { prisma } from "@/lib/prisma";
import type { Prisma, ActivityType } from "@prisma/client";
import { recordVersion } from "@/lib/recordVersion";
import { isHouseholdLevelLantern } from "@/lib/registrationFormTypes";
import { renderSnapshotTexts } from "@/lib/activityPrintProfile";
import { printAddress } from "@/lib/printChinese";

/**
 * V13.4：年度燈（光明燈／太歲燈／全家燈）報名與計價。
 *
 * ── 資料落點 ────────────────────────────────────────────
 *   主檔     RitualRecord（沿用既有，@@unique[householdId, year, activityType]）
 *   報名成員 RitualParticipant（每位各自持有農曆生日與虛歲快照）
 *   金額     LanternRegistration（一筆報名一筆）
 *
 * 三種燈是**各自獨立**的 ActivityType → 各自獨立的 TempleEvent →
 * 各自獨立的 RitualRecord。所以同一位信眾同年度點光明燈＋太歲燈，
 * 會是兩筆完全獨立的報名，不會互相干擾。
 *
 * ── 個人燈 vs 全家燈 ─────────────────────────────────────
 *   光明燈／太歲燈：一筆報名可含多位成員，應收 = 單價 × 人數
 *   全家燈：整戶一筆應收，與納入人數無關
 *
 * 兩者都會替**每一位**納入成員產生列印快照——全家燈列印全戶名單時，
 * 每個人的農曆生日與虛歲都不同，不能用代表人的資料代替。
 */

/** 年度燈預設單價（元）。活動未設定時的 fallback。 */
export const DEFAULT_LANTERN_UNIT_PRICE = 500;

export type LanternAmountInput = {
  activityType: ActivityType;
  /** 納入的成員人數（全家燈不受此影響） */
  participantCount: number;
  /** 單價。null 時使用 DEFAULT_LANTERN_UNIT_PRICE */
  unitPrice: number | null | undefined;
};

export type LanternAmountResult =
  | { ok: true; amountDue: number }
  | { ok: false; error: string };

/**
 * 計算年度燈應收金額。**唯一的計價來源**，前端送來的金額不採用。
 */
export function computeLanternAmountDue(input: LanternAmountInput): LanternAmountResult {
  const price =
    input.unitPrice === null || input.unitPrice === undefined || !Number.isFinite(input.unitPrice)
      ? DEFAULT_LANTERN_UNIT_PRICE
      : input.unitPrice;

  if (price < 0) return { ok: false, error: "年度燈單價不得小於 0" };

  // 全家燈：整戶一筆，與人數無關
  if (isHouseholdLevelLantern(input.activityType)) {
    return { ok: true, amountDue: Math.round(price * 100) / 100 };
  }

  if (!Number.isInteger(input.participantCount) || input.participantCount < 1) {
    return { ok: false, error: "請至少選擇一位報名成員" };
  }

  const cents = Math.round(price * 100) * input.participantCount;
  return { ok: true, amountDue: cents / 100 };
}

/**
 * 建立或更新一筆年度燈的財務資料（在既有交易內）。
 *
 * ⚠️ 只寫 amountDue。amountPaid／amountUnpaid 由收款 adapter 維護，
 * 這裡不碰——避免兩邊各自計算造成不一致。
 */
export async function upsertLanternRegistrationInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    ritualRecordId: string;
    activityType: ActivityType;
    participantCount: number;
    unitPrice: number | null;
    notes?: string | null;
    operatorName?: string | null;
  }
): Promise<{ ok: true; amountDue: number } | { ok: false; error: string }> {
  const amount = computeLanternAmountDue({
    activityType: params.activityType,
    participantCount: params.participantCount,
    unitPrice: params.unitPrice,
  });
  if (!amount.ok) return amount;

  const existing = await tx.lanternRegistration.findUnique({
    where: { ritualRecordId: params.ritualRecordId },
  });

  /**
   * 已收款保護：新的應收不得低於已收金額。
   * 與 V13.3B 寶袋同樣的規則——避免「已收 1000、應收被改成 500」。
   */
  if (existing && Number(existing.amountPaid) > amount.amountDue) {
    return {
      ok: false,
      error:
        `這筆年度燈已收款 ${Number(existing.amountPaid)} 元，` +
        `新的應收金額 ${amount.amountDue} 元低於已收金額。` +
        `請先於收款中心辦理退款或沖銷後再調整。`,
    };
  }

  const amountPaid = existing ? Number(existing.amountPaid) : 0;
  const amountUnpaid = Math.max(Math.round((amount.amountDue - amountPaid) * 100) / 100, 0);

  if (existing) {
    const after = await tx.lanternRegistration.update({
      where: { id: existing.id },
      data: { amountDue: amount.amountDue, amountUnpaid, notes: params.notes ?? existing.notes },
    });
    await recordVersion(
      {
        entityType: "LanternRegistration",
        entityId: after.id,
        action: "UPDATE",
        beforeData: existing,
        afterData: after,
        operatorName: params.operatorName,
        changeNote: `更新年度燈應收金額為 ${amount.amountDue} 元`,
      },
      tx
    );
  } else {
    const created = await tx.lanternRegistration.create({
      data: {
        ritualRecordId: params.ritualRecordId,
        amountDue: amount.amountDue,
        amountPaid: 0,
        amountUnpaid: amount.amountDue,
        notes: params.notes ?? null,
      },
    });
    await recordVersion(
      {
        entityType: "LanternRegistration",
        entityId: created.id,
        action: "CREATE",
        afterData: created,
        operatorName: params.operatorName,
        changeNote: `建立年度燈報名，應收 ${amount.amountDue} 元`,
      },
      tx
    );
  }

  return { ok: true, amountDue: amount.amountDue };
}

/**
 * 年度燈列印資料。
 *
 * ⚠️ V13.4 指令二／三：一律讀 **RitualParticipant 的快照**，不碰 Member。
 * 信眾日後改名、搬家、改生日都不會改變已確認年度的列印內容。
 * 每位成員都有自己的農曆生日與虛歲——全家燈也一樣。
 */
export type LanternPrintRow = {
  participantId: string;
  memberId: string;
  /** 報名當下的姓名（快照） */
  name: string;
  /** 已國字化的地址（快照） */
  addressText: string;
  /** 農曆生日國字，例如「農曆民國七十九年三月十二日」 */
  lunarBirthText: string;
  /** 依活動年度的虛歲國字，例如「三十八歲」 */
  nominalAgeText: string;
  zodiac: string | null;
  taisui: string | null;
  /** 快照尚未產生（草稿）時為 true，此時不可正式列印 */
  snapshotMissing: boolean;
};

export type LanternPrintBatch = {
  ritualRecordId: string;
  activityType: ActivityType;
  year: number;
  activityName: string;
  householdId: string;
  householdName: string;
  /** 只有 CONFIRMED 才可正式列印（V13.4 指令七） */
  isConfirmed: boolean;
  amountDue: number;
  amountPaid: number;
  amountUnpaid: number;
  rows: LanternPrintRow[];
  /** 尚未產生快照的筆數；> 0 時不可正式列印 */
  missingSnapshotCount: number;
};

export async function buildLanternPrintBatch(
  ritualRecordId: string
): Promise<LanternPrintBatch | null> {
  const record = await prisma.ritualRecord.findUnique({
    where: { id: ritualRecordId },
    include: {
      household: true,
      templeEvent: true,
      lanternRegistration: true,
      participants: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!record || record.deletedAt) return null;

  const rows: LanternPrintRow[] = record.participants.map((p) => {
    const texts = renderSnapshotTexts(p);
    return {
      participantId: p.id,
      memberId: p.memberId,
      name: p.nameSnapshot,
      addressText: printAddress(p.addressSnapshot),
      lunarBirthText: texts.lunarBirthText,
      nominalAgeText: texts.nominalAgeText,
      zodiac: p.zodiacSnapshot,
      taisui: p.taisuiSnapshot,
      snapshotMissing: p.printProfileSnapshotAt === null,
    };
  });

  const reg = record.lanternRegistration;
  return {
    ritualRecordId: record.id,
    activityType: record.activityType,
    year: record.year,
    activityName: record.templeEvent?.name ?? `${record.year}年度`,
    householdId: record.householdId,
    householdName: record.household.name,
    isConfirmed: record.status === "CONFIRMED",
    amountDue: reg ? Number(reg.amountDue) : 0,
    amountPaid: reg ? Number(reg.amountPaid) : 0,
    amountUnpaid: reg ? Number(reg.amountUnpaid) : 0,
    rows,
    missingSnapshotCount: rows.filter((r) => r.snapshotMissing).length,
  };
}
