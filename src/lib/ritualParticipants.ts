import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { recordVersion } from "@/lib/recordVersion";
import {
  buildActivityPrintProfileForMember,
  toParticipantSnapshot,
} from "@/lib/activityPrintProfile";

/**
 * V13.4：報名成員（RitualParticipant）的**唯一寫入點**。
 *
 * ⚠️ 全系統所有建立報名的入口——信眾詳情頁、家戶頁普渡登記、活動頁參加
 * 名單、祭改報名、辭世流程、沿用去年——一律透過這裡寫入成員，
 * 不得任何一處自行 `prisma.ritualParticipant.create()`。
 * 有一處繞過，新舊入口就會產生不一致的資料。
 *
 * ── upsert 語意（V13.4 指令五）─────────────────────────────
 *   不存在        → 建立
 *   存在且未刪除   → 回傳既有 + alreadyJoined:true（**HTTP 200，不是錯誤**）
 *   存在但軟刪除   → 復原（清 deletedAt、更新快照）+ restored:true
 *
 * 「已經在報名內」是正常狀態，不是系統錯誤。
 */

export type UpsertParticipantInput = {
  ritualRecordId: string;
  memberId: string;
  notes?: string | null;
  operatorName?: string | null;
};

export type UpsertParticipantOutcome = "CREATED" | "ALREADY_JOINED" | "RESTORED";

export type UpsertParticipantResult = {
  id: string;
  memberId: string;
  outcome: UpsertParticipantOutcome;
};

/** 取得建立快照需要的成員資料。 */
const MEMBER_SNAPSHOT_SELECT = {
  id: true,
  name: true,
  gender: true,
  solarBirthDate: true,
  lunarBirthYear: true,
  lunarBirthMonth: true,
  lunarBirthDay: true,
  lunarIsLeapMonth: true,
  household: { select: { address: true } },
} satisfies Prisma.MemberSelect;

/**
 * 新增或復原一位報名成員（在既有交易內）。
 *
 * 身分快照（姓名／地址）在**建立或復原時**寫入；
 * 列印快照（農曆生日／虛歲／生肖／太歲）在**確認報名時**才產生
 * （見 generatePrintSnapshots），草稿階段維持 null。
 */
export async function upsertParticipantInTransaction(
  tx: Prisma.TransactionClient,
  input: UpsertParticipantInput
): Promise<UpsertParticipantResult> {
  const member = await tx.member.findUnique({
    where: { id: input.memberId },
    select: MEMBER_SNAPSHOT_SELECT,
  });
  if (!member) {
    throw new Error(`找不到信眾（${input.memberId}），無法加入報名`);
  }

  const existing = await tx.ritualParticipant.findUnique({
    where: {
      ritualRecordId_memberId: {
        ritualRecordId: input.ritualRecordId,
        memberId: input.memberId,
      },
    },
  });

  // ── 已存在且有效：不是錯誤，回傳既有資料 ──
  if (existing && !existing.deletedAt) {
    return { id: existing.id, memberId: input.memberId, outcome: "ALREADY_JOINED" };
  }

  // ── 已存在但被移除過：復原，不建立第二筆 ──
  if (existing && existing.deletedAt) {
    const restored = await tx.ritualParticipant.update({
      where: { id: existing.id },
      data: {
        deletedAt: null,
        deletedByName: null,
        nameSnapshot: member.name,
        addressSnapshot: member.household?.address ?? null,
        notes: input.notes ?? existing.notes,
      },
    });
    await recordVersion(
      {
        entityType: "RitualParticipant",
        entityId: restored.id,
        action: "UPDATE",
        beforeData: existing,
        afterData: restored,
        operatorName: input.operatorName,
        changeNote: `恢復報名成員「${member.name}」`,
      },
      tx
    );
    return { id: restored.id, memberId: input.memberId, outcome: "RESTORED" };
  }

  // ── 全新建立 ──
  const created = await tx.ritualParticipant.create({
    data: {
      ritualRecordId: input.ritualRecordId,
      memberId: input.memberId,
      nameSnapshot: member.name,
      addressSnapshot: member.household?.address ?? null,
      notes: input.notes ?? null,
    },
  });
  await recordVersion(
    {
      entityType: "RitualParticipant",
      entityId: created.id,
      action: "CREATE",
      afterData: created,
      operatorName: input.operatorName,
      changeNote: `加入報名成員「${member.name}」`,
    },
    tx
  );
  return { id: created.id, memberId: input.memberId, outcome: "CREATED" };
}

/** 批次加入成員（同一交易）。 */
export async function upsertParticipantsInTransaction(
  tx: Prisma.TransactionClient,
  ritualRecordId: string,
  memberIds: string[],
  operatorName?: string | null
): Promise<UpsertParticipantResult[]> {
  const out: UpsertParticipantResult[] = [];
  for (const memberId of memberIds) {
    out.push(
      await upsertParticipantInTransaction(tx, { ritualRecordId, memberId, operatorName })
    );
  }
  return out;
}

