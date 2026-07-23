import { prisma } from "@/lib/prisma";
import { listHouseholdYangshang } from "@/lib/householdYangshang";

/**
 * V14.2：中元普渡報名的「本戶固定選項」來源。
 *
 * 兩組**不同**的固定選項（不要混為一談）：
 *  一、本戶歷代祖先（祖先牌位名稱）── 直接查既有資料，不建第二套字庫：
 *        - WorshipRecord            type = ANCESTOR_LINE 的 displayName
 *        - UniversalSalvationEntry  category = ANCESTOR_LINE 的 displayName（歷年普渡、含人工建立）
 *  二、本戶固定陽上人（人名）── 合併多個既有來源後去重：
 *        - HouseholdYangshang（字庫，含匯入回填與人工新增）
 *        - 戶主（Member.role = HOUSEHOLD_HEAD）
 *        - 主要聯絡人（Member.isPrimaryContact = true）
 *        - 家戶成員（其餘 Member）
 *
 * 兩者都以「姓名」去重、保留合理順序。純讀取，不寫任何資料。
 */

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

/** 一、本戶歷代祖先牌位名稱（去重）。 */
export async function listHouseholdAncestorNames(householdId: string): Promise<string[]> {
  const [worship, entries] = await Promise.all([
    prisma.worshipRecord.findMany({
      where: { householdId, type: "ANCESTOR_LINE" },
      orderBy: { createdAt: "asc" },
      select: { displayName: true },
    }),
    prisma.universalSalvationEntry.findMany({
      where: {
        category: "ANCESTOR_LINE",
        deletedAt: null,
        universalSalvation: { ritualRecord: { householdId } },
      },
      orderBy: { createdAt: "asc" },
      select: { displayName: true },
    }),
  ]);
  return dedupePreserveOrder([
    ...worship.map((w) => w.displayName),
    ...entries.map((e) => e.displayName),
  ]);
}

/** 二、本戶固定陽上人候選（字庫＋戶主＋主要聯絡人＋成員，去重）。 */
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

  // 順序：字庫 → 戶主 → 主要聯絡人 → 其餘成員（去重後仍保留這個優先序）。
  return dedupePreserveOrder([...fromLibrary, ...head, ...primary, ...rest]);
}

export type HouseholdRegistrationOptions = {
  ancestorNames: string[];
  yangshangNames: string[];
};

/** 一次取回兩組固定選項（報名畫面載入時呼叫）。 */
export async function getHouseholdRegistrationOptions(
  householdId: string
): Promise<HouseholdRegistrationOptions> {
  const [ancestorNames, yangshangNames] = await Promise.all([
    listHouseholdAncestorNames(householdId),
    listHouseholdYangshangCandidates(householdId),
  ]);
  return { ancestorNames, yangshangNames };
}
