import { prisma } from "@/lib/prisma";
import { recordVersion, toJsonSnapshot } from "@/lib/recordVersion";
import { getOrCreateDevoteeProfile } from "@/lib/devoteeProfile";

/**
 * V12.0「信眾標籤」（對應指令「八」）。
 *
 * 規則逐項對照：
 * 1. 一位信眾可以有多個標籤 —— DevoteeTagAssignment 沒有數量限制。
 * 2. 同一標籤不得重複套用 —— @@unique([devoteeProfileId, tagId])，資料庫
 *    層級保證，即使 API 層邏輯有漏洞也不會真的寫進兩筆重複資料。
 * 3. 標籤停用後不得影響舊資料 —— 停用只是把 DevoteeTag.isActive 設為
 *    false，不會動到既有的 DevoteeTagAssignment；已經套用過的信眾身上
 *    仍然看得到這個標籤（畫面上可以額外標示「已停用」，但資料不會消失）。
 * 4. 刪除標籤時若已被使用，不可直接實體刪除 —— disableTag() 只會停用，
 *    「刪除」在這裡的實作就是「停用」，資料庫層面完全沒有提供硬刪除
 *    DevoteeTag 的函式；DevoteeTagAssignment.tag 的外鍵也設成 onDelete:
 *    Restrict（見 schema.prisma），就算有人想繞過這支函式直接刪資料庫
 *    列，只要還有信眾在使用，資料庫本身就會拒絕。
 * 5. 所有標籤異動需記錄操作者與時間 —— 每個異動函式都呼叫 recordVersion()。
 */

export async function listDevoteeTags(includeInactive = true) {
  return prisma.devoteeTag.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function createDevoteeTag(name: string, operatorName: string, note?: string | null) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("標籤名稱不得為空");

  const existing = await prisma.devoteeTag.findUnique({ where: { name: trimmed } });
  if (existing) throw new Error(`標籤「${trimmed}」已經存在`);

  const tag = await prisma.devoteeTag.create({
    data: { name: trimmed, note: note ?? null, isSystemDefault: false },
  });

  await recordVersion({
    entityType: "DevoteeTag",
    entityId: tag.id,
    action: "CREATE",
    afterData: toJsonSnapshot(tag),
    operatorName,
    changeNote: `新增自訂標籤「${trimmed}」`,
  });

  return tag;
}

export async function renameDevoteeTag(tagId: string, newName: string, operatorName: string) {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error("標籤名稱不得為空");

  const before = await prisma.devoteeTag.findUnique({ where: { id: tagId } });
  if (!before) throw new Error("找不到這個標籤");

  const duplicate = await prisma.devoteeTag.findUnique({ where: { name: trimmed } });
  if (duplicate && duplicate.id !== tagId) throw new Error(`標籤「${trimmed}」已經存在`);

  const after = await prisma.devoteeTag.update({ where: { id: tagId }, data: { name: trimmed } });

  await recordVersion({
    entityType: "DevoteeTag",
    entityId: tagId,
    action: "UPDATE",
    beforeData: toJsonSnapshot(before),
    afterData: toJsonSnapshot(after),
    operatorName,
    changeNote: `修改標籤名稱：「${before.name}」→「${trimmed}」`,
  });

  return after;
}

/** 停用標籤（對應「刪除標籤」的實際行為，見上方說明第 4 點）。 */
export async function setDevoteeTagActive(tagId: string, isActive: boolean, operatorName: string) {
  const before = await prisma.devoteeTag.findUnique({ where: { id: tagId } });
  if (!before) throw new Error("找不到這個標籤");

  const after = await prisma.devoteeTag.update({ where: { id: tagId }, data: { isActive } });

  await recordVersion({
    entityType: "DevoteeTag",
    entityId: tagId,
    action: "UPDATE",
    beforeData: toJsonSnapshot(before),
    afterData: toJsonSnapshot(after),
    operatorName,
    changeNote: isActive ? `恢復啟用標籤「${before.name}」` : `停用標籤「${before.name}」`,
  });

  return after;
}

/** 套用標籤到信眾身上（對應指令「八」）。已套用過同一標籤時回傳既有的套用紀錄，不視為錯誤（冪等）。 */
export async function applyDevoteeTag(memberId: string, tagId: string, operatorName: string) {
  const tag = await prisma.devoteeTag.findUnique({ where: { id: tagId } });
  if (!tag) throw new Error("找不到這個標籤");
  if (!tag.isActive) throw new Error(`標籤「${tag.name}」已停用，無法套用到新的信眾身上`);

  const profile = await getOrCreateDevoteeProfile(memberId);

  const existing = await prisma.devoteeTagAssignment.findUnique({
    where: { devoteeProfileId_tagId: { devoteeProfileId: profile.id, tagId } },
  });
  if (existing) return existing; // 同一標籤不得重複套用——已經套用過，直接回傳既有紀錄，不重複寫入

  const assignment = await prisma.devoteeTagAssignment.create({
    data: { devoteeProfileId: profile.id, tagId, assignedByName: operatorName },
  });

  await recordVersion({
    entityType: "DevoteeTagAssignment",
    entityId: assignment.id,
    action: "CREATE",
    afterData: toJsonSnapshot(assignment),
    operatorName,
    changeNote: `套用標籤「${tag.name}」到信眾（${memberId}）`,
  });

  return assignment;
}

/** 移除信眾身上的標籤。 */
export async function removeDevoteeTag(memberId: string, tagId: string, operatorName: string) {
  const profile = await prisma.devoteeProfile.findUnique({ where: { memberId } });
  if (!profile) return; // 沒有延伸資料，代表這位信眾本來就沒有任何標籤，視為成功（冪等）

  const assignment = await prisma.devoteeTagAssignment.findUnique({
    where: { devoteeProfileId_tagId: { devoteeProfileId: profile.id, tagId } },
    include: { tag: true },
  });
  if (!assignment) return;

  await prisma.devoteeTagAssignment.delete({ where: { id: assignment.id } });

  await recordVersion({
    entityType: "DevoteeTagAssignment",
    entityId: assignment.id,
    action: "DELETE",
    beforeData: toJsonSnapshot(assignment),
    operatorName,
    changeNote: `移除信眾（${memberId}）身上的標籤「${assignment.tag.name}」`,
  });
}

/** 取得某位信眾目前的標籤清單（含已停用但仍套用中的標籤，畫面可自行決定是否標示「已停用」）。 */
export async function getDevoteeTagsForMember(memberId: string) {
  const profile = await prisma.devoteeProfile.findUnique({ where: { memberId } });
  if (!profile) return [];
  const assignments = await prisma.devoteeTagAssignment.findMany({
    where: { devoteeProfileId: profile.id },
    include: { tag: true },
    orderBy: { createdAt: "asc" },
  });
  return assignments.map((a) => ({
    assignmentId: a.id,
    tagId: a.tagId,
    name: a.tag.name,
    isActive: a.tag.isActive,
    assignedByName: a.assignedByName,
    assignedAt: a.createdAt,
  }));
}
