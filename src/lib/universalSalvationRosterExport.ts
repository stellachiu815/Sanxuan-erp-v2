/**
 * V30.6 中元普渡「活動總名單」Excel 匯出（唯讀組資料 + 純函式排序）。
 *
 * 規格：依 registrationOrder 排序（NULL 排最後、顯示「—」）；取消／刪除不列入；不以姓名排序、不以家戶合併；
 * 條件與畫面正式名單一致（item + record 皆 CONFIRMED、未刪除）；四個工作表：
 *   A. 超拔祖先＋乙位正魂：編號／報名項目（牌位名）／陽上（逐筆一列）
 *   B. 累世冤親債主：編號／冤親報名者姓名（逐筆一列）
 *   C. 白米：編號／報名者／斤數
 *   D. 贊普／隨喜贊普：編號／報名者／數量／金額
 * 不改財務 Excel。純資料層，Excel 檔由 route 用既有 SheetJS 產生。
 */
import { prisma } from "@/lib/prisma";
import { resolveYangshangNames } from "@/lib/yangshang";
import { orderCell, sortByRegistrationOrder, sortByTypeThenOrder } from "@/lib/rosterSort";
import { printNumberOf } from "@/lib/workOrder";
import { resolvePrintMainText, resolvePrintAddress } from "@/lib/tabletPrintFields";
import { resolveRitualDisplayName, categoryFromItemKey } from "@/lib/ritualDisplayName";

// 排序純函式已抽到 client-safe 的 rosterSort（便於單元測試）；此處 re-export 供既有呼叫端沿用同一入口。
export { orderCell, sortByRegistrationOrder, sortByTypeThenOrder };
// V32：編號欄一律用 printNumberOf(workOrder, registrationOrder)——workOrder 有值優先、NULL 回退。

export type RosterExportData = {
  year: number;
  activityName: string;
  counts: {
    ancestor: number; soul: number; debtCreditor: number; unborn: number;
    rice: number; riceTotalKg: number; sponsor: number; sponsorDonation: number;
    basicPocket: number; extraPocket: number;
  };
  sheets: {
    ancestorSoul: RosterSheet;
    creditorUnborn: RosterSheet;
    rice: RosterSheet;
    sponsor: RosterSheet;
  };
};

export type RosterSheet = { header: string[]; stat: string; rows: (string | number)[][] };

type Raw = {
  id: string;
  key: string;
  quantity: number;
  amountDue: number;
  memberName: string | null;
  customName: string | null;
  entryName: string | null;
  yangshang: string[];
  registrationOrder: number | null;
};