/**
 * 移除一位報名成員（軟刪除）。
 *
 * ⚠️ 不做硬刪除——移除後仍要能復原，且歷史稽核需要保留。
 * 個別成員沒有 status 欄位，「已移除」就是 deletedAt 有值。
 */
export async function removeParticipant(
  ritualRecordId: string,
  memberId: string,
  operatorName?: string | null
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const existing = await prisma.ritualParticipant.findUnique({
    where: { ritualRecordId_memberId: { ritualRecordId, memberId } },
  });
  if (!existing || existing.deletedAt) {
    return { ok: false, status: 404, error: "找不到這位報名成員" };
  }

  await prisma.$transaction(async (tx) => {
    const after = await tx.ritualParticipant.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), deletedByName: operatorName?.trim() || null },
    });
    await recordVersion(
      {
        entityType: "RitualParticipant",
        entityId: existing.id,
        action: "UPDATE",
        beforeData: existing,
        afterData: after,
        operatorName,
        changeNote: `移除報名成員「${existing.nameSnapshot}」`,
      },
      tx
    );
  });

  return { ok: true };
}

/** 列出一筆報名的成員（預設只列有效的）。 */
export async function listParticipants(ritualRecordId: string, includeRemoved = false) {
  return prisma.ritualParticipant.findMany({
    where: {
      ritualRecordId,
      ...(includeRemoved ? {} : { deletedAt: null }),
    },
    include: { member: { select: { id: true, name: true, role: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * V13.4 指令十：**確認報名時**產生每位成員的列印快照。
 *
 * ⚠️ 每一位成員各自一份快照。全家燈列印多位家人時，絕不能只存代表人的
 * 那一份——每個人的農曆生日與虛歲都不同。
 *
 * 快照一律經過共用的 buildActivityPrintProfileForMember()，
 * 不在這裡自行計算農曆或歲數。
 *
 * @param activityMinguoYear **活動使用年度**（不是今年）
 * @param force true = 重新產生（指令十一「重新產生列印資料」），
 *              會遞增 printProfileVersion；false = 只補產生尚未有快照的
 */
export async function generatePrintSnapshotsInTransaction(
  tx: Prisma.TransactionClient,
  ritualRecordId: string,
  activityMinguoYear: number,
  eventDate: Date | null,
  operatorName?: string | null,
  force = false
): Promise<{ updated: number }> {
  const participants = await tx.ritualParticipant.findMany({
    where: { ritualRecordId, deletedAt: null },
    include: {
      member: {
        select: {
          solarBirthDate: true,
          lunarBirthYear: true,
          lunarBirthMonth: true,
          lunarBirthDay: true,
          lunarIsLeapMonth: true,
          gender: true,
        },
      },
    },
  });

  let updated = 0;
  for (const p of participants) {
    // 非強制模式下，已有快照的不動——避免靜默覆蓋已列印的歷史內容
    if (!force && p.printProfileSnapshotAt !== null) continue;

    const profile = buildActivityPrintProfileForMember(
      p.member,
      activityMinguoYear,
      eventDate
    );
    const snapshot = toParticipantSnapshot(profile);

    await tx.ritualParticipant.update({
      where: { id: p.id },
      data: {
        ...snapshot,
        printProfileVersion: force ? p.printProfileVersion + 1 : p.printProfileVersion,
      },
    });
    updated++;
  }

  if (updated > 0) {
    await recordVersion(
      {
        entityType: "RitualRecord",
        entityId: ritualRecordId,
        action: "UPDATE",
        operatorName,
        changeNote: force
          ? `重新產生 ${updated} 位成員的列印資料（民國 ${activityMinguoYear} 年度）`
          : `產生 ${updated} 位成員的列印資料（民國 ${activityMinguoYear} 年度）`,
      },
      tx
    );
  }

  return { updated };
}

/**
 * 重新產生列印快照（對外入口，含權限外的業務規則）。
 *
 * 指令十一：已列印的資料不得被靜默覆蓋——所以這是一個**明確的動作**，
 * 會記錄操作人與時間，並遞增版本號。
 */
export async function regeneratePrintSnapshots(
  ritualRecordId: string,
  operatorName?: string | null
): Promise<{ ok: true; updated: number } | { ok: false; status: number; error: string }> {
  const record = await prisma.ritualRecord.findUnique({
    where: { id: ritualRecordId },
    include: { templeEvent: true },
  });
  if (!record || record.deletedAt) {
    return { ok: false, status: 404, error: "找不到這筆活動報名" };
  }

  const result = await prisma.$transaction((tx) =>
    generatePrintSnapshotsInTransaction(
      tx,
      ritualRecordId,
      record.year,
      record.templeEvent?.solarDate ?? null,
      operatorName,
      true
    )
  );

  return { ok: true, updated: result.updated };
}
