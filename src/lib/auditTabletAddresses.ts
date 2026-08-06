import { prisma } from "@/lib/prisma";
import { normalizeTabletText } from "@/lib/tabletIdentity";
import { normalizeRitualNameForStore } from "@/lib/ritualDisplayName";

/**
 * V36.19 牌位地址逐筆對帳（唯讀，瀏覽器可觸發）。
 *
 * 目的：把每一張本年度普渡牌位「**印出來的地址**」與它的各個**可能來源**並排列出——
 *   印出地址(entry.tabletAddress)｜永久牌位安奉地(WorshipRecord.location)｜家戶地址(Household.address)｜信眾地址(Member.address)
 * 以便一次揪出像 F00221 印成「香港…」這種髒資料：Excel 沒填地址時系統會自動帶入舊資料，
 * 若舊資料本身錯，就會印錯。此報表把來源攤開，錯的一眼可辨、也知道要去改哪裡。
 *
 * 不修改任何資料。suspicious＝值得人工看一眼（缺地址／印的不是安奉地／來源對不上任何一處）。
 */

const CAT_TO_WORSHIP: Record<string, "ANCESTOR_LINE" | "INDIVIDUAL"> = {
  ANCESTOR_LINE: "ANCESTOR_LINE",
  INDIVIDUAL_SOUL: "INDIVIDUAL",
};
const CAT_LABEL: Record<string, string> = {
  ANCESTOR_LINE: "歷代祖先", INDIVIDUAL_SOUL: "乙位正魂", DEBT_CREDITOR: "累世冤親債主", UNBORN_CHILD: "無緣子女",
};

const norm = (s: string | null | undefined) => normalizeTabletText(s ?? "");

export type TabletAddrRow = {
  entryId: string; householdId: string; category: string; categoryLabel: string;
  mainName: string; yangshang: string;
  printedAddress: string | null; worshipLocation: string | null; householdAddress: string | null; memberAddresses: string[];
  matchSource: string; suspicious: boolean; note: string;
};
export type TabletAddrAuditReport = { ok: boolean; year: number; total: number; suspiciousCount: number; rows: TabletAddrRow[]; error?: string };

export async function auditTabletAddresses(year: number): Promise<TabletAddrAuditReport> {
  const entries = await prisma.universalSalvationEntry.findMany({
    where: {
      deletedAt: null,
      universalSalvation: { ritualRecord: { year, activityType: "UNIVERSAL_SALVATION", deletedAt: null } },
    },
    select: {
      id: true, category: true, displayName: true, tabletAddress: true, yangshangNames: true, yangshangName: true,
      universalSalvation: { select: { ritualRecord: { select: { householdId: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  const householdIds = [...new Set(entries.map((e) => e.universalSalvation?.ritualRecord?.householdId).filter((x): x is string => !!x))];

  const [households, members, wrs] = await Promise.all([
    householdIds.length ? prisma.household.findMany({ where: { id: { in: householdIds } }, select: { id: true, address: true } }) : [],
    householdIds.length ? prisma.member.findMany({ where: { householdId: { in: householdIds }, deletedAt: null }, select: { householdId: true, address: true } }) : [],
    householdIds.length ? prisma.worshipRecord.findMany({ where: { householdId: { in: householdIds }, type: { in: ["ANCESTOR_LINE", "INDIVIDUAL"] }, deletedAt: null }, select: { householdId: true, type: true, displayName: true, location: true } }) : [],
  ]);

  const hhAddr = new Map(households.map((h) => [h.id, h.address ?? null]));
  const memAddrByHh = new Map<string, string[]>();
  for (const m of members) {
    if (!m.address) continue;
    const arr = memAddrByHh.get(m.householdId) ?? [];
    if (!arr.includes(m.address)) arr.push(m.address);
    memAddrByHh.set(m.householdId, arr);
  }
  const wrByKey = new Map<string, string | null>();
  for (const w of wrs) {
    const cat = w.type === "ANCESTOR_LINE" ? "ANCESTOR_LINE" : "INDIVIDUAL_SOUL";
    const key = `${w.householdId}|${w.type}|${norm(normalizeRitualNameForStore(cat, w.displayName))}`;
    if (!wrByKey.has(key)) wrByKey.set(key, w.location ?? null);
  }

  const rows: TabletAddrRow[] = [];
  for (const e of entries) {
    const hh = e.universalSalvation?.ritualRecord?.householdId ?? "";
    const printed = e.tabletAddress ?? null;
    const wType = CAT_TO_WORSHIP[e.category];
    const worship = wType ? (wrByKey.get(`${hh}|${wType}|${norm(normalizeRitualNameForStore(e.category, e.displayName))}`) ?? null) : null;
    const household = hhAddr.get(hh) ?? null;
    const memAddrs = memAddrByHh.get(hh) ?? [];
    const yang = (e.yangshangNames?.length ? e.yangshangNames : (e.yangshangName ? [e.yangshangName] : [])).join("、");

    // 判斷印出地址與哪個來源相符。
    let matchSource = "來源不明";
    if (!norm(printed)) matchSource = "空白";
    else if (norm(printed) === norm(worship)) matchSource = "永久牌位安奉地";
    else if (norm(printed) === norm(household)) matchSource = "家戶地址";
    else if (memAddrs.some((a) => norm(a) === norm(printed))) matchSource = "信眾地址";
    else matchSource = "來源不明（可能 Excel 明填或髒資料）";

    // suspicious 判準
    const notes: string[] = [];
    if (!norm(printed)) notes.push("缺地址");
    if (wType && norm(worship) && norm(printed) && norm(printed) !== norm(worship)) notes.push("印的不是永久牌位安奉地");
    if (norm(printed) && matchSource === "來源不明（可能 Excel 明填或髒資料）") notes.push("印出地址對不上永久牌位/家戶/信眾任一處");
    const distinct = new Set([worship, household, ...memAddrs].filter((a) => norm(a)).map((a) => norm(a)));
    if (distinct.size > 1) notes.push("這一戶有多個不同地址（打架）");

    rows.push({
      entryId: e.id, householdId: hh, category: e.category, categoryLabel: CAT_LABEL[e.category] ?? e.category,
      mainName: e.displayName, yangshang: yang,
      printedAddress: printed, worshipLocation: worship, householdAddress: household, memberAddresses: memAddrs,
      matchSource, suspicious: notes.length > 0, note: notes.join("；"),
    });
  }
  // 可疑的排前面。
  rows.sort((a, b) => (a.suspicious === b.suspicious ? 0 : a.suspicious ? -1 : 1));

  return { ok: true, year, total: rows.length, suspiciousCount: rows.filter((r) => r.suspicious).length, rows };
}
