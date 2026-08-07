import { prisma } from "@/lib/prisma";

/**
 * V38 贊普認購人「查詢 ＋ 一鍵還原」。
 *
 * 背景：舊版贊普是「一戶只留一筆」，同戶報第二筆（不同認購人）時會把前一筆蓋掉／軟刪除，
 *   造成認購人「消失」。此工具把某年度、符合關鍵字（認購人名／成員名／戶名／戶號）的
 *   **所有**贊普／隨喜贊普列出來——含已取消（CANCELLED）與已軟刪除（deletedAt）——
 *   讓人工判斷哪些是被系統誤刪、可一鍵還原。
 *
 * 注意：若當初是「同一筆一直被改名」（update 覆蓋），舊名字沒有留存、無法還原；
 *   只有「另存成新列後被取消／軟刪除」的才救得回（restorable=true）。
 */

const SPONSOR_KEYS = ["US_SPONSOR", "US_SPONSOR_DONATION"] as const;

export type SponsorAuditRow = {
  itemId: string;
  key: string;
  label: string;
  buyerName: string | null; // 認購人（customName）優先，否則成員姓名
  householdCode: string | null;
  householdName: string | null;
  quantity: number;
  amountDue: number;
  amountPaid: number;
  status: string;
  isDeleted: boolean;
  deletedByName: string | null;
  createdAt: string;
  restorable: boolean; // 被取消／軟刪除且未收款 → 可還原
};

export type SponsorAuditReport = { ok: boolean; query: string; year: number; total: number; rows: SponsorAuditRow[] };

const LABEL: Record<string, string> = { US_SPONSOR: "贊普", US_SPONSOR_DONATION: "隨喜贊普" };

export async function auditSponsorItems(year: number, query: string): Promise<SponsorAuditReport> {
  const q = (query ?? "").trim();
  const items = await prisma.ritualRegistrationItem.findMany({
    where: {
      registrationItemType: { key: { in: [...SPONSOR_KEYS] } },
      ritualRecord: { year, activityType: "UNIVERSAL_SALVATION" },
      ...(q
        ? {
            OR: [
              { customName: { contains: q } },
              { member: { name: { contains: q } } },
              { ritualRecord: { household: { name: { contains: q } } } },
              { ritualRecord: { household: { id: { contains: q } } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      quantity: true,
      amountDue: true,
      amountPaid: true,
      status: true,
      deletedAt: true,
      deletedByName: true,
      createdAt: true,
      customName: true,
      registrationItemType: { select: { key: true } },
      member: { select: { name: true } },
      ritualRecord: { select: { household: { select: { id: true, name: true } } } },
    },
    orderBy: [{ customName: "asc" }, { createdAt: "asc" }],
  });

  const rows: SponsorAuditRow[] = items.map((it) => {
    const isDeleted = !!it.deletedAt;
    const isCancelled = it.status === "CANCELLED";
    const paid = Number(it.amountPaid);
    return {
      itemId: it.id,
      key: it.registrationItemType.key,
      label: LABEL[it.registrationItemType.key] ?? it.registrationItemType.key,
      buyerName: it.customName ?? it.member?.name ?? null,
      householdCode: it.ritualRecord?.household?.id ?? null,
      householdName: it.ritualRecord?.household?.name ?? null,
      quantity: it.quantity,
      amountDue: Number(it.amountDue),
      amountPaid: paid,
      status: it.status,
      isDeleted,
      deletedByName: it.deletedByName,
      createdAt: it.createdAt.toISOString(),
      // 已取消或已軟刪除、且未收款 → 可安全還原。
      restorable: (isDeleted || isCancelled) && paid === 0,
    };
  });

  return { ok: true, query: q, year, total: rows.length, rows };
}

/**
 * 一鍵還原一筆被系統取消／軟刪除的贊普：狀態轉正式（CONFIRMED）、清 deletedAt、
 * 重算未收金額（應收 − 已收）。已收款者不動（本來就在名單上）。
 */
export async function restoreSponsorItem(
  itemId: string,
  operatorName: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const it = await prisma.ritualRegistrationItem.findUnique({
    where: { id: itemId },
    select: {
      id: true, status: true, deletedAt: true, amountDue: true, amountPaid: true,
      registrationItemType: { select: { key: true } },
    },
  });
  if (!it) return { ok: false, error: "找不到這筆贊普項目" };
  if (!SPONSOR_KEYS.includes(it.registrationItemType.key as (typeof SPONSOR_KEYS)[number])) {
    return { ok: false, error: "這筆不是贊普／隨喜贊普" };
  }
  if (!it.deletedAt && it.status !== "CANCELLED") return { ok: false, error: "這筆目前是有效的，不需還原" };
  const unpaid = Math.max(0, Number(it.amountDue) - Number(it.amountPaid));
  await prisma.ritualRegistrationItem.update({
    where: { id: itemId },
    data: {
      status: "CONFIRMED",
      deletedAt: null,
      deletedByName: null,
      amountUnpaid: unpaid,
    },
  });
  void operatorName;
  return { ok: true };
}
