import { prisma } from "@/lib/prisma";

/**
 * V38 回填「冤親／無緣子女」牌位的空白陽上人。
 *
 * 背景：修正部署前建立的冤親／無緣牌位，陽上人存成空的（例：馮是嘉的無緣，地址有、陽上人空）。
 * 修正只讓「之後新報名」自動帶陽上人，不會回頭補舊的。這支負責把既有空白的陽上人一次補上。
 *
 * 來源：該筆報名的「報名人」（RitualParticipant.nameSnapshot，取最早加入的那位）。
 * 只補「目前陽上人空白」的；已有陽上人者不動。不動地址、不動收款、不重報。
 *
 * commit=false（預設）＝預覽；commit=true ＝實際寫入 entry.yangshangNames／yangshangName。
 */

export type YangshangChange = {
  entryId: string;
  householdId: string | null;
  category: string;
  displayName: string;
  newYangshang: string;
  source: "本次報名人";
};
export type BackfillYangshangReport = {
  ok: boolean;
  commit: boolean;
  year: number;
  totalBlank: number;
  changes: YangshangChange[];
  stillBlank: number;
};

const norm = (s: string | null | undefined) => (s ?? "").trim();

export async function backfillCreditorUnbornYangshang(
  year: number,
  opts: { commit: boolean }
): Promise<BackfillYangshangReport> {
  const commit = !!opts.commit;

  const entries = await prisma.universalSalvationEntry.findMany({
    where: {
      deletedAt: null,
      category: { in: ["DEBT_CREDITOR", "UNBORN_CHILD"] },
      universalSalvation: { ritualRecord: { year, activityType: "UNIVERSAL_SALVATION", deletedAt: null } },
    },
    select: {
      id: true,
      category: true,
      displayName: true,
      yangshangName: true,
      yangshangNames: true,
      universalSalvation: { select: { ritualRecord: { select: { id: true, householdId: true } } } },
    },
  });

  // 「陽上人空白」＝ yangshangNames 沒有任一非空、且 yangshangName 也空。
  const blanks = entries.filter(
    (e) => !(Array.isArray(e.yangshangNames) && e.yangshangNames.some((n) => norm(n))) && !norm(e.yangshangName)
  );

  const recordIds = [
    ...new Set(blanks.map((e) => e.universalSalvation?.ritualRecord?.id).filter((x): x is string => !!x)),
  ];

  // 每筆報名「最早加入的報名人」＝報名人本人（供作陽上人）。
  const parts = recordIds.length
    ? await prisma.ritualParticipant.findMany({
        where: { ritualRecordId: { in: recordIds }, deletedAt: null },
        select: { ritualRecordId: true, nameSnapshot: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const firstPartName = new Map<string, string>();
  for (const p of parts) {
    if (!firstPartName.has(p.ritualRecordId) && norm(p.nameSnapshot)) {
      firstPartName.set(p.ritualRecordId, (p.nameSnapshot as string).trim());
    }
  }

  const changes: YangshangChange[] = [];
  let stillBlank = 0;
  for (const e of blanks) {
    const rid = e.universalSalvation?.ritualRecord?.id;
    const name = rid ? firstPartName.get(rid) : undefined;
    if (!name) { stillBlank++; continue; }
    changes.push({
      entryId: e.id,
      householdId: e.universalSalvation?.ritualRecord?.householdId ?? null,
      category: e.category,
      displayName: e.displayName,
      newYangshang: name,
      source: "本次報名人",
    });
  }
  changes.sort((a, b) => ((a.householdId ?? "") < (b.householdId ?? "") ? -1 : 1));

  const base: BackfillYangshangReport = { ok: true, commit, year, totalBlank: blanks.length, changes, stillBlank };
  if (!commit || changes.length === 0) return base;

  await prisma.$transaction(
    changes.map((c) =>
      prisma.universalSalvationEntry.update({
        where: { id: c.entryId },
        data: { yangshangNames: [c.newYangshang], yangshangName: c.newYangshang },
      })
    )
  );
  return base;
}
