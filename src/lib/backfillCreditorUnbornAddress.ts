import { prisma } from "@/lib/prisma";

/**
 * V38 回填「冤親／無緣子女」牌位的空白地址。
 *
 * 背景：舊版 createUniversalSalvationEntry 把冤親（DEBT_CREDITOR）／無緣（UNBORN_CHILD）
 * 排除在地址自動帶入之外，導致手動報名這兩類時牌位地址一片空白（例：許佩瑜冤親、馮是嘉無緣）。
 * V38 已修好新報名；這支負責把**既有的空白**一次補上，不必刪掉重報。
 *
 * 補入來源（與新報名一致）：陽上人[0] 的個人地址（同戶、有地址的成員）→ 家戶地址。
 * 只補「目前空白」的牌位；已有地址者不動。不動名稱、不動收款、不重報。
 *
 * commit=false（預設）＝預覽；commit=true ＝實際寫入 entry.tabletAddress。
 */

export type CreditorUnbornAddrChange = {
  entryId: string;
  householdId: string;
  category: string;
  displayName: string;
  yangshang: string | null;
  newAddress: string;
  source: "陽上人個人地址" | "家戶地址";
};

export type BackfillCreditorUnbornReport = {
  ok: boolean;
  commit: boolean;
  year: number;
  totalBlank: number;
  changes: CreditorUnbornAddrChange[];
  stillBlank: number;
  error?: string;
};

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s/g, "").trim();

export async function backfillCreditorUnbornAddress(
  year: number,
  opts: { commit: boolean }
): Promise<BackfillCreditorUnbornReport> {
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
      tabletAddress: true,
      yangshangName: true,
      yangshangNames: true,
      universalSalvation: { select: { ritualRecord: { select: { householdId: true } } } },
    },
  });

  // 只處理「目前空白」的。
  const blanks = entries.filter((e) => !norm(e.tabletAddress));

  const householdIds = [
    ...new Set(blanks.map((e) => e.universalSalvation?.ritualRecord?.householdId).filter((x): x is string => !!x)),
  ];

  const households = householdIds.length
    ? await prisma.household.findMany({ where: { id: { in: householdIds } }, select: { id: true, address: true } })
    : [];
  const hhAddr = new Map(households.map((h) => [h.id, h.address]));

  // 這些戶「有地址」的成員（供依陽上人姓名帶入個人地址）。
  const members = householdIds.length
    ? await prisma.member.findMany({
        where: { householdId: { in: householdIds }, deletedAt: null, address: { not: null } },
        select: { householdId: true, name: true, address: true },
      })
    : [];
  const memberAddr = new Map<string, string>();
  for (const m of members) {
    const key = `${m.householdId}|${norm(m.name)}`;
    if (!memberAddr.has(key) && norm(m.address)) memberAddr.set(key, (m.address as string).trim());
  }

  const changes: CreditorUnbornAddrChange[] = [];
  let stillBlank = 0;
  for (const e of blanks) {
    const hh = e.universalSalvation?.ritualRecord?.householdId;
    if (!hh) { stillBlank++; continue; }
    const yName = norm((Array.isArray(e.yangshangNames) && e.yangshangNames[0]) || e.yangshangName || "");
    let addr: string | null = null;
    let source: CreditorUnbornAddrChange["source"] = "家戶地址";
    if (yName) {
      const personal = memberAddr.get(`${hh}|${yName}`);
      if (personal) { addr = personal; source = "陽上人個人地址"; }
    }
    if (!addr) {
      const ha = hhAddr.get(hh);
      if (ha && norm(ha)) { addr = ha.trim(); source = "家戶地址"; }
    }
    if (!addr) { stillBlank++; continue; }
    changes.push({
      entryId: e.id,
      householdId: hh,
      category: e.category,
      displayName: e.displayName,
      yangshang: yName || null,
      newAddress: addr,
      source,
    });
  }
  changes.sort((a, b) => (a.householdId < b.householdId ? -1 : 1));

  const base: BackfillCreditorUnbornReport = {
    ok: true,
    commit,
    year,
    totalBlank: blanks.length,
    changes,
    stillBlank,
  };
  if (!commit || changes.length === 0) return base;

  await prisma.$transaction(
    changes.map((c) => prisma.universalSalvationEntry.update({ where: { id: c.entryId }, data: { tabletAddress: c.newAddress } }))
  );
  return base;
}
