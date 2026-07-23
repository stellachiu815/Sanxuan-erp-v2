import { prisma } from "@/lib/prisma";
import type { Prisma, ActivityType, RitualRecordStatus } from "@prisma/client";
import { recordVersion } from "@/lib/recordVersion";
import {
  upsertParticipantsInTransaction,
  generatePrintSnapshotsInTransaction,
} from "@/lib/ritualParticipants";
import {
  resolveRegistrationFormType,
  suggestRegistrationFormType,
  isLanternActivityType,
  type RegistrationFormType,
} from "@/lib/registrationFormTypes";
import { upsertLanternRegistrationInTransaction } from "@/lib/lanternRegistration";
import { canAcceptRegistration, listActivityYearCandidates } from "@/lib/activityYear";

/**
 * V13.4：跨活動的**統一報名 service**。
 *
 * ⚠️ 這不是新的報名主檔，而是既有 RitualRecord 的協調層。
 * 信眾詳情頁、家戶頁、活動頁、祭改頁全部呼叫這裡，寫入的都是同一筆
 * RitualRecord 與同一組 RitualParticipant。
 *
 * ── 核心不變式 ──────────────────────────────────────────
 *   同戶 × 同年 × 同活動 = **唯一一筆 RitualRecord**
 *   （@@unique[householdId, year, activityType] 保證）
 *   同戶多人報名 → 共用那一筆，透過 RitualParticipant 記錄成員
 *
 * ── 草稿與確認（指令七）─────────────────────────────────
 *   DRAFT     可編輯、可存、**不進待收款、不可正式列印**
 *   CONFIRMED 通過必要資料驗證後才可切換；此時才進財務與列印流程
 */

export type RegistrationSource =
  | "DEVOTEE_PAGE"
  | "HOUSEHOLD_PAGE"
  | "ACTIVITY_PAGE"
  | "CARRY_OVER"
  | "IMPORT";

export type RegistrationResult =
  | {
      ok: true;
      ritualRecordId: string;
      /** true = 這次新建；false = 開啟既有報名 */
      created: boolean;
      /** 已存在時給畫面顯示的提示 */
      message: string | null;
      formType: RegistrationFormType;
      participantOutcomes: { memberId: string; outcome: string }[];
    }
  | { ok: false; status: number; error: string };

/**
 * 建立或開啟一筆活動報名。
 *
 * 已存在同戶同年同活動的報名時**不是錯誤**——直接開啟既有那一筆並提示，
 * 絕不建立第二筆（指令八）。
 */
