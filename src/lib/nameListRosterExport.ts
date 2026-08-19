/**
 * V41 名單型活動（補庫 STORAGE_TROUSERS／宮燈 PALACE_LANTERN）「報名總名單」資料層。
 *
 * 一人一筆、固定單價。欄位（Stella 定案）：
 *   作業號｜姓名｜家戶｜地址｜電話（選填）｜金額｜收款狀態｜列印狀態
 * 排序：依作業號（workOrder 優先，NULL 回退 registrationOrder；皆無 → 排最後、顯示「—」）。
 * 只列 CONFIRMED／未取消／未刪除、家戶未封存。純資料層；Excel 由 route 用 SheetJS 產生。
 * 地址＝信眾個人地址優先 → 家戶地址；電話＝家戶市話 → 手機（選填，沒有就空白）。
 */
import { prisma } from "@/lib/prisma";
import { printNumberOf } from "@/lib/workOrder";
import { orderCell } from "@/lib/rosterSort";

export type NameListRosterData = {
  itemKey: string;
  activityLabel: string;
  header: string[];
  stat: string;
  rows: (string | number)[][];
};

export async function getNameListRosterExport(
  itemKey: string,
  year: number,
  activityLabel: string
): Promise<NameListRosterData> {
  const items = await prisma.ritualRegistrationItem.findMany({
    where: {
      deletedAt: null,
      status: { not: "CANCELLED" },
      registrationItemType: { key: itemKey },
      ritualRecord: { deletedAt: null, year, household: { deletedAt: null } },
    },
    select: {
      id: true,
      quantity: true,
      amountDue: true,
      amountUnpaid: true,
      customName: true,
      printCount: true,
      member: { select: { name: true, address: true } },
      ritualRecord: { select: { household: { select: { name: true, address: true, phone: true, mobile: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  const ids = items.map((i) => i.id);
  // 作業號＝printNumberOf(workOrder, registrationOrder)——workOrder 優先。raw SQL 讀取（比照普渡名單）。
  const orderRows = ids.length
    ? await prisma.$queryRaw<{ id: string; ro: number | null; wo: number | null }[]>`
        SELECT "id", "registrationOrder" AS ro, "workOrder" AS wo FROM "ritual_registration_items" WHERE "id" = ANY(${ids})`
    : [];
  const orderById = new Map(orderRows.map((r) => [r.id, printNumberOf(r.wo, r.ro)]));

  type Row = { order: number | null; name: string; household: string; address: string; phone: string; amount: number; pay: string; print: string };
  const raw: Row[] = items.map((it) => {
    const hh = it.ritualRecord.household;
    const unpaid = Number(it.amountUnpaid);
    const c = it.printCount ?? 0;
    return {
      order: orderById.get(it.id) ?? null,
      name: (it.customName?.trim() || it.member?.name || "").trim(),
      household: hh.name,
      address: (it.member?.address ?? hh.address ?? "") || "",
      phone: (hh.phone ?? hh.mobile ?? "") || "",
      amount: Number(it.amountDue),
      pay: unpaid > 0 ? `未收 ${unpaid}` : "已收足/免費",
      print: c > 0 ? `已列印×${c}` : "未列印",
    };
  });

  // 依作業號由小到大；無號者（NULL）排最後、顯示「—」。
  raw.sort((a, b) => {
    if (a.order == null && b.order == null) return 0;
    if (a.order == null) return 1;
    if (b.order == null) return -1;
    return a.order - b.order;
  });

  return {
    itemKey,
    activityLabel,
    header: ["作業號", "姓名", "家戶", "地址", "電話", "金額", "收款狀態", "列印狀態"],
    stat: `${activityLabel} 共 ${raw.length} 筆`,
    rows: raw.map((r) => [orderCell(r.order), r.name, r.household, r.address, r.phone, r.amount, r.pay, r.print]),
  };
}
