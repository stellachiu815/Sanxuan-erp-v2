import { prisma } from "@/lib/prisma";
import { recordVersion, toJsonSnapshot } from "@/lib/recordVersion";
import { getOrCreateDevoteeProfile } from "@/lib/devoteeProfile";
import type { DevoteeInteractionType } from "@prisma/client";

/**
 * V12.0「互動紀錄」（對應指令「九」）。
 *
 * 「可修改，但不得無紀錄地直接刪除。刪除應採軟刪除並保留稽核紀錄」——
 * deleteInteraction() 只會設定 deletedAt/deletedByName/deleteReason，
 * 資料庫裡的列本身永遠不會被 DELETE，並透過既有 RecordVersion 留下這次
 * 刪除的稽核紀錄（含刪除原因）。
 */

/** 互動類型合法值清單，供 API route 驗證 body.interactionType 使用，避免各處各自重複列一份。 */
export const DEVOTEE_INTERACTION_TYPES: DevoteeInteractionType[] = [
  "PHONE_CALL",
  "LINE_CONTACT",
  "VISIT",
  "ADDRESS_UPDATE",
  "CARE_CONTACT",
  "ACTIVITY_INQUIRY",
  "RITUAL_INQUIRY",
  "OTHER",
];

export type CreateInteractionInput = {
  memberId: string;
  interactionType: DevoteeInteractionType;
  occurredAt: Date;
  content: string;
  followUp?: string | null;
  nextContactDate?: Date | null;
};

export async function createDevoteeInteraction(input: CreateInteractionInput, operatorName: string) {
  const profile = await getOrCreateDevoteeProfile(input.memberId);

  const interaction = await prisma.devoteeInteraction.create({
    data: {
      devoteeProfileId: profile.id,
      interactionType: input.interactionType,
      occurredAt: input.occurredAt,
      content: input.content,
      followUp: input.followUp ?? null,
      nextContactDate: input.nextContactDate ?? null,
      createdByName: operatorName,
    },
  });

  // 新增互動紀錄時，若有填「下次聯絡日期」，一併同步到 DevoteeProfile
  // 的 nextContactSuggestedAt／lastContactedAt（對應指令「七」的欄位），
  // 讓「需要關懷名單」（指令「十一」）能直接讀取這個快照，不用每次都重新
  // 掃描全部互動紀錄計算最新一筆。
  await prisma.devoteeProfile.update({
    where: { id: profile.id },
    data: {
      lastContactedAt: input.occurredAt,
      ...(input.nextContactDate ? { nextContactSuggestedAt: input.nextContactDate } : {}),
    },
  });

  await recordVersion({
    entityType: "DevoteeInteraction",
    entityId: interaction.id,
    action: "CREATE",
    afterData: toJsonSnapshot(interaction),
    operatorName,
    changeNote: `新增互動紀錄（信眾 ${input.memberId}）`,
  });

  return interaction;
}

export type UpdateInteractionInput = {
  interactionType?: DevoteeInteractionType;
  occurredAt?: Date;
  content?: string;
  followUp?: string | null;
  nextContactDate?: Date | null;
};

export async function updateDevoteeInteraction(
  interactionId: string,
  input: UpdateInteractionInput,
  operatorName: string
) {
  const before = await prisma.devoteeInteraction.findUnique({ where: { id: interactionId } });
  if (!before || before.deletedAt) throw new Error("找不到這筆互動紀錄，或已經被刪除");

  const after = await prisma.devoteeInteraction.update({
    where: { id: interactionId },
    data: { ...input, updatedByName: operatorName },
  });

  await recordVersion({
    entityType: "DevoteeInteraction",
    entityId: interactionId,
    action: "UPDATE",
    beforeData: toJsonSnapshot(before),
    afterData: toJsonSnapshot(after),
    operatorName,
    changeNote: "修改互動紀錄",
  });

  return after;
}

/** 軟刪除互動紀錄（對應指令「九」：不得無紀錄地直接刪除）。 */
export async function deleteDevoteeInteraction(interactionId: string, reason: string, operatorName: string) {
  if (!reason.trim()) throw new Error("刪除互動紀錄必須說明原因");

  const before = await prisma.devoteeInteraction.findUnique({ where: { id: interactionId } });
  if (!before || before.deletedAt) throw new Error("找不到這筆互動紀錄，或已經被刪除");

  const after = await prisma.devoteeInteraction.update({
    where: { id: interactionId },
    data: { deletedAt: new Date(), deletedByName: operatorName, deleteReason: reason },
  });

  await recordVersion({
    entityType: "DevoteeInteraction",
    entityId: interactionId,
    action: "DELETE",
    beforeData: toJsonSnapshot(before),
    afterData: toJsonSnapshot(after),
    operatorName,
    changeNote: `刪除互動紀錄（軟刪除）：${reason}`,
  });

  return after;
}

/** 取得某位信眾的互動紀錄（預設不含已軟刪除的）。 */
export async function listDevoteeInteractions(memberId: string, includeDeleted = false) {
  const profile = await prisma.devoteeProfile.findUnique({ where: { memberId } });
  if (!profile) return [];

  return prisma.devoteeInteraction.findMany({
    where: { devoteeProfileId: profile.id, ...(includeDeleted ? {} : { deletedAt: null }) },
    orderBy: { occurredAt: "desc" },
  });
}
