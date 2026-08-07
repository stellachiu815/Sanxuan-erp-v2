import { prisma } from "@/lib/prisma";

/**
 * V38 信眾資料匯出（Excel 用純資料層）。
 *
 * 規格（Stella）：以「戶」為單位分組，但每位成員的完整資料都要呈現，含「祭祀資料」
 *   （永久供奉牌位＋當年度普渡報名）。一位成員一列、同戶連在一起（家戶欄重複帶出，方便篩選）。
 *   排除已刪除家戶／成員。
 */

export type DevoteeExportData = {
  year: number;
  header: string[];
  rows: (string | number)[][];
  householdCount: number;
  memberCount: number;
};

const two = (n: number) => String(n).padStart(2, "0");

function birthdayText(m: {
  solarBirthDate: Date | null; lunarBirthYear: number | null; lunarBirthMonth: number | null; lunarBirthDay: number | null; lunarIsLeapMonth: boolean;
}): string {
  if (m.solarBirthDate) {
    const d = m.solarBirthDate;
    return `國曆 ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  }
  if (m.lunarBirthYear) {
    return `農曆 ${m.lunarBirthYear}年${m.lunarBirthMonth ?? "?"}月${m.lunarBirthDay ?? "?"}日${m.lunarIsLeapMonth ? "(閏)" : ""}`;
  }
  return "";
}

const WORSHIP_TYPE_LABEL: Record<string, string> = {
  ANCESTOR_LINE: "歷代祖先", INDIVIDUAL: "乙位正魂", INDIVIDUAL_SOUL: "乙位正魂",
};

export async function getDevoteeExport(year: number): Promise<DevoteeExportData> {
  const households = await prisma.household.findMany({
    where: { deletedAt: null },
    orderBy: { id: "asc" },
    select: {
      id: true, name: true, contactName: true, phone: true, mobile: true, address: true,
      members: {
        where: { deletedAt: null },
        orderBy: [{ isPrimaryContact: "desc" }, { createdAt: "asc" }],
        select: {
          id: true, name: true, gender: true, role: true, isPrimaryContact: true, isDeceased: true,
          address: true, nationalId: true, birthHour: true, notes: true,
          solarBirthDate: true, lunarBirthYear: true, lunarBirthMonth: true, lunarBirthDay: true, lunarIsLeapMonth: true,
          worshipRecords: { where: { deletedAt: null }, select: { displayName: true, type: true } },
        },
      },
    },
  });

  // 當年度普渡報名（每位成員的項目名稱），一次撈起來以 memberId 分組（避免逐員查詢）。
  const memberIds = households.flatMap((h) => h.members.map((m) => m.id));
  const usItems = memberIds.length
    ? await prisma.ritualRegistrationItem.findMany({
        where: {
          deletedAt: null,
          status: { not: "CANCELLED" },
          memberId: { in: memberIds },
          ritualRecord: { year, activityType: "UNIVERSAL_SALVATION", deletedAt: null },
        },
        select: { memberId: true, registrationItemType: { select: { name: true } } },
      })
    : [];
  const usByMember = new Map<string, string[]>();
  for (const it of usItems) {
    if (!it.memberId) continue;
    const arr = usByMember.get(it.memberId) ?? [];
    arr.push(it.registrationItemType.name);
    usByMember.set(it.memberId, arr);
  }

  const header = [
    "家戶編號", "戶名", "主要聯絡人", "家戶電話", "家戶手機", "家戶地址",
    "成員姓名", "身份", "性別", "是否主聯絡人", "是否已辭世", "生日", "個人地址", "身分證", "出生時辰",
    "永久供奉牌位", `民國${year}年普渡報名`, "備註",
  ];

  const rows: (string | number)[][] = [];
  let memberCount = 0;
  for (const h of households) {
    const members = h.members.length ? h.members : [null];
    for (const m of members) {
      if (!m) {
        rows.push([h.id, h.name, h.contactName ?? "", h.phone ?? "", h.mobile ?? "", h.address ?? "", "（此戶無成員）", "", "", "", "", "", "", "", "", "", "", ""]);
        continue;
      }
      memberCount += 1;
      const worship = m.worshipRecords.map((w) => `${WORSHIP_TYPE_LABEL[w.type] ?? w.type}：${w.displayName}`).join("；");
      const usReg = (usByMember.get(m.id) ?? []).join("、");
      rows.push([
        h.id, h.name, h.contactName ?? "", h.phone ?? "", h.mobile ?? "", h.address ?? "",
        m.name, m.role ?? "", m.gender ?? "", m.isPrimaryContact ? "是" : "", m.isDeceased ? "是" : "",
        birthdayText(m), m.address ?? "", m.nationalId ?? "", m.birthHour ?? "",
        worship, usReg, m.notes ?? "",
      ]);
    }
  }

  return { year, header, rows, householdCount: households.length, memberCount };
}