export async function getUniversalSalvationRosterExport(year: number): Promise<RosterExportData> {
  const event = await prisma.templeEvent.findFirst({
    where: { activityType: "UNIVERSAL_SALVATION", year },
    select: { name: true },
  });
  const activityName = event?.name ?? "中元普渡";

  // V38：總名單＝「只要有成立報名就列」（含 DRAFT，方便當天現場比對），不再限 CONFIRMED；
  //   只排除已取消／已刪除／已封存家戶。排序照建立先後（＝Excel 匯入順序在前、ERP 之後新增往後）。
  const items = await prisma.ritualRegistrationItem.findMany({
    where: {
      deletedAt: null,
      status: { not: "CANCELLED" },
      ritualRecord: { deletedAt: null, year, activityType: "UNIVERSAL_SALVATION", household: { deletedAt: null } },
    },
    select: {
      id: true, quantity: true, amountDue: true, amountUnpaid: true, customName: true,
      memberId: true, printCount: true, printedAt: true, universalSalvationEntryId: true,
      registrationItemType: { select: { key: true, name: true } },
      member: { select: { name: true } },
      universalSalvationEntry: { select: { displayName: true, tabletAddress: true, yangshangName: true, yangshangNames: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const ids = items.map((i) => i.id);
  // V32：讀 workOrder 與 registrationOrder，編號＝printNumberOf（workOrder 優先）。
  const orderRows = ids.length
    ? await prisma.$queryRaw<{ id: string; ro: number | null; wo: number | null }[]>`
        SELECT "id", "registrationOrder" AS ro, "workOrder" AS wo FROM "ritual_registration_items" WHERE "id" = ANY(${ids})`
    : [];
  const orderById = new Map(orderRows.map((r) => [r.id, printNumberOf(r.wo, r.ro)]));

  // V32 printMainText（單筆主文覆寫）＋ Member.address（地址 fallback）。
  const entryIds = items.map((i) => i.universalSalvationEntryId).filter((x): x is string => !!x);
  const pmtRows = entryIds.length
    ? await prisma.$queryRaw<{ id: string; pmt: string | null }[]>`SELECT "id", "printMainText" AS pmt FROM "universal_salvation_entries" WHERE "id" = ANY(${entryIds})`
    : [];
  const pmtByEntry = new Map(pmtRows.map((r) => [r.id, r.pmt]));
  const memberIds = [...new Set(items.map((i) => i.memberId).filter((x): x is string => !!x))];
  const memberAddr = memberIds.length
    ? new Map((await prisma.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, address: true } })).map((m) => [m.id, m.address]))
    : new Map<string, string | null>();

  // V41 列印狀態改讀「牌位列印物件」(additional_print_items, itemType=TABLET)——實際列印是記在這裡
  //   （列印確認 confirmPrintObjects 更新 printCount/firstPrintedAt），報名項目的 printCount 根本沒被動過，
  //   舊版讀報名項目所以永遠顯示「未列印」。以 sourceEntryId 對應到各牌位 entry。
  const printCountByEntry = new Map<string, number>();
  if (entryIds.length) {
    const tabletPrintObjs = await prisma.additionalPrintItem.findMany({
      where: { itemType: "TABLET", deletedAt: null, status: { not: "CANCELLED" }, sourceEntryId: { in: entryIds } },
      select: { sourceEntryId: true, printCount: true },
    });
    for (const p of tabletPrintObjs) {
      const prev = printCountByEntry.get(p.sourceEntryId) ?? 0;
      const c = p.printCount ?? 0;
      if (c > prev) printCountByEntry.set(p.sourceEntryId, c);
    }
  }

  const raw: (Raw & { typeName: string; address: string; unpaid: number; printStatus: string })[] = items.map((it) => {
    const entryName = it.universalSalvationEntry?.displayName ?? null;
    const pmt = it.universalSalvationEntryId ? pmtByEntry.get(it.universalSalvationEntryId) : null;
    // V33.1：先以共用 resolver 取完整顯示名稱（type 依 item key 欄位，不猜名稱），再套 printMainText 覆寫。
    const nameCategory = categoryFromItemKey(it.registrationItemType.key);
    const resolvedName = nameCategory ? resolveRitualDisplayName(nameCategory, entryName ?? "") : "";
    const baseName = resolvedName || entryName || it.customName || it.member?.name || it.registrationItemType.name;
    return {
      id: it.id,
      key: it.registrationItemType.key,
      typeName: it.registrationItemType.name,
      quantity: it.quantity,
      amountDue: Number(it.amountDue),
      unpaid: Number(it.amountUnpaid),
      // V41：列印狀態＝該牌位的列印物件 printCount（不再讀報名項目那個一直是 0 的欄位）。
      printStatus: (() => {
        const c = it.universalSalvationEntryId ? (printCountByEntry.get(it.universalSalvationEntryId) ?? 0) : 0;
        return c > 0 ? `已列印×${c}` : "未列印";
      })(),
      memberName: it.member?.name ?? null,
      customName: it.customName,
      // V32：Excel 主文顯示實際列印主文（printMainText 有值優先）。
      entryName: resolvePrintMainText(baseName, pmt),
      // V32：地址 entry → Member（絕不 Household）。
      address: resolvePrintAddress(it.universalSalvationEntry?.tabletAddress, it.memberId ? memberAddr.get(it.memberId) : null),
      yangshang: it.universalSalvationEntry
        ? resolveYangshangNames(it.universalSalvationEntry.yangshangNames, it.universalSalvationEntry.yangshangName)
        : [],
      registrationOrder: orderById.get(it.id) ?? null,
    };
  });

  // 有效寶袋列印物件（基本／額外）——供統計。
  const pocketCounts = await prisma.additionalPrintItem.groupBy({
    by: ["isExtra"],
    where: { itemType: "POCKET", deletedAt: null, status: { not: "CANCELLED" }, ritualRecord: { year, activityType: "UNIVERSAL_SALVATION", deletedAt: null } },
    _count: { _all: true },
  });
  const basicPocket = pocketCounts.find((p) => !p.isExtra)?._count._all ?? 0;
  const extraPocket = pocketCounts.find((p) => p.isExtra)?._count._all ?? 0;

  const countOf = (keys: string[]) => raw.filter((r) => keys.includes(r.key)).length;
  const counts = {
    ancestor: countOf(["US_ANCESTOR"]),
    soul: countOf(["US_ZHENGHUN"]),
    debtCreditor: countOf(["US_YUANQIN"]),
    unborn: countOf(["US_WUYUAN"]),
    rice: countOf(["US_RICE"]),
    riceTotalKg: raw.filter((r) => r.key === "US_RICE").reduce((s, r) => s + r.quantity, 0),
    sponsor: countOf(["US_SPONSOR"]),
    sponsorDonation: countOf(["US_SPONSOR_DONATION"]),
    basicPocket,
    extraPocket,
  };

  // V38：工作表照「列印批次」歸類（與實體列印、作業編號一致，方便核對手寫本）。
  //   表一（黃紙）＝祖先＋乙位正魂＋地基主；表二（粉紅）＝冤親＋無緣子女。
  //   UNBORN_CHILD 依主文分流（含「地基主」→表一；其餘無緣子女→表二）。
  //   一條連續順序、照建立先後（＝Excel 匯入在前、ERP 新增往後；raw 已 orderBy createdAt）。
  const isEarthGod = (r: (typeof raw)[number]) => (r.entryName ?? "").includes("地基主");
  const earthGodCount = raw.filter((r) => r.key === "US_WUYUAN" && isEarthGod(r)).length;
  const unbornCount = raw.filter((r) => r.key === "US_WUYUAN" && !isEarthGod(r)).length;

  // 表一：祖先＋乙位正魂＋地基主，**依作業號由小到大排**（對得上牌位上的號碼；無號者排最後）。
  const asRows = sortByRegistrationOrder(raw.filter((r) => r.key === "US_ANCESTOR" || r.key === "US_ZHENGHUN" || (r.key === "US_WUYUAN" && isEarthGod(r))));
  const ancestorSoul = {
    header: ["正式作業號", "報名項目", "牌位主文", "陽上", "地址", "收款狀態", "列印狀態"],
    stat: `祖先 ${counts.ancestor} 筆／乙位正魂 ${counts.soul} 筆／地基主 ${earthGodCount} 筆`,
    rows: asRows.map((r) => [orderCell(r.registrationOrder), r.typeName, r.entryName ?? "", r.yangshang.join("、"), r.address, r.unpaid > 0 ? `未收 ${r.unpaid}` : "已收足/免費", r.printStatus]),
  };

  // 表二：冤親＋無緣子女，**依作業號由小到大排**（對得上牌位上的號碼；無號者排最後）。
  const cuRows = sortByRegistrationOrder(raw.filter((r) => r.key === "US_YUANQIN" || (r.key === "US_WUYUAN" && !isEarthGod(r))));
  const creditorUnborn = {
    header: ["正式作業號", "報名項目", "牌位主文", "陽上", "地址", "收款狀態", "列印狀態"],
    stat: `累世冤親債主 ${counts.debtCreditor} 筆／無緣子女 ${unbornCount} 筆`,
    rows: cuRows.map((r) => [orderCell(r.registrationOrder), r.typeName, r.entryName ?? "", r.yangshang.join("、"), r.address, r.unpaid > 0 ? `未收 ${r.unpaid}` : "已收足/免費", r.printStatus]),
  };

  // C. 白米——自己的 registrationOrder。
  const rc = sortByRegistrationOrder(raw.filter((r) => r.key === "US_RICE"));
  const rice = {
    header: ["編號", "認購人", "斤數"],
    stat: `白米 ${counts.rice} 筆／合計 ${counts.riceTotalKg} 斤`,
    // V38：白米也顯示「認購人」＝自訂名（可為公司名）優先，沒填才用成員姓名。
    rows: rc.map((r) => [orderCell(r.registrationOrder), r.customName ?? r.memberName ?? "", r.quantity]),
  };

  // D. 贊普／隨喜贊普——各自類別、各自 registrationOrder（同表分區塊）。
  const sp = sortByTypeThenOrder(raw.filter((r) => ["US_SPONSOR", "US_SPONSOR_DONATION"].includes(r.key)), { US_SPONSOR: 1, US_SPONSOR_DONATION: 2 });
  const sponsor = {
    header: ["編號", "報名項目", "認購人", "數量", "金額"],
    stat: `贊普 ${counts.sponsor} 筆／隨喜贊普 ${counts.sponsorDonation} 筆`,
    // V38：贊普顯示「認購人」＝自訂名（可為公司名）優先，沒有才用成員姓名。
    rows: sp.map((r) => [orderCell(r.registrationOrder), r.typeName, r.customName ?? r.memberName ?? "", r.quantity, r.amountDue]),
  };

  return { year, activityName, counts, sheets: { ancestorSoul, creditorUnborn, rice, sponsor } };
}
