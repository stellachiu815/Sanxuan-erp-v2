import { prisma } from "@/lib/prisma";
import { listHouseholdYangshang } from "@/lib/householdYangshang";
import { getRegistrationItemTypeByKey } from "@/lib/registrationItems";
import { resolveYangshangNames } from "@/lib/yangshang";

/**
 * V14.2：中元普渡報名的「本戶固定選項」來源。
 *
 * 直接查既有資料、不建第二套字庫。三組**不同**的既有牌位可選項，各自帶出既有的
 * 陽上人與牌位地址，點選即可整筆帶入，不必重打：
 *
 *  一、本戶歷代祖先（ANCESTOR_LINE）
 *  二、本戶乙位正魂（worship_records=INDIVIDUAL／entries=INDIVIDUAL_SOUL）
 *  三、本戶既有冤親債主（DEBT_CREDITOR；名稱通常固定「累世冤親債主」，跨年份去重成一項）
 *
 * 來源表：
 *  - worship_records（type / yangshangName / location）
 *  - universal_salvation_entries（category / yangshangNames|yangshangName / tabletAddress）
 * 另外提供「本戶固定陽上人」候選（HouseholdYangshang＋戶主＋主要聯絡人＋成員）。
 * 純讀取，不寫任何資料。
 */

/** 一筆既有牌位可選項：顯示名稱＋既有陽上人＋既有牌位地址。 */
export type WorshipOption = {
  displayName: string;
  yangshangNames: string[];
  tabletAddress: string | null;
};

/** 合併同名牌位：以 displayName 去重，陽上人／地址取「第一個非空」的既有值。 */
function mergeByDisplayName(
  rows: { displayName: string; yangshangNames: string[]; tabletAddress: string | null }[]
): WorshipOption[] {
  const map = new Map<string, WorshipOption>();
  for (const r of rows) {
    const name = (r.displayName ?? "").trim();
    if (!name) continue;
    const existing = map.get(name);
    if (!existing) {
      map.set(name, {
        displayName: name,
        yangshangNames: r.yangshangNames,
        tabletAddress: r.tabletAddress,
      });
    } else {
      if (existing.yangshangNames.length === 0 && r.yangshangNames.length > 0) {
        existing.yangshangNames = r.yangshangNames;
      }
      if (!existing.tabletAddress && r.tabletAddress) existing.tabletAddress = r.tabletAddress;
    }
  }
  return Array.from(map.values());
}

/** 撈某類既有牌位（worship_records + universal_salvation_entries），帶陽上人與地址。 */
async function loadWorshipOptions(
  householdId: string,
  worshipType: "ANCESTOR_LINE" | "INDIVIDUAL" | null,
  entryCategory: "ANCESTOR_LINE" | "INDIVIDUAL_SOUL" | "DEBT_CREDITOR"
): Promise<WorshipOption[]> {
  const [worship, entries] = await Promise.all([
    worshipType
      ? prisma.worshipRecord.findMany({
          where: { householdId, type: worshipType },
          orderBy: { createdAt: "asc" },
          select: { displayName: true, yangshangName: true, location: true },
        })
      : Promise.resolve([] as { displayName: string; yangshangName: string | null; location: string | null }[]),
    prisma.universalSalvationEntry.findMany({
      where: {
        category: entryCategory,
        deletedAt: null,
        universalSalvation: { ritualRecord: { householdId } },
      },
      orderBy: { createdAt: "asc" },
      select: { displayName: true, yangshangName: true, yangshangNames: true, tabletAddress: true },
    }),
  ]);

  return mergeByDisplayName([
    ...worship.map((w) => ({
      displayName: w.displayName,
      yangshangNames: resolveYangshangNames(null, w.yangshangName),
      tabletAddress: w.location ?? null,
    })),
    ...entries.map((e) => ({
      displayName: e.displayName,
      yangshangNames: resolveYangshangNames(e.yangshangNames, e.yangshangName),
      tabletAddress: e.tabletAddress ?? null,
    })),
  ]);
}

/** 一、本戶歷代祖先。 */
export async function listHouseholdAncestorOptions(householdId: string): Promise<WorshipOption[]> {
  return loadWorshipOptions(householdId, "ANCESTOR_LINE", "ANCESTOR_LINE");
}

/** 二、本戶乙位正魂（worship_records 的 INDIVIDUAL 對應乙位正魂）。 */
export async function listHouseholdIndividualSoulOptions(householdId: string): Promise<WorshipOption[]> {
  return loadWorshipOptions(householdId, "INDIVIDUAL", "INDIVIDUAL_SOUL");
}

/** 三、本戶既有冤親債主（只用既有 entries；名稱固定者跨年份去重成一項，不需地址）。 */
export async function listHouseholdDebtCreditorNames(householdId: string): Promise<string[]> {
  const opts = await loadWorshipOptions(householdId, null, "DEBT_CREDITOR");
  return opts.map((o) => o.displayName);
}

function dedupePreserveOrder(names: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = (raw ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** 本戶固定陽上人候選（字庫＋戶主＋主要聯絡人＋成員，去重）。 */
export async function listHouseholdYangshangCandidates(householdId: string): Promise<string[]> {
  const [fromLibrary, members] = await Promise.all([
    listHouseholdYangshang(householdId),
    prisma.member.findMany({
      where: { householdId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { name: true, role: true, isPrimaryContact: true },
    }),
  ]);

  const head = members.filter((m) => m.role === "HOUSEHOLD_HEAD").map((m) => m.name);
  const primary = members.filter((m) => m.isPrimaryContact).map((m) => m.name);
  const rest = members.map((m) => m.name);
  return dedupePreserveOrder([...fromLibrary, ...head, ...primary, ...rest]);
}

/** 本戶有效成員（供「全戶加入累世冤親債主」挑選；已排除刪除）。 */
export type HouseholdMemberOption = { id: string; name: string; isDeceased: boolean };

export type HouseholdRegistrationOptions = {
  /** 相容舊欄位：歷代祖先名稱清單。 */
  ancestorNames: string[];
  ancestors: WorshipOption[];
  individualSouls: WorshipOption[];
  debtCreditorNames: string[];
  yangshangNames: string[];
  /** V14.2「全戶加入累世冤親債主」用：本戶有效成員與 US_YUANQIN 項目 id。 */
  members: HouseholdMemberOption[];
  yuanqinItemTypeId: string | null;
};

/** 一次取回全部固定選項（報名畫面載入時呼叫）。 */
export async function getHouseholdRegistrationOptions(
  householdId: string
): Promise<HouseholdRegistrationOptions> {
  const [ancestors, individualSouls, debtCreditorNames, yangshangNames, members, yuanqinType] =
    await Promise.all([
      listHouseholdAncestorOptions(householdId),
      listHouseholdIndividualSoulOptions(householdId),
      listHouseholdDebtCreditorNames(householdId),
      listHouseholdYangshangCandidates(householdId),
      prisma.member.findMany({
        where: { householdId, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, isDeceased: true },
      }),
      getRegistrationItemTypeByKey("US_YUANQIN"),
    ]);
  return {
    ancestorNames: ancestors.map((a) => a.displayName),
    ancestors,
    individualSouls,
    debtCreditorNames,
    yangshangNames,
    members,
    yuanqinItemTypeId: yuanqinType?.id ?? null,
  };
}
