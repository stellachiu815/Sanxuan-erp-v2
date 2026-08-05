import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { normalizeTabletText } from "@/lib/tabletIdentity";
import { printNumberOf } from "@/lib/workOrder";
import { listPrintItemsForPrintCenter } from "@/lib/additionalPrintItems";
import { printObjectCountsByItemKey } from "@/lib/TabletBatchService";

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
  /** V30.3 普渡報名順序（各活動×項目各自 1 起；未補號為 null）。名單／總表／列印一律以此排序、顯示。 */
  registrationOrder: number | null;
  year: number;
  itemKey: string;
  itemName: string;
  /** 列印物件型別（TABLET／POCKET／RICE／SPONSOR／PURIFICATION…）供 UI 決定正式列印版面路由。 */
  contentKind: string;
  /** 承載此報名的 TempleEvent id（祭改正式列印頁 /purification/[eventId]/print 需用；其餘型別可為 null）。 */
  templeEventId: string | null;
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
/**
 * V36.11：普渡列印物件（牌位四類＋寶袋）的報名項目 key，一律以 listPrintItemsForPrintCenter()
 * 為唯一有效資料集合（含 DRAFT、排除封存/取消），**不再**用 CONFIRMED-only 舊查詢，避免篩選祖先／
 * 乙位／冤親／無緣／寶袋時因多為 DRAFT 而顯示 0。白米／贊普等非列印物件維持既有 CONFIRMED 查詢。
 */
const US_PRINTOBJECT_KEYS = new Set(["US_ANCESTOR", "US_ZHENGHUN", "US_YUANQIN", "US_WUYUAN", "US_POCKET_EXTRA"]);
const US_CATEGORY_TO_ITEMKEY: Record<string, string> = {
  ANCESTOR_LINE: "US_ANCESTOR",
  INDIVIDUAL_SOUL: "US_ZHENGHUN",
  DEBT_CREDITOR: "US_YUANQIN",
  UNBORN_CHILD: "US_WUYUAN",
};

/** V36.11：把 listPrintItemsForPrintCenter 的列印物件視圖轉為列印中心報名名單列（普渡專用；唯一來源）。 */
async function listUniversalSalvationPrintObjectRows(f: PrintCenterFilters): Promise<PrintCenterRow[]> {
  const views = await listPrintItemsForPrintCenter(f.year, {});
  const selected = views.filter((v) => {
    const key = v.itemType === "POCKET" ? "US_POCKET_EXTRA" : US_CATEGORY_TO_ITEMKEY[v.sourceCategory];
    if (!key) return false;
    return f.itemKey ? key === f.itemKey : true;
  });
  if (selected.length === 0) return [];

  // 報名項目正式名稱（key→name），一次取回。
  const nameByKey = new Map(
    (await prisma.registrationItemType.findMany({ where: { key: { in: [...US_PRINTOBJECT_KEYS] } }, select: { key: true, name: true } }))
      .map((t) => [t.key, t.name])
  );
  // 資料來源／承載活動：以家戶今年普渡 record 取 registrationSource／templeEventId（供來源篩選＋預覽路由）。
  const householdIds = [...new Set(selected.map((v) => v.household.id))];
  const recRows = householdIds.length
    ? await prisma.ritualRecord.findMany({
        where: { householdId: { in: householdIds }, year: f.year, activityType: "UNIVERSAL_SALVATION", deletedAt: null },
        select: { householdId: true, registrationSource: true, templeEventId: true },
      })
    : [];
  const recByHh = new Map(recRows.map((r) => [r.householdId, r]));

  const rows: PrintCenterRow[] = selected.map((v) => {
    const key = v.itemType === "POCKET" ? "US_POCKET_EXTRA" : US_CATEGORY_TO_ITEMKEY[v.sourceCategory];
    const rec = recByHh.get(v.household.id);
    const source = rec?.registrationSource ?? "";
    return {
      // 本名單以「列印物件」為準（與 V34／buildItemRoster 同一集合）；id＝列印物件 id。
      registrationItemId: v.id,
      registrationOrder: v.registrationOrder,
      year: f.year,
      itemKey: key,
      itemName: nameByKey.get(key) ?? key,
      contentKind: v.itemType,
      templeEventId: rec?.templeEventId ?? null,
      householdId: v.household.id,
      householdName: v.household.name,
      memberName: (v.sourceYangshangNames && v.sourceYangshangNames[0]) || null,
      // V36.14：寶袋顯示名——沿用來源牌位名稱的寶袋顯示「已補後綴」的完整名（蔡姓→蔡姓歷代祖先）；
      //   自訂名稱寶袋（如江士耀）顯示其自訂名。牌位則主文覆寫優先、否則完整顯示名。
      tabletName: v.itemType === "POCKET"
        ? (v.usesSourceName ? v.sourceDisplayName : v.printName)
        : (v.printMainText?.trim() || v.sourceDisplayName),
      yangshangNames: v.sourceYangshangNames ?? [],
      tabletAddress: v.sourceLocation ?? null,
      source,
      sourceLabel: REGISTRATION_SOURCE_LABEL[source] ?? source,
      quantity: v.quantity,
      printCount: v.printCount,
      firstPrintedAt: v.firstPrintedAt,
      lastPrintedAt: v.lastPrintedAt,
      lastPrintedByName: v.lastPrintedByName,
    };
  });

  // 篩選：資料來源、列印狀態（以列印物件 printCount 判定）。
  return rows.filter((r) => {
    if (f.source && r.source !== f.source) return false;
    if (f.printStatus === "UNPRINTED" && r.printCount !== 0) return false;
    if (f.printStatus === "PRINTED" && r.printCount <= 0) return false;
    return true;
  });
}

