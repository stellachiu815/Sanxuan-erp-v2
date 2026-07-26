import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * V15R5.3 全家燈永久資料共用架構 Phase 2（只實作全家燈）。
 *
 * 永久主資料沿用既有 Household／Member 關聯與狀態（不另建永久名單）；每一年度報名時，於同一交易內
 * 建立**不可變年度快照**（FamilyLanternRegistration＋FamilyLanternMember）：保存當年度實際納入成員、
 * 家戶地址、戶主/主要聯絡人。日後永久資料變動不改寫舊年度。前端送來的名單/姓名/地址一律不信任，
 * 伺服器重查後才寫入。只處理全家燈，不觸及其他活動、收款、收據、對帳、列印、財務。
 */

/**
 * 全家燈驗證失敗時丟出的錯誤（帶 HTTP 狀態碼）。**在交易內丟出可保證整筆 rollback**
 * （Prisma 只在 throw 時回滾；callback 正常 return 會 commit）。呼叫端交易外的 catch
 * 會將它轉成 { ok:false, status, error }。
 */
export class FamilyLanternError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "FamilyLanternError";
    this.status = status;
  }
}

export type FamilyContactSource = "HEAD" | "PRIMARY" | "CONTACT_NAME" | "UNSET";

export type FamilyEligibleMember = {
  id: string;
  name: string;
  role: string;
  isPrimaryContact: boolean;
};

/**
 * 全家燈「可納入成員」資格——沿用專案既有欄位，不發明第二套狀態：
 *   屬選定家戶、isDeceased!==true（未辭世）、deletedAt===null（未刪除/未封存）。
 * （專案 Member 的失效狀態即 deletedAt 軟刪；無其他 archivedAt/status 欄位。）
 */
export function familyEligibleMemberWhere(householdId: string): Prisma.MemberWhereInput {
  return { householdId, isDeceased: false, deletedAt: null };
}

