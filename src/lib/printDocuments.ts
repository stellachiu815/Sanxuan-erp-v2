import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { normalizeTabletText } from "@/lib/tabletIdentity";

/**
 * V15R8：列印中心「資料來源」中文標籤（供顯示與篩選）。
 * 五種正式來源：信眾頁／家戶／活動頁／Excel 匯入／沿用去年。
 */
export const REGISTRATION_SOURCE_LABEL: Record<string, string> = {
  DEVOTEE_PAGE: "信眾頁報名",
  HOUSEHOLD_PAGE: "家戶報名",
  ACTIVITY_PAGE: "活動頁報名",
  EXCEL_IMPORT: "Excel 匯入",
  CARRY_OVER: "沿用去年",
};

export type PrintCenterFilters = {
  year: number;
  /** 報名項目 key（US_ANCESTOR…；空＝全部項目）。 */
  itemKey?: string | null;
  /** 資料來源（registrationSource；空＝全部來源）。 */
  source?: string | null;
  /** 列印狀態：ALL／UNPRINTED（printCount=0）／PRINTED（printCount>0）。 */
  printStatus?: "ALL" | "UNPRINTED" | "PRINTED" | null;
  /** 搜尋：家戶／信眾／牌位姓名／陽上人／地址（子字串，跨欄位）。 */
  q?: string | null;
};

export type PrintCenterRow = {
  registrationItemId: string;
  year: number;
  itemKey: string;
  itemName: string;
  householdId: string;
  householdName: string;
  memberName: string | null;
  tabletName: string | null;
  yangshangNames: string[];
  tabletAddress: string | null;
  source: string;
  sourceLabel: string;
  quantity: number;
  printCount: number;
  /** 首次列印時間（printedAt，首次後不覆蓋）。 */
  firstPrintedAt: string | null;
  /** 最後列印時間（lastPrintedAt；舊資料後備為 printedAt）。 */
  lastPrintedAt: string | null;
  lastPrintedByName: string | null;
};

/**
 * V15R8 列印中心唯一入口：**所有來源**（手動/信眾頁/家戶多人/活動頁/Excel 匯入/沿用去年）
 * 建立的都是 RitualRegistrationItem，故一律由此彙整。**只列正式可列印資料**：
 * status=CONFIRMED、主報名 CONFIRMED、未刪除（沿用既有 buildItemRoster 正式規則）——
 * Excel 匯入草稿須先經報名確認流程（DRAFT→CONFIRMED）才會出現，不繞過確認。
 *
 * year/itemKey/source/printStatus 在 DB 過濾；q（含陽上人陣列子字串）在年度範圍內以 JS 過濾。
 * 不寫入任何資料。
 */
export async function listPrintCenterItems(f: PrintCenterFilters): Promise<PrintCenterRow[]> {
  const rows = await prisma.ritualRegistrationItem.findMany({
    where: {
      deletedAt: null,
      status: "CONFIRMED",
      ...(f.itemKey ? { registrationItemType: { key: f.itemKey } } : {}),
      ...(f.printStatus === "UNPRINTED" ? { printCount: 0 } : f.printStatus === "PRINTED" ? { printCount: { gt: 0 } } : {}),
      ritualRecord: {
        deletedAt: null,
        status: "CONFIRMED",
        year: f.year,
        ...(f.source ? { registrationSource: f.source } : {}),
      },
    },
    include: {
      member: { select: { name: true } },
      registrationItemType: { select: { key: true, name: true } },
      universalSalvationEntry: { select: { displayName: true, yangshangNames: true, yangshangName: true, tabletAddress: true } },
      ritualRecord: { select: { year: true, registrationSource: true, household: { select: { id: true, name: true } } } },
    },
    orderBy: [{ ritualRecord: { household: { name: "asc" } } }, { createdAt: "asc" }],
  });

  const mapped: PrintCenterRow[] = rows.map((r) => {
    const ext = r as unknown as { lastPrintedAt: Date | null; printedByName: string | null };
    const entry = r.universalSalvationEntry;
    const yang = entry?.yangshangNames?.length ? entry.yangshangNames : entry?.yangshangName ? [entry.yangshangName] : [];
    const source = r.ritualRecord.registrationSource ?? "";
    return {
      registrationItemId: r.id,
      year: r.ritualRecord.year,
      itemKey: r.registrationItemType.key,
      itemName: r.registrationItemType.name,
      householdId: r.ritualRecord.household.id,
      householdName: r.ritualRecord.household.name,
      memberName: r.member?.name ?? null,
      tabletName: entry?.displayName ?? r.customName ?? null,
      yangshangNames: yang,
      tabletAddress: entry?.tabletAddress ?? null,
      source,
      sourceLabel: REGISTRATION_SOURCE_LABEL[source] ?? source,
      quantity: r.quantity,
      printCount: r.printCount,
      firstPrintedAt: r.printedAt ? r.printedAt.toISOString() : null,
      lastPrintedAt: ext.lastPrintedAt ? ext.lastPrintedAt.toISOString() : (r.printedAt ? r.printedAt.toISOString() : null),
      lastPrintedByName: ext.printedByName ?? null,
    };
  });

  const q = (f.q ?? "").trim();
  if (!q) return mapped;
  const nq = normalizeTabletText(q);
  const hit = (s: string | null | undefined) => normalizeTabletText(s).includes(nq);
  return mapped.filter(
    (r) => hit(r.householdName) || hit(r.memberName) || hit(r.tabletName) || hit(r.tabletAddress) || r.yangshangNames.some((y) => hit(y))
  );
}

/** 依目前篩選解析出「可列印」的項目 id（供「全部列印」——只套用目前條件，不誤印其他資料）。 */
export async function resolvePrintableItemIds(f: PrintCenterFilters): Promise<string[]> {
  return (await listPrintCenterItems(f)).map((r) => r.registrationItemId);
}

/**
 * V15R8：對指定的報名項目執行列印／補印（單筆／勾選批次／全部皆走此函式）。
 * 語意：printCount++；首次才設 printedAt（首次後不覆蓋）；每次都更新 lastPrintedAt 與操作人。
 * **不新增第二筆報名、不改金額、不改收款、不改報名狀態**。只處理 CONFIRMED、未刪除項目。
 */
export async function printRegistrationItems(
  ids: string[],
  operator: { id: string; name: string }
): Promise<{ ok: true; printed: number } | { ok: false; status: number; error: string }> {
  const unique = [...new Set(ids)].filter((x) => !!x);
  if (unique.length === 0) return { ok: true, printed: 0 };
  const targets = await prisma.ritualRegistrationItem.findMany({
    where: { id: { in: unique }, deletedAt: null, status: "CONFIRMED", ritualRecord: { deletedAt: null, status: "CONFIRMED" } },
    select: { id: true, printedAt: true },
  });
  if (targets.length === 0) return { ok: true, printed: 0 };
  const now = new Date();
  await prisma.$transaction(
    targets.map((t) =>
      prisma.ritualRegistrationItem.update({
        where: { id: t.id },
        data: ({
          printCount: { increment: 1 },
          lastPrintedAt: now,
          printedByUserId: operator.id,
          printedByName: operator.name,
          ...(t.printedAt ? {} : { printedAt: now }),
        } as unknown as Prisma.RitualRegistrationItemUncheckedUpdateInput),
      })
    )
  );
  return { ok: true, printed: targets.length };
}

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
