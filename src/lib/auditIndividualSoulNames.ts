import { prisma } from "@/lib/prisma";

/**
 * V38 檢查「乙位正魂」命名是否誤用「某姓」（祖先式命名）。
 *
 * 乙位正魂＝個人往生者，主文應為**全名**（例：溫崇仁乙位正魂）；不應是「陳姓」這種
 * 只有姓的祖先式命名（那會顯示成「陳姓乙位正魂」，多半是匯入/建立時類別選錯或名字打錯）。
 *
 * 只讀不改：把可疑的列出來（永久牌位 WorshipRecord type=INDIVIDUAL＋本年度報名 entry
 * category=INDIVIDUAL_SOUL），供人工到該戶「編輯」修正。可疑判定＝主文以「姓」結尾，或為單一字。
 */

export type SoulNameRow = {
  source: "永久牌位" | "本年度報名";
  id: string;
  householdId: string | null;
  displayName: string;
  location: string | null;
  yangshang: string | null;
};
export type AuditSoulNamesReport = { ok: boolean; totalSouls: number; suspicious: SoulNameRow[] };

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s/g, "").trim();
/** 疑似祖先式命名：以「姓」結尾（陳姓／王姓…）或只有一個字（單姓）。 */
const looksLikeSurname = (name: string): boolean => {
  const n = norm(name);
  return n.length > 0 && (n.endsWith("姓") || n.length === 1);
};

export async function auditIndividualSoulNames(year: number): Promise<AuditSoulNamesReport> {
  const worship = await prisma.worshipRecord.findMany({
    where: { type: "INDIVIDUAL", deletedAt: null },
    select: { id: true, householdId: true, displayName: true, location: true, yangshangName: true },
  });
  const entries = await prisma.universalSalvationEntry.findMany({
    where: {
      category: "INDIVIDUAL_SOUL",
      deletedAt: null,
      universalSalvation: { ritualRecord: { year, activityType: "UNIVERSAL_SALVATION", deletedAt: null } },
    },
    select: {
      id: true,
      displayName: true,
      tabletAddress: true,
      yangshangName: true,
      yangshangNames: true,
      universalSalvation: { select: { ritualRecord: { select: { householdId: true } } } },
    },
  });

  const suspicious: SoulNameRow[] = [];
  for (const w of worship) {
    if (looksLikeSurname(w.displayName)) {
      suspicious.push({ source: "永久牌位", id: w.id, householdId: w.householdId, displayName: w.displayName, location: w.location, yangshang: w.yangshangName });
    }
  }
  for (const e of entries) {
    if (looksLikeSurname(e.displayName)) {
      const yang = (Array.isArray(e.yangshangNames) && e.yangshangNames.length ? (e.yangshangNames as string[]) : e.yangshangName ? [e.yangshangName] : []).join("、");
      suspicious.push({ source: "本年度報名", id: e.id, householdId: e.universalSalvation?.ritualRecord?.householdId ?? null, displayName: e.displayName, location: e.tabletAddress, yangshang: yang || null });
    }
  }
  suspicious.sort((a, b) => ((a.householdId ?? "") < (b.householdId ?? "") ? -1 : 1));

  return { ok: true, totalSouls: worship.length + entries.length, suspicious };
}