export async function registerActivity(params: {
  templeEventId: string;
  householdId: string;
  memberIds: string[];
  source: RegistrationSource;
  operatorName?: string | null;
  /** 年度燈專用 */
  lanternUnitPrice?: number | null;
}): Promise<RegistrationResult> {
  const event = await prisma.templeEvent.findUnique({ where: { id: params.templeEventId } });
  if (!event) return { ok: false, status: 404, error: "找不到這個活動" };

  // ── 報名表型態：明確設定優先，否則以活動類型的預設 mapping 回退 ──
  const formResolution = resolveRegistrationFormType(
    event.registrationFormType ?? suggestRegistrationFormType(event.activityType)
  );
  if (!formResolution.supported) {
    return { ok: false, status: 409, error: formResolution.reason };
  }

  // ── 活動是否開放報名（沿用 V13.1 既有判斷，不另寫一套） ──
  const candidates = await listActivityYearCandidates(event.activityType);
  const candidate = candidates.find((c) => c.templeEventId === event.id);
  if (candidate) {
    const acceptable = canAcceptRegistration(candidate, new Date());
    if (!acceptable.ok) {
      return { ok: false, status: 409, error: `目前無法報名：${acceptable.reason}` };
    }
  }

  const household = await prisma.household.findFirst({
    where: { id: params.householdId, deletedAt: null },
  });
  if (!household) return { ok: false, status: 404, error: "找不到這個家戶" };

  if (params.memberIds.length === 0) {
    return { ok: false, status: 400, error: "請至少選擇一位報名成員" };
  }

  // 成員必須都屬於這一戶
  const members = await prisma.member.findMany({
    where: { id: { in: params.memberIds }, deletedAt: null },
    select: { id: true, householdId: true, name: true },
  });
  const foreign = members.filter((m) => m.householdId !== params.householdId);
  if (foreign.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `「${foreign.map((m) => m.name).join("、")}」不屬於這個家戶，無法加入本次報名`,
    };
  }
  if (members.length !== params.memberIds.length) {
    return { ok: false, status: 400, error: "部分選取的信眾不存在或已被刪除" };
  }

  const result = await prisma.$transaction(async (tx) => {
    // ── 取得或建立唯一的 RitualRecord ──
    const existing = await tx.ritualRecord.findUnique({
      where: {
        householdId_year_activityType: {
          householdId: params.householdId,
          year: event.year,
          activityType: event.activityType,
        },
      },
    });

    if (existing?.deletedAt) {
      throw new Error(
        `這一戶民國 ${event.year} 年的這項活動資料目前在回收區，請先還原後再報名`
      );
    }

    let record = existing;
    let created = false;

    if (!record) {
      record = await tx.ritualRecord.create({
        data: {
          householdId: params.householdId,
          year: event.year,
          activityType: event.activityType,
          templeEventId: event.id,
          // ⚠️ 一律 DRAFT——內容填完並通過驗證後才由 confirmRegistration 切成 CONFIRMED
          status: "DRAFT",
          registrationSource: params.source,
        },
      });
      created = true;
      await recordVersion(
        {
          entityType: "RitualRecord",
          entityId: record.id,
          action: "CREATE",
          afterData: record,
          operatorName: params.operatorName,
          changeNote: `建立民國 ${event.year} 年「${event.name}」報名（來源：${params.source}）`,
        },
        tx
      );
    }

    // ── 寫入報名成員（唯一寫入點） ──
    const outcomes = await upsertParticipantsInTransaction(
      tx,
      record.id,
      params.memberIds,
      params.operatorName
    );

    // ── 年度燈：建立／更新金額 ──
    if (isLanternActivityType(event.activityType)) {
      const activeCount = await tx.ritualParticipant.count({
        where: { ritualRecordId: record.id, deletedAt: null },
      });
      const lantern = await upsertLanternRegistrationInTransaction(tx, {
        ritualRecordId: record.id,
        activityType: event.activityType,
        participantCount: activeCount,
        unitPrice: params.lanternUnitPrice ?? null,
        operatorName: params.operatorName,
      });
      if (!lantern.ok) throw new Error(lantern.error);
    }

    // ── 普渡：確保有 UniversalSalvationDetail 供後續填牌位 ──
    if (event.activityType === "UNIVERSAL_SALVATION") {
      const detail = await tx.universalSalvationDetail.findUnique({
        where: { ritualRecordId: record.id },
      });
      if (!detail) {
        await tx.universalSalvationDetail.create({
          data: { ritualRecordId: record.id, isRegistered: false },
        });
      }
    }

    return { record, created, outcomes };
  });

  return {
    ok: true,
    ritualRecordId: result.record.id,
    created: result.created,
    message: result.created
      ? null
      : "此家戶本年度已有這項活動資料，已為你開啟原報名紀錄。",
    formType: formResolution.formType,
    participantOutcomes: result.outcomes.map((o) => ({
      memberId: o.memberId,
      outcome: o.outcome,
    })),
  };
}

// ============================================================
// 確認報名
// ============================================================

export type ConfirmValidation = { ok: true } | { ok: false; reasons: string[] };

/**
 * 依活動類型檢查「內容是否完整到可以確認」。
 *
 * ⚠️ 由**伺服器**判斷，不信任前端。未通過一律維持 DRAFT，
 * 不會產生「看起來完成、實際缺資料」的報名。
 */
