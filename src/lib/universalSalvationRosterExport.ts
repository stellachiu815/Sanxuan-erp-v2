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
import { displayDebtCreditorName } from "@/lib/debtCreditorName";
import { orderCell, sortByRegistrationOrder, sortByTypeThenOrder } from "@/lib/rosterSort";
import { printNumberOf } from "@/lib/workOrder";
import { resolvePrintMainText, resolvePrintAddress } from "@/lib/tabletPrintFields";

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
    debtCreditor: RosterSheet;
    unborn: RosterSheet;
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

  const items = await prisma.ritualRegistrationItem.findMany({
    where: {
      deletedAt: null,
      status: "CONFIRMED",
      ritualRecord: { deletedAt: null, status: "CONFIRMED", year, activityType: "UNIVERSAL_SALVATION" },
    },
    select: {
      id: true, quantity: true, amountDue: true, amountUnpaid: true, customName: true,
      memberId: true, printCount: true, printedAt: true, universalSalvationEntryId: true,
      registrationItemType: { select: { key: true, name: true } },
      member: { select: { name: true } },
      universalSalvationEntry: { select: { displayName: true, tabletAddress: true, yangshangName: true, yangshangNames: true } },
    },
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

  const raw: (Raw & { typeName: string; address: string; unpaid: number; printStatus: string })[] = items.map((it) => {
    const entryName = it.universalSalvationEntry?.displayName ?? null;
    const pmt = it.universalSalvationEntryId ? pmtByEntry.get(it.universalSalvationEntryId) : null;
    return {
      id: it.id,
      key: it.registrationItemType.key,
      typeName: it.registrationItemType.name,
      quantity: it.quantity,
      amountDue: Number(it.amountDue),
      unpaid: Number(it.amountUnpaid),
      printStatus: (it.printCount ?? 0) > 0 ? `已列印×${it.printCount}` : "未列印",
      memberName: it.member?.name ?? null,
      customName: it.customName,
      // V32：Excel 主文顯示實際列印主文（printMainText 有值優先）。
      entryName: resolvePrintMainText(entryName ?? it.customName ?? it.member?.name ?? it.registrationItemType.name, pmt),
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

  // A. 超拔祖先＋乙位正魂（同表、各自從 1；不混成一條序列）。編號＝workOrder；主文＝實際列印主文；地址＝entry→Member。
  const asRows = sortByTypeThenOrder(raw.filter((r) => ["US_ANCESTOR", "US_ZHENGHUN"].includes(r.key)), { US_ANCESTOR: 1, US_ZHENGHUN: 2 });
  const ancestorSoul = {
    header: ["正式作業號", "報名項目", "牌位主文", "陽上", "地址", "收款狀態", "列印狀態"],
    stat: `超拔祖先 ${counts.ancestor} 筆／乙位正魂 ${counts.soul} 筆`,
    rows: asRows.map((r) => [orderCell(r.registrationOrder), r.typeName, r.entryName ?? "", r.yangshang.join("、"), r.address, r.unpaid > 0 ? `未收 ${r.unpaid}` : "已收足/免費", r.printStatus]),
  };

  // B. 累世冤親債主——**只用自己的 workOrder**（No.1..N，不接續祖先）；報名者為該筆冤親自身。
  const dc = sortByRegistrationOrder(raw.filter((r) => r.key === "US_YUANQIN"));
  const debtCreditor = {
    header: ["正式作業號", "冤親報名者姓名", "地址"],
    stat: `累世冤親債主 ${counts.debtCreditor} 筆`,
    rows: dc.map((r) => [orderCell(r.registrationOrder), displayDebtCreditorName(r.entryName ?? r.memberName ?? ""), r.address]),
  };

  // C'. 無緣子女（§8.C）——顯示實際 printMainText（有值優先，例：本宅地基主）；各自 workOrder。
  const wy = sortByRegistrationOrder(raw.filter((r) => r.key === "US_WUYUAN"));
  const unborn = {
    header: ["正式作業號", "牌位主文", "陽上", "地址"],
    stat: `無緣子女 ${counts.unborn} 筆`,
    rows: wy.map((r) => [orderCell(r.registrationOrder), r.entryName ?? "", r.yangshang.join("、"), r.address]),
  };

  // C. 白米——自己的 registrationOrder。
  const rc = sortByRegistrationOrder(raw.filter((r) => r.key === "US_RICE"));
  const rice = {
    header: ["編號", "報名者", "斤數"],
    stat: `白米 ${counts.rice} 筆／合計 ${counts.riceTotalKg} 斤`,
    rows: rc.map((r) => [orderCell(r.registrationOrder), r.memberName ?? r.customName ?? "", r.quantity]),
  };

  // D. 贊普／隨喜贊普——各自類別、各自 registrationOrder（同表分區塊）。
  const sp = sortByTypeThenOrder(raw.filter((r) => ["US_SPONSOR", "US_SPONSOR_DONATION"].includes(r.key)), { US_SPONSOR: 1, US_SPONSOR_DONATION: 2 });
  const sponsor = {
    header: ["編號", "報名項目", "報名者", "數量", "金額"],
    stat: `贊普 ${counts.sponsor} 筆／隨喜贊普 ${counts.sponsorDonation} 筆`,
    rows: sp.map((r) => [orderCell(r.registrationOrder), r.typeName, r.memberName ?? r.customName ?? "", r.quantity, r.amountDue]),
  };

  return { year, activityName, counts, sheets: { ancestorSoul, debtCreditor, unborn, rice, sponsor } };
}