/** 伺服器端重查合格成員（穩定排序：主要聯絡人優先、其次建立序）。 */
export async function loadFamilyEligibleMembers(
  householdId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<FamilyEligibleMember[]> {
  return client.member.findMany({
    where: familyEligibleMemberWhere(householdId),
    orderBy: [{ isPrimaryContact: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, role: true, isPrimaryContact: true },
  });
}

/**
 * 戶主/主要聯絡人快照來源，只在「有效成員」中挑（辭世/封存/刪除/不屬本戶者不得選）：
 *   1. role = HOUSEHOLD_HEAD  2. isPrimaryContact = true  3. Household.contactName  4. 無資料
 * 無資料時回 { name: null, source: "UNSET" }；**不把「尚未設定」字樣存入 DB**，由畫面顯示時才轉。
 */
export function resolveFamilyContact(
  eligible: FamilyEligibleMember[],
  householdContactName: string | null
): { name: string | null; source: FamilyContactSource } {
  const head = eligible.find((m) => m.role === "HOUSEHOLD_HEAD");
  if (head) return { name: head.name, source: "HEAD" };
  const primary = eligible.find((m) => m.isPrimaryContact);
  if (primary) return { name: primary.name, source: "PRIMARY" };
  const cn = (householdContactName ?? "").trim();
  if (cn) return { name: cn, source: "CONTACT_NAME" };
  return { name: null, source: "UNSET" };
}

export type FamilyLanternResolved = {
  household: { id: string; address: string | null; contactName: string | null };
  eligible: FamilyEligibleMember[];
  requested: string[];
  contact: { name: string | null; source: FamilyContactSource };
};

/**
 * **在建立任何 item / 快照之前** 驗證全家燈納入名單合法性（必須在同一交易內先呼叫）：
 *  1. 伺服器重查 Household（未刪除）。
 *  2. 伺服器重查合格成員（在世＋未刪除；不信任前端）。
 *  3. 前端送來的 memberIds 必須全部屬本戶且合格；至少一位。
 *  4. 解析地址／戶主快照來源。
 * 任一不合法即 **throw FamilyLanternError**（帶狀態碼）→ 整筆交易 rollback，
 * **不會留下任何 RitualRegistrationItem / FamilyLanternRegistration / FamilyLanternMember**。
 */
export async function assertFamilyLanternInclusion(
  tx: Prisma.TransactionClient,
  params: { householdId: string; includedMemberIds: string[] }
): Promise<FamilyLanternResolved> {
  const household = await tx.household.findFirst({
    where: { id: params.householdId, deletedAt: null },
    select: { id: true, address: true, contactName: true },
  });
  if (!household) throw new FamilyLanternError(404, "找不到家戶或家戶已刪除，無法建立全家燈");

  const eligible = await loadFamilyEligibleMembers(params.householdId, tx);
  const eligibleIds = new Set(eligible.map((m) => m.id));
  const requested = [...new Set((params.includedMemberIds ?? []).filter(Boolean))];
  const invalid = requested.filter((id) => !eligibleIds.has(id));
  if (invalid.length > 0) {
    throw new FamilyLanternError(400, "全家燈納入名單含不符資格（非本戶／已辭世／已刪除）的成員，請重新整理後再送出");
  }
  if (requested.length === 0) {
    throw new FamilyLanternError(400, "全家燈至少需納入一位有效成員");
  }

  const contact = resolveFamilyContact(eligible, household.contactName);
  return { household: { id: household.id, address: household.address, contactName: household.contactName }, eligible, requested, contact };
}

/**
 * 用**已驗證**的資料（assertFamilyLanternInclusion 回傳）建立/更新全家燈年度快照。
 * 依 ritualRegistrationItemId(@unique) 找既有：有則更新該筆（重報同年度＝更新，不建第二筆）、重建成員快照；
 * 無則建立。DB 另有 @@unique([ritualRecordId, householdId]) 保證同 record+戶唯一。本函式不再做驗證
 *（驗證已在 create item 之前由 assertFamilyLanternInclusion 完成）。
 */
export async function writeFamilyLanternSnapshotInTx(
  tx: Prisma.TransactionClient,
  params: {
    ritualRegistrationItemId: string;
    ritualRecordId: string;
    householdId: string;
    year: number;
    resolved: FamilyLanternResolved;
    operatorUserId?: string | null;
    operatorName?: string | null;
  }
): Promise<void> {
  const { household, eligible, requested, contact } = params.resolved;
  const nameById = new Map(eligible.map((m) => [m.id, m.name]));

  const existing = await tx.familyLanternRegistration.findUnique({
    where: { ritualRegistrationItemId: params.ritualRegistrationItemId },
    select: { id: true },
  });

  let regId: string;
  if (existing) {
    await tx.familyLanternRegistration.update({
      where: { id: existing.id },
      data: {
        ritualRecordId: params.ritualRecordId,
        householdId: params.householdId,
        year: params.year,
        addressSnapshot: household.address ?? null,
        contactNameSnapshot: contact.name,
        contactSourceSnapshot: contact.source,
      },
    });
    regId = existing.id;
    await tx.familyLanternMember.deleteMany({ where: { familyLanternRegistrationId: regId } });
  } else {
    const created = await tx.familyLanternRegistration.create({
      data: {
        ritualRegistrationItemId: params.ritualRegistrationItemId,
        ritualRecordId: params.ritualRecordId,
        householdId: params.householdId,
        year: params.year,
        addressSnapshot: household.address ?? null,
        contactNameSnapshot: contact.name,
        contactSourceSnapshot: contact.source,
        createdByUserId: params.operatorUserId ?? null,
        createdByNameSnapshot: params.operatorName ?? null,
      },
      select: { id: true },
    });
    regId = created.id;
  }

  await tx.familyLanternMember.createMany({
    data: requested.map((id) => ({
      familyLanternRegistrationId: regId,
      memberId: id,
      memberNameSnapshot: nameById.get(id) ?? "",
    })),
    skipDuplicates: true,
  });
}
