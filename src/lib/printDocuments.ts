import { prisma } from "@/lib/prisma";

/**
 * V14：列印管理－報名總名單（roster）查詢。
 *
 * 「一鍵列印某項目的報名總名單」（指令一.6）：把某個報名項目在某年度、
 * 所有家戶的報名彙整成一份名單，供列印／補印。只列 CONFIRMED（草稿不列印，
 * 沿用 V13.4 指令七）。
 *
 * ⚠️ 沿用既有列印中心概念，不建第二套列印資料表；名單資料來自
 * ritual_registration_items（項目層）＋既有 RitualRecord／Household／Participant。
 */

export type RosterRow = {
  registrationItemId: string;
  householdId: string;
  householdName: string;
  memberName: string | null;
  itemName: string;
  quantity: number;
  amountDue: number;
  amountPaid: number;
  amountUnpaid: number;
  status: string;
};

export type RosterResult = {
  itemKey: string;
  itemName: string;
  activityGroupName: string;
  year: number;
  printDocumentKeys: string[];
  rows: RosterRow[];
  totalQuantity: number;
  totalAmountDue: number;
};

/**
 * 產生某報名項目某年度的報名總名單。
 * @param itemKey RegistrationItemType.key（例如 US_SPONSOR / CELEBRATION_TURTLE）
 * @param year 民國年
 * @param includeDraft 預設 false（只列已確認）。列印一律 false。
 */
export async function buildItemRoster(
  itemKey: string,
  year: number,
  includeDraft = false
): Promise<RosterResult | null> {
  const itemType = await prisma.registrationItemType.findUnique({ where: { key: itemKey } });
  if (!itemType) return null;

  const rows = await prisma.ritualRegistrationItem.findMany({
    where: {
      deletedAt: null,
      // 只列已確認的項目（草稿與已取消不列印）。即使主報名已確認，之後新增
      // 尚未確認的項目也不列入總名單（指令八：總名單只列 CONFIRMED）。
      ...(includeDraft ? {} : { status: "CONFIRMED" }),
      registrationItemType: { key: itemKey },
      ritualRecord: {
        deletedAt: null,
        year,
        ...(includeDraft ? {} : { status: "CONFIRMED" }),
      },
    },
    include: {
      member: { select: { name: true } },
      ritualRecord: { include: { household: { select: { id: true, name: true } } } },
    },
    orderBy: [{ ritualRecord: { household: { name: "asc" } } }, { createdAt: "asc" }],
  });

  const rosterRows: RosterRow[] = rows.map((r) => ({
    registrationItemId: r.id,
    householdId: r.ritualRecord.household.id,
    householdName: r.ritualRecord.household.name,
    memberName: r.member?.name ?? null,
    itemName: r.customName ?? itemType.name,
    quantity: r.quantity,
    amountDue: Number(r.amountDue),
    amountPaid: Number(r.amountPaid),
    amountUnpaid: Number(r.amountUnpaid),
    status: r.status,
  }));

  return {
    itemKey: itemType.key,
    itemName: itemType.name,
    activityGroupName: itemType.activityGroupName,
    year,
    printDocumentKeys: itemType.printDocumentKeys,
    rows: rosterRows,
    totalQuantity: rosterRows.reduce((s, r) => s + r.quantity, 0),
    totalAmountDue: rosterRows.reduce((s, r) => s + r.amountDue, 0),
  };
}

export type ActivityItemPrintSummary = {
  itemKey: string;
  itemName: string;
  activityGroup: string;
  activityGroupName: string;
  year: number;
  confirmedCount: number;
  printedCount: number;
  unprintedCount: number;
  printDocumentKeys: string[];
};

/**
 * 列印管理中央入口：某年度所有報名項目的列印彙總。
 * 依主活動、項目分組，顯示已確認人數／已列印／未列印。
 *
 * 一次查詢＋記憶體彙總（無 N+1；只列 CONFIRMED，草稿與取消不計）。
 */
export async function listActivityItemPrintSummary(year: number): Promise<ActivityItemPrintSummary[]> {
  const [itemTypes, items] = await Promise.all([
    prisma.registrationItemType.findMany({
      where: { isActive: true },
      orderBy: [{ activityGroup: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.ritualRegistrationItem.findMany({
      where: {
        deletedAt: null,
        status: "CONFIRMED",
        ritualRecord: { deletedAt: null, status: "CONFIRMED", year },
      },
      select: { registrationItemTypeId: true, printedAt: true },
    }),
  ]);

  const stat = new Map<string, { confirmed: number; printed: number }>();
  for (const it of items) {
    const s = stat.get(it.registrationItemTypeId) ?? { confirmed: 0, printed: 0 };
    s.confirmed += 1;
    if (it.printedAt) s.printed += 1;
    stat.set(it.registrationItemTypeId, s);
  }

  return itemTypes.map((t) => {
    const s = stat.get(t.id) ?? { confirmed: 0, printed: 0 };
    return {
      itemKey: t.key,
      itemName: t.name,
      activityGroup: t.activityGroup,
      activityGroupName: t.activityGroupName,
      year,
      confirmedCount: s.confirmed,
      printedCount: s.printed,
      unprintedCount: s.confirmed - s.printed,
      printDocumentKeys: t.printDocumentKeys,
    };
  });
}

/**
 * 標記某項目某年度的（已確認）報名為「已列印」。
 * 第一次列印設 printedAt；補印只增加 printCount。
 *
 * ⚠️ 完全不觸碰 amountDue／amountPaid／amountUnpaid（指令八：補印不改收款狀態）。
 */
export async function markRosterPrinted(
  itemKey: string,
  year: number
): Promise<{ ok: true; printed: number } | { ok: false; status: number; error: string }> {
  const itemType = await prisma.registrationItemType.findUnique({ where: { key: itemKey }, select: { id: true } });
  if (!itemType) return { ok: false, status: 404, error: "找不到這個報名項目" };

  const targets = await prisma.ritualRegistrationItem.findMany({
    where: {
      deletedAt: null,
      status: "CONFIRMED",
      registrationItemTypeId: itemType.id,
      ritualRecord: { deletedAt: null, status: "CONFIRMED", year },
    },
    select: { id: true, printedAt: true },
  });
  if (targets.length === 0) return { ok: true, printed: 0 };

  const now = new Date();
  await prisma.$transaction(
    targets.map((t) =>
      prisma.ritualRegistrationItem.update({
        where: { id: t.id },
        data: {
          printCount: { increment: 1 },
          ...(t.printedAt ? {} : { printedAt: now }),
        },
      })
    )
  );
  return { ok: true, printed: targets.length };
}