export async function validateForConfirm(
  ritualRecordId: string
): Promise<ConfirmValidation> {
  const record = await prisma.ritualRecord.findUnique({
    where: { id: ritualRecordId },
    include: {
      templeEvent: true,
      participants: { where: { deletedAt: null } },
      universalSalvation: { include: { entries: { where: { deletedAt: null } } } },
      purificationEntries: { where: { deletedAt: null } },
      lanternRegistration: true,
    },
  });
  if (!record) return { ok: false, reasons: ["找不到這筆活動報名"] };

  const reasons: string[] = [];

  const formResolution = resolveRegistrationFormType(
    record.templeEvent?.registrationFormType ?? suggestRegistrationFormType(record.activityType)
  );
  if (!formResolution.supported) {
    return { ok: false, reasons: [formResolution.reason] };
  }

  if (record.participants.length === 0) {
    reasons.push("尚未選擇任何報名成員");
  }

  switch (formResolution.formType) {
    case "UNIVERSAL_SALVATION": {
      const entryCount = record.universalSalvation?.entries.length ?? 0;
      const isSponsor = record.universalSalvation?.isSponsor ?? false;
      if (entryCount === 0 && !isSponsor) {
        reasons.push("普渡報名至少需要一筆牌位登記，或勾選贊普");
      }
      break;
    }
    case "PURIFICATION": {
      if (record.purificationEntries.length === 0) {
        reasons.push("祭改報名至少需要一位成員的報名資料");
      }
      break;
    }
    case "LANTERN": {
      if (!record.lanternRegistration) {
        reasons.push("年度燈報名尚未設定金額");
      } else if (Number(record.lanternRegistration.amountDue) <= 0) {
        reasons.push("年度燈應收金額為 0，請確認金額或明確標記為免費");
      }
      break;
    }
    case "GENERIC":
      // 通用參加型：有成員即可
      break;
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/**
 * 確認報名：DRAFT → CONFIRMED。
 *
 * 這一步會：
 *   1. 伺服器端驗證必要資料
 *   2. 產生每位成員的列印快照（農曆生日／虛歲／生肖／太歲）
 *   3. 切換狀態，此後才進入待收款與正式列印
 */
export async function confirmRegistration(
  ritualRecordId: string,
  operatorName?: string | null
): Promise<
  { ok: true; snapshotsGenerated: number } | { ok: false; status: number; error: string }
> {
  const validation = await validateForConfirm(ritualRecordId);
  if (!validation.ok) {
    return { ok: false, status: 409, error: validation.reasons.join("；") };
  }

  const record = await prisma.ritualRecord.findUnique({
    where: { id: ritualRecordId },
    include: { templeEvent: true },
  });
  if (!record || record.deletedAt) {
    return { ok: false, status: 404, error: "找不到這筆活動報名" };
  }
  if (record.status === "CONFIRMED") {
    return { ok: true, snapshotsGenerated: 0 };
  }
  if (record.status === "CANCELLED") {
    return { ok: false, status: 409, error: "這筆報名已取消，無法直接確認" };
  }

  const result = await prisma.$transaction(async (tx) => {
    // 產生列印快照（依活動年度，不是今年）
    const snap = await generatePrintSnapshotsInTransaction(
      tx,
      ritualRecordId,
      record.year,
      record.templeEvent?.solarDate ?? null,
      operatorName,
      false
    );

    const after = await tx.ritualRecord.update({
      where: { id: ritualRecordId },
      data: { status: "CONFIRMED" satisfies RitualRecordStatus },
    });

    // V14：主報名確認時，旗下所有未刪除的報名項目一律同步 CONFIRMED，
    // 不可讓主報名已確認、子項目仍停留 DRAFT（指令一）。
    await tx.ritualRegistrationItem.updateMany({
      where: { ritualRecordId, deletedAt: null, status: "DRAFT" },
      data: { status: "CONFIRMED" satisfies RitualRecordStatus },
    });

    await recordVersion(
      {
        entityType: "RitualRecord",
        entityId: ritualRecordId,
        action: "UPDATE",
        beforeData: record,
        afterData: after,
        operatorName,
        changeNote: `確認民國 ${record.year} 年活動報名（產生 ${snap.updated} 位成員的列印資料）`,
      },
      tx
    );

    return snap;
  });

  return { ok: true, snapshotsGenerated: result.updated };
}

/** 取消報名（保留歷史）。 */
export async function cancelRegistration(
  ritualRecordId: string,
  operatorName?: string | null
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const record = await prisma.ritualRecord.findUnique({ where: { id: ritualRecordId } });
  if (!record || record.deletedAt) {
    return { ok: false, status: 404, error: "找不到這筆活動報名" };
  }
  if (record.status === "CANCELLED") return { ok: true };

  await prisma.$transaction(async (tx) => {
    const after = await tx.ritualRecord.update({
      where: { id: ritualRecordId },
      data: { status: "CANCELLED" satisfies RitualRecordStatus },
    });
    // V14：取消主報名時，旗下所有未刪除的報名項目一律同步 CANCELLED，
    // 使其不再進入待收款與列印（指令一）。
    await tx.ritualRegistrationItem.updateMany({
      where: { ritualRecordId, deletedAt: null },
      data: { status: "CANCELLED" satisfies RitualRecordStatus },
    });
    await recordVersion(
      {
        entityType: "RitualRecord",
        entityId: ritualRecordId,
        action: "UPDATE",
        beforeData: record,
        afterData: after,
        operatorName,
        changeNote: "取消活動報名",
      },
      tx
    );
  });

  return { ok: true };
}

// ============================================================
// 可報名活動查詢
// ============================================================

export type AvailableActivity = {
  templeEventId: string;
  activityType: ActivityType;
  year: number;
  name: string;
  eventDate: string | null;
  status: string;
  /** 報名表型態；null = 尚未設定，畫面應標示不可報名 */
  registrationFormType: string | null;
  formSupported: boolean;
  formUnsupportedReason: string | null;
  /** 這一戶是否已有這個活動的報名 */
  alreadyRegistered: boolean;
  existingRitualRecordId: string | null;
  existingStatus: RitualRecordStatus | null;
};

/**
 * 列出一位信眾目前可報名的活動。
 *
 * ⚠️ 活動清單**完全動態**——從 TempleEvent 查，用既有 canAcceptRegistration()
 * 過濾。前端零寫死年份與活動種類。
 *
 * 但表單能力是**後端受控**：registrationFormType 未設定的活動仍會列出，
 * 只是標記為不可報名並附上原因（指令四：不得自動降級成通用）。
 */
export async function listAvailableActivitiesForMember(
  memberId: string,
  now: Date = new Date()
): Promise<AvailableActivity[]> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { householdId: true, deletedAt: true },
  });
  if (!member || member.deletedAt) return [];

  const events = await prisma.templeEvent.findMany({
    where: { isArchived: false },
    orderBy: [{ year: "desc" }, { activityType: "asc" }],
  });

  const existingRecords = await prisma.ritualRecord.findMany({
    where: { householdId: member.householdId, deletedAt: null },
    select: { id: true, year: true, activityType: true, status: true },
  });
  const existingKey = new Map(
    existingRecords.map((r) => [`${r.activityType}::${r.year}`, r])
  );

  const out: AvailableActivity[] = [];
  for (const e of events) {
    const candidate = {
      templeEventId: e.id,
      activityType: e.activityType,
      year: e.year,
      name: e.name,
      registrationStartAt: e.registrationStartAt,
      registrationEndAt: e.registrationEndAt,
      eventDate: e.solarDate,
      isRegistrationOpen: e.isRegistrationOpen,
      isPrintOpen: e.isPrintOpen,
      isCompleted: e.isCompleted,
      isArchived: e.isArchived,
      status: e.status,
    };
    const acceptable = canAcceptRegistration(candidate, now);
    const existing = existingKey.get(`${e.activityType}::${e.year}`);

    // 未開放報名、且這一戶也沒有既有報名 → 不列出
    if (!acceptable.ok && !existing) continue;

    const formResolution = resolveRegistrationFormType(
      e.registrationFormType ?? suggestRegistrationFormType(e.activityType)
    );

    out.push({
      templeEventId: e.id,
      activityType: e.activityType,
      year: e.year,
      name: e.name,
      eventDate: e.solarDate ? e.solarDate.toISOString().slice(0, 10) : null,
      status: e.status,
      registrationFormType: e.registrationFormType,
      formSupported: formResolution.supported,
      formUnsupportedReason: formResolution.supported ? null : formResolution.reason,
      alreadyRegistered: existing !== undefined,
      existingRitualRecordId: existing?.id ?? null,
      existingStatus: existing?.status ?? null,
    });
  }

  return out;
}