export async function listPrintCenterItems(f: PrintCenterFilters): Promise<PrintCenterRow[]> {
  // V36.11：普渡列印物件（祖先／乙位／冤親／無緣／寶袋）走唯一來源 listPrintItemsForPrintCenter；
  //   其餘（白米／贊普…）維持既有 CONFIRMED 查詢。itemKey 空＝兩者合併；itemKey 為列印物件則不查 CONFIRMED。
  const wantPrintObjects = !f.itemKey || US_PRINTOBJECT_KEYS.has(f.itemKey);
  const wantConfirmed = !f.itemKey || !US_PRINTOBJECT_KEYS.has(f.itemKey);
  const printObjectRows = wantPrintObjects ? await listUniversalSalvationPrintObjectRows(f) : [];

  const rows = wantConfirmed ? await prisma.ritualRegistrationItem.findMany({
    where: {
      deletedAt: null,
      status: "CONFIRMED",
      // itemKey 指定非列印物件 → 該 key；未指定 → 排除普渡列印物件 key（改由上方唯一來源提供，避免重複／CONFIRMED 漏 DRAFT）。
      ...(f.itemKey ? { registrationItemType: { key: f.itemKey } } : { registrationItemType: { key: { notIn: [...US_PRINTOBJECT_KEYS] } } }),
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
      registrationItemType: { select: { key: true, name: true, contentKind: true } },
      universalSalvationEntry: { select: { displayName: true, yangshangNames: true, yangshangName: true, tabletAddress: true } },
      ritualRecord: { select: { year: true, registrationSource: true, templeEventId: true, household: { select: { id: true, name: true } } } },
    },
    orderBy: [{ createdAt: "asc" }],
  }) : [];

  // V32：列印號＝printNumberOf(workOrder, registrationOrder)（workOrder 優先，NULL 回退）。名單/總表以此排序顯示。
  const rowIds = rows.map((r) => r.id);
  const orderRows = rowIds.length
    ? await prisma.$queryRaw<{ id: string; ro: number | null; wo: number | null }[]>`
        SELECT "id", "registrationOrder" AS ro, "workOrder" AS wo FROM "ritual_registration_items" WHERE "id" = ANY(${rowIds})
      `
    : [];
  const orderById = new Map(orderRows.map((o) => [o.id, printNumberOf(o.wo, o.ro)]));

  const mapped: PrintCenterRow[] = rows.map((r) => {
    const ext = r as unknown as { lastPrintedAt: Date | null; printedByName: string | null };
    const entry = r.universalSalvationEntry;
    const yang = entry?.yangshangNames?.length ? entry.yangshangNames : entry?.yangshangName ? [entry.yangshangName] : [];
    const source = r.ritualRecord.registrationSource ?? "";
    return {
      registrationItemId: r.id,
      registrationOrder: orderById.get(r.id) ?? null,
      year: r.ritualRecord.year,
      itemKey: r.registrationItemType.key,
      itemName: r.registrationItemType.name,
      contentKind: r.registrationItemType.contentKind,
      templeEventId: r.ritualRecord.templeEventId ?? null,
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

  // V36.11：普渡列印物件列（唯一來源）＋非列印物件 CONFIRMED 列，合併為單一名單。
  const combined = [...printObjectRows, ...mapped];

  // V30.3：每個報名項目（itemKey）各自依 registrationOrder 由小到大；未補號（null）排最後。
  combined.sort((a, b) => {
    if (a.itemKey !== b.itemKey) return a.itemKey < b.itemKey ? -1 : 1;
    const ao = a.registrationOrder;
    const bo = b.registrationOrder;
    if (ao == null && bo == null) return 0;
    if (ao == null) return 1;
    if (bo == null) return -1;
    return ao - bo;
  });

  const q = (f.q ?? "").trim();
  if (!q) return combined;
  const nq = normalizeTabletText(q);
  const hit = (s: string | null | undefined) => normalizeTabletText(s).includes(nq);
  return combined.filter(
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
  /** V30.3 普渡報名順序（本項目 1 起；未補號為 null → 顯示「—」）。名單一律以此排序、顯示。 */
  registrationOrder: number | null;
  householdId: string;
  householdName: string;
  memberName: string | null;
  itemName: string;
  quantity: number;
  /** V36.7B：金額一律讀既有 RRI，不重算；找不到對應 RRI（無 registrationItemId 連結）時為 null → 顯示「—」，不以 0 冒充。 */
  amountDue: number | null;
  amountPaid: number | null;
  amountUnpaid: number | null;
  status: string;
  /** V21 列印紀錄：首次列印時間／最後列印(補印)時間／列印次數／最後列印人員。 */
  printedAt: string | null;
  lastPrintedAt: string | null;
  printCount: number;
  printedByName: string | null;
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
/** V36.7：普渡牌位／寶袋名冊改由 V34 同一支查詢（列印物件）產生的 key。 */
const US_TABLET_ROSTER_KEYS = new Set(["US_ANCESTOR", "US_ZHENGHUN", "US_YUANQIN", "US_WUYUAN"]);
const US_CATEGORY_OF_KEY: Record<string, string> = {
  US_ANCESTOR: "ANCESTOR_LINE",
  US_ZHENGHUN: "INDIVIDUAL_SOUL",
  US_YUANQIN: "DEBT_CREDITOR",
  US_WUYUAN: "UNBORN_CHILD",
};

export async function buildItemRoster(
  itemKey: string,
  year: number,
  includeDraft = false
): Promise<RosterResult | null> {
  const itemType = await prisma.registrationItemType.findUnique({ where: { key: itemKey } });
  if (!itemType) return null;

  // ── V36.7：普渡牌位（祖先/乙位/冤親/無緣）與寶袋，一律沿用 V34 已驗證的**同一支** listPrintItemsForPrintCenter
  //   作為唯一名冊來源（不再以 RitualRegistrationItem.status='CONFIRMED' 為來源，故 DRAFT 也會列出、與 V34 一致）。
  //   金額欄位不在列印物件層（普渡收款於收款中心管理），此名冊金額顯示 0；名單/順序/內容/列印狀態與 V34 完全一致。
  const isUSPocket = itemKey === "US_POCKET_EXTRA";
  if (US_TABLET_ROSTER_KEYS.has(itemKey) || isUSPocket) {
    const cat = US_CATEGORY_OF_KEY[itemKey];
    const items = await listPrintItemsForPrintCenter(year, {});
    const filtered = items.filter((i) =>
      isUSPocket ? i.itemType === "POCKET" : i.itemType === "TABLET" && i.sourceCategory === cat
    );

    // V36.7B：金額裝飾——依每筆列印物件對應的既有 RRI，**一次批次**讀取 amountDue/Paid/Unpaid（不重算、不寫入、不 N+1）。
    //   牌位（TABLET）：對應 RRI＝ritual_registration_items.universalSalvationEntryId = sourceEntryId（1:1）。
    //   寶袋（POCKET）：對應 RRI＝該寶袋自身 additional_print_items.registrationItemId 指向的 US_POCKET_EXTRA。
    //   找不到對應 RRI → 金額 null（顯示「—」，不以 0 冒充）。基本寶袋其 RRI amountDue 本為 0（免費）＝真實金額。
    type Amt = { due: number; paid: number; unpaid: number };
    const amountByObjectId = new Map<string, Amt | null>();
    if (filtered.length > 0) {
      if (isUSPocket) {
        // 1) 讀每個寶袋列印物件自身的 registrationItemId。
        const apiIds = filtered.map((i) => i.id);
        const regRows = await prisma.$queryRaw<{ id: string; regId: string | null }[]>`
          SELECT "id", "registrationItemId" AS "regId" FROM "additional_print_items" WHERE "id" IN (${Prisma.join(apiIds)})`;
        const regByApi = new Map(regRows.map((r) => [r.id, r.regId]));
        // 2) 依這些 US_POCKET_EXTRA RRI id 批次取金額。
        const regIds = [...new Set(regRows.map((r) => r.regId).filter((x): x is string => !!x))];
        const rriRows = regIds.length
          ? await prisma.ritualRegistrationItem.findMany({
              where: { id: { in: regIds }, deletedAt: null },
              select: { id: true, amountDue: true, amountPaid: true, amountUnpaid: true },
            })
          : [];
        const rriById = new Map(rriRows.map((r) => [r.id, r]));
        for (const i of filtered) {
          const regId = regByApi.get(i.id) ?? null;
          const rri = regId ? rriById.get(regId) : null;
          amountByObjectId.set(i.id, rri ? { due: Number(rri.amountDue), paid: Number(rri.amountPaid), unpaid: Number(rri.amountUnpaid) } : null);
        }
      } else {
        // 牌位：以 universalSalvationEntryId 批次取其 1:1 RRI 金額。
        const entryIds = [...new Set(filtered.map((i) => i.sourceEntryId))];
        const rriRows = await prisma.ritualRegistrationItem.findMany({
          where: { universalSalvationEntryId: { in: entryIds }, deletedAt: null },
          select: { universalSalvationEntryId: true, amountDue: true, amountPaid: true, amountUnpaid: true },
        });
        const rriByEntry = new Map(rriRows.map((r) => [r.universalSalvationEntryId as string, r]));
        for (const i of filtered) {
          const rri = rriByEntry.get(i.sourceEntryId);
          amountByObjectId.set(i.id, rri ? { due: Number(rri.amountDue), paid: Number(rri.amountPaid), unpaid: Number(rri.amountUnpaid) } : null);
        }
      }
    }

    const usRows: RosterRow[] = filtered.map((i) => {
      const amt = amountByObjectId.get(i.id) ?? null;
      return {
        registrationItemId: i.id,
        registrationOrder: i.registrationOrder,
        householdId: i.household.id,
        householdName: i.household.name,
        memberName: (i.sourceYangshangNames && i.sourceYangshangNames[0]) || null,
        // 牌位：主文（printMainText 覆寫優先，否則 formatter 後的顯示名）；寶袋：其列印名稱（可為額外寶袋姓名）。
        itemName: isUSPocket ? i.printName : (i.printMainText?.trim() || i.sourceDisplayName),
        quantity: 1,
        amountDue: amt ? amt.due : null,
        amountPaid: amt ? amt.paid : null,
        amountUnpaid: amt ? amt.unpaid : null,
        status: i.status,
        printedAt: i.firstPrintedAt,
        lastPrintedAt: i.lastPrintedAt,
        printCount: i.printCount,
        printedByName: i.lastPrintedByName,
      };
    });
    usRows.sort((a, b) => {
      const ao = a.registrationOrder, bo = b.registrationOrder;
      if (ao == null && bo == null) return 0;
      if (ao == null) return 1;
      if (bo == null) return -1;
      return ao - bo;
    });
    return {
      itemKey: itemType.key,
      itemName: itemType.name,
      activityGroupName: itemType.activityGroupName,
      year,
      printDocumentKeys: itemType.printDocumentKeys,
      rows: usRows,
      totalQuantity: usRows.length,
      totalAmountDue: usRows.reduce((s, r) => s + (r.amountDue ?? 0), 0),
    };
  }

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
    orderBy: [{ createdAt: "asc" }],
  });

  // V32：列印號＝printNumberOf(workOrder, registrationOrder)。本 roster 為單一項目，各筆同型別。
  const rosterIds = rows.map((r) => r.id);
  const rosterOrderRows = rosterIds.length
    ? await prisma.$queryRaw<{ id: string; ro: number | null; wo: number | null }[]>`
        SELECT "id", "registrationOrder" AS ro, "workOrder" AS wo FROM "ritual_registration_items" WHERE "id" = ANY(${rosterIds})
      `
    : [];
  const rosterOrderById = new Map(rosterOrderRows.map((o) => [o.id, printNumberOf(o.wo, o.ro)]));

  const rosterRows: RosterRow[] = rows.map((r) => {
    const pr = r as unknown as { printedAt: Date | null; lastPrintedAt: Date | null; printCount: number | null; printedByName: string | null };
    return {
      registrationItemId: r.id,
      registrationOrder: rosterOrderById.get(r.id) ?? null,
      householdId: r.ritualRecord.household.id,
      householdName: r.ritualRecord.household.name,
      memberName: r.member?.name ?? null,
      itemName: r.customName ?? itemType.name,
      quantity: r.quantity,
      amountDue: Number(r.amountDue),
      amountPaid: Number(r.amountPaid),
      amountUnpaid: Number(r.amountUnpaid),
      status: r.status,
      printedAt: pr.printedAt ? pr.printedAt.toISOString() : null,
      lastPrintedAt: pr.lastPrintedAt ? pr.lastPrintedAt.toISOString() : null,
      printCount: pr.printCount ?? 0,
      printedByName: pr.printedByName ?? null,
    };
  });

  // V30.3：依 registrationOrder ASC（NULL 最後）；本 roster 單一項目故不需再分項目分組。
  rosterRows.sort((a, b) => {
    const ao = a.registrationOrder;
    const bo = b.registrationOrder;
    if (ao == null && bo == null) return 0;
    if (ao == null) return 1;
    if (bo == null) return -1;
    return ao - bo;
  });

  return {
    itemKey: itemType.key,
    itemName: itemType.name,
    activityGroupName: itemType.activityGroupName,
    year,
    printDocumentKeys: itemType.printDocumentKeys,
    rows: rosterRows,
    totalQuantity: rosterRows.reduce((s, r) => s + r.quantity, 0),
    totalAmountDue: rosterRows.reduce((s, r) => s + (r.amountDue ?? 0), 0),
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
  /** V21：已補印筆數（printCount ≥ 2，即首印之後又列印過）。 */
  reprintedCount: number;
  printDocumentKeys: string[];
};

/**
 * 列印管理中央入口：某年度所有報名項目的列印彙總。
 * 依主活動、項目分組，顯示已確認人數／已列印／未列印。
 *
 * V36.8：普渡牌位／寶袋（US_ANCESTOR/US_ZHENGHUN/US_YUANQIN/US_WUYUAN/US_POCKET_EXTRA）改為
 *   直接沿用 **V34 已驗證正確的同一支查詢**（listPrintItemsForPrintCenter 的列印物件），與 V34／
 *   PrintObjectCenter／print-v34 完全一致（不再另外用「只列 CONFIRMED 報名」計數而顯示 0）。
 *   其餘活動項目（年度燈／宮慶／白米／贊普…）維持既有 CONFIRMED 報名計數，不受影響。
 */
export async function listActivityItemPrintSummary(year: number): Promise<ActivityItemPrintSummary[]> {
  const [itemTypes, items, printObjects] = await Promise.all([
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
      select: { registrationItemTypeId: true, printedAt: true, printCount: true },
    }),
    // V36.8：普渡牌位／寶袋一律用同一支列印物件查詢（與 V34 同源）。
    listPrintItemsForPrintCenter(year, {}),
  ]);

  const stat = new Map<string, { confirmed: number; printed: number; reprinted: number }>();
  for (const it of items) {
    const s = stat.get(it.registrationItemTypeId) ?? { confirmed: 0, printed: 0, reprinted: 0 };
    s.confirmed += 1;
    if (it.printedAt) s.printed += 1;
    if ((it.printCount ?? 0) >= 2) s.reprinted += 1; // V21：已補印（首印後又印過）。
    stat.set(it.registrationItemTypeId, s);
  }

  // V36.8：普渡牌位／寶袋改由列印物件計數（key → 計數），與 V34 一致。
  const usPrintStat = printObjectCountsByItemKey(printObjects);

  return itemTypes.map((t) => {
    // 普渡牌位／寶袋：用 V34 列印物件計數；其餘：維持 CONFIRMED 報名計數。
    const usStat = usPrintStat.get(t.key);
    const s = usStat ?? stat.get(t.id) ?? { confirmed: 0, printed: 0, reprinted: 0 };
    return {
      itemKey: t.key,
      itemName: t.name,
      activityGroup: t.activityGroup,
      activityGroupName: t.activityGroupName,
      year,
      confirmedCount: s.confirmed,
      printedCount: s.printed,
      unprintedCount: s.confirmed - s.printed,
      reprintedCount: s.reprinted,
      printDocumentKeys: t.printDocumentKeys,
    };
  });
}

/**
 * V21 列印預檢：正式列印前檢查名冊每一列的必要欄位是否齊全。
 *
 * 只讀、不寫入、不列印；回傳每一列缺漏的原因，讓畫面在列印前提示、必要時擋下。
 * 依項目性質檢查：一律需姓名／名稱；牌位類（US_ANCESTOR/ZHENGHUN/YUANQIN/WUYUAN）需牌位名稱與地址；
 * 白米（US_RICE）需正整數斤數；其餘需數量 ≥ 1。缺活動資料由呼叫端在載入名冊時即會顯示。
 */
export type RosterPreflightIssue = { registrationItemId: string; label: string; reasons: string[] };

const TABLET_ITEM_KEYS = new Set(["US_ANCESTOR", "US_ZHENGHUN", "US_YUANQIN", "US_WUYUAN"]);

export function validateRosterForPrint(itemKey: string, rows: RosterRow[]): RosterPreflightIssue[] {
  const isTablet = TABLET_ITEM_KEYS.has(itemKey);
  const isRice = itemKey === "US_RICE";
  const issues: RosterPreflightIssue[] = [];
  for (const r of rows) {
    const reasons: string[] = [];
    const name = (r.memberName ?? "").trim();
    const itemName = (r.itemName ?? "").trim();
    // 姓名／名稱：牌位類看牌位名稱（itemName），其餘看認購人／成員姓名。
    if (isTablet) {
      if (!itemName || itemName === "（尚缺牌位姓名）" || itemName === "牌位資料待確認") reasons.push("缺牌位姓名");
    } else if (!name && !itemName) {
      reasons.push("缺姓名");
    }
    if (isRice) {
      if (!Number.isInteger(r.quantity) || r.quantity <= 0) reasons.push("白米斤數異常");
    } else if (!Number.isFinite(r.quantity) || r.quantity < 1) {
      reasons.push("缺數量");
    }
    if (reasons.length > 0) {
      issues.push({ registrationItemId: r.registrationItemId, label: itemName || name || "（未命名）", reasons });
    }
  }
  return issues;
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
