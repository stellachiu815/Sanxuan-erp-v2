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
import { orderCell, sortByRegistrationOrder } from "@/lib/rosterSort";

// 排序純函式已抽到 client-safe 的 rosterSort（便於單元測試）；此處 re-export 供既有呼叫端沿用同一入口。
export { orderCell, sortByRegistrationOrder };

export type RosterExportData = {
  year: number;
  activityName: string;
  sheets: {
    ancestorSoul: { header: string[]; rows: (string | number)[][] };
    debtCreditor: { header: string[]; rows: (string | number)[][] };
    rice: { header: string[]; rows: (string | number)[][] };
    sponsor: { header: string[]; rows: (string | number)[][] };
  };
};

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
      id: true, quantity: true, amountDue: true, customName: true,
      registrationItemType: { select: { key: true } },
      member: { select: { name: true } },
      universalSalvationEntry: { select: { displayName: true, yangshangName: true, yangshangNames: true } },
    },
  });

  const ids = items.map((i) => i.id);
  const orderRows = ids.length
    ? await prisma.$queryRaw<{ id: string; ord: number | null }[]>`
        SELECT "id", "registrationOrder" AS ord FROM "ritual_registration_items" WHERE "id" = ANY(${ids})`
    : [];
  const orderById = new Map(orderRows.map((r) => [r.id, r.ord]));

  const raw: Raw[] = items.map((it) => ({
    id: it.id,
    key: it.registrationItemType.key,
    quantity: it.quantity,
    amountDue: Number(it.amountDue),
    memberName: it.member?.name ?? null,
    customName: it.customName,
    entryName: it.universalSalvationEntry?.displayName ?? null,
    yangshang: it.universalSalvationEntry
      ? resolveYangshangNames(it.universalSalvationEntry.yangshangNames, it.universalSalvationEntry.yangshangName)
      : [],
    registrationOrder: orderById.get(it.id) ?? null,
  }));

  const pick = (keys: string[]) => sortByRegistrationOrder(raw.filter((r) => keys.includes(r.key)));

  // A. 超拔祖先＋乙位正魂
  const as = pick(["US_ANCESTOR", "US_ZHENGHUN"]);
  const ancestorSoul = {
    header: ["編號", "報名項目", "陽上"],
    rows: as.map((r) => [orderCell(r.registrationOrder), r.entryName ?? r.customName ?? "", r.yangshang.join("、")]),
  };

  // B. 累世冤親債主
  const dc = pick(["US_YUANQIN"]);
  const debtCreditor = {
    header: ["編號", "冤親報名者姓名"],
    rows: dc.map((r) => [orderCell(r.registrationOrder), displayDebtCreditorName(r.entryName ?? r.memberName ?? "")]),
  };

  // C. 白米
  const rc = pick(["US_RICE"]);
  const rice = {
    header: ["編號", "報名者", "斤數"],
    rows: rc.map((r) => [orderCell(r.registrationOrder), r.memberName ?? r.customName ?? "", r.quantity]),
  };

  // D. 贊普／隨喜贊普
  const sp = pick(["US_SPONSOR", "US_SPONSOR_DONATION"]);
  const sponsor = {
    header: ["編號", "報名者", "數量", "金額"],
    rows: sp.map((r) => [orderCell(r.registrationOrder), r.memberName ?? r.customName ?? "", r.quantity, r.amountDue]),
  };

  return { year, activityName, sheets: { ancestorSoul, debtCreditor, rice, sponsor } };
}
