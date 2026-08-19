/**
 * V41 年度燈「報名總名單」資料層——**照燈別分工作表**（Stella 定案）：
 *   光明燈（LANTERN_GUANGMING）／太歲燈（LANTERN_TAISUI）／祭改（LANTERN_PURIFICATION）／全家燈（LANTERN_FAMILY）。
 * 每張表欄位：作業號｜姓名｜農曆生日｜生肖｜歲數（虛歲）｜地址｜份數｜收款狀態｜列印狀態。
 * 農曆生日／生肖／虛歲由 composeDevoteeSummary 即時計算（不另存）。地址＝信眾個人地址 → 家戶地址。
 * 只列未取消／未刪除、家戶未封存。排序：依作業號（workOrder 優先，NULL 回退 registrationOrder，皆無排最後）。
 * 純資料層；Excel 由 route 用 SheetJS 產生。
 */
import { prisma } from "@/lib/prisma";
import { printNumberOf } from "@/lib/workOrder";
import { orderCell } from "@/lib/rosterSort";
import { composeDevoteeSummary, DEVOTEE_SUMMARY_INCLUDE } from "@/lib/devoteeProfile";

export type RosterSheet = { header: string[]; stat: string; rows: (string | number)[][] };
export type AnnualLanternRosterData = {
  sheets: { key: string; label: string; sheet: RosterSheet }[];
};

// 燈別 key → 工作表中文名（順序＝光明→太歲→祭改→全家）。
const LAMP_SHEETS: { key: string; label: string }[] = [
  { key: "LANTERN_GUANGMING", label: "光明燈" },
  { key: "LANTERN_TAISUI", label: "太歲燈" },
  { key: "LANTERN_PURIFICATION", label: "祭改" },
  { key: "LANTERN_FAMILY", label: "全家燈" },
];
const LAMP_KEYS = LAMP_SHEETS.map((s) => s.key);

const HEADER = ["作業號", "姓名", "農曆生日", "生肖", "歲數", "地址", "份數", "收款狀態", "列印狀態"];

export async function getAnnualLanternRosterExport(year: number): Promise<AnnualLanternRosterData> {
  const items = await prisma.ritualRegistrationItem.findMany({
    where: {
      deletedAt: null,
      status: { not: "CANCELLED" },
      registrationItemType: { key: { in: LAMP_KEYS } },
      ritualRecord: { deletedAt: null, year, household: { deletedAt: null } },
    },
    select: {
      id: true,
      quantity: true,
      amountDue: true,
      amountUnpaid: true,
      printCount: true,
      memberId: true,
      registrationItemType: { select: { key: true } },
      member: { select: { name: true } },
      ritualRecord: { select: { household: { select: { name: true, address: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  // 作業號（workOrder 優先）。
  const ids = items.map((i) => i.id);
  const orderRows = ids.length
    ? await prisma.$queryRaw<{ id: string; ro: number | null; wo: number | null }[]>`
        SELECT "id", "registrationOrder" AS ro, "workOrder" AS wo FROM "ritual_registration_items" WHERE "id" = ANY(${ids})`
    : [];
  const orderById = new Map(orderRows.map((r) => [r.id, printNumberOf(r.wo, r.ro)]));

  // 成員的農曆生日／生肖／虛歲／個人地址（一次撈齊，composeDevoteeSummary 即時計算）。
  const memberIds = [...new Set(items.map((i) => i.memberId).filter((x): x is string => !!x))];
  const summaryByMember = new Map<string, { lunar: string; zodiac: string; age: string; address: string | null }>();
  if (memberIds.length) {
    const members = await prisma.member.findMany({ where: { id: { in: memberIds } }, include: DEVOTEE_SUMMARY_INCLUDE });
    for (const m of members) {
      const s = composeDevoteeSummary(m);
      summaryByMember.set(m.id, {
        lunar: s.lunarBirthDisplay ?? "",
        zodiac: s.zodiac ?? "",
        age: s.nominalAge != null ? `虛歲 ${s.nominalAge}` : "",
        address: s.personalAddress,
      });
    }
  }

  type Row = { order: number | null; name: string; lunar: string; zodiac: string; age: string; address: string; qty: number; pay: string; print: string };
  const rowsByKey = new Map<string, Row[]>();
  for (const s of LAMP_SHEETS) rowsByKey.set(s.key, []);
  for (const it of items) {
    const key = it.registrationItemType.key;
    const list = rowsByKey.get(key);
    if (!list) continue;
    const sum = it.memberId ? summaryByMember.get(it.memberId) : null;
    const hh = it.ritualRecord.household;
    const unpaid = Number(it.amountUnpaid);
    const c = it.printCount ?? 0;
    list.push({
      order: orderById.get(it.id) ?? null,
      name: (it.member?.name ?? "").trim(),
      lunar: sum?.lunar ?? "",
      zodiac: sum?.zodiac ?? "",
      age: sum?.age ?? "",
      address: (sum?.address ?? hh.address ?? "") || "",
      qty: it.quantity,
      pay: unpaid > 0 ? `未收 ${unpaid}` : "已收足/免費",
      print: c > 0 ? `已列印×${c}` : "未列印",
    });
  }

  const sheets = LAMP_SHEETS.map((s) => {
    const list = rowsByKey.get(s.key) ?? [];
    list.sort((a, b) => {
      if (a.order == null && b.order == null) return 0;
      if (a.order == null) return 1;
      if (b.order == null) return -1;
      return a.order - b.order;
    });
    return {
      key: s.key,
      label: s.label,
      sheet: {
        header: HEADER,
        stat: `${s.label} 共 ${list.length} 筆`,
        rows: list.map((r) => [orderCell(r.order), r.name, r.lunar, r.zodiac, r.age, r.address, r.qty, r.pay, r.print]),
      },
    };
  });

  return { sheets };
}
