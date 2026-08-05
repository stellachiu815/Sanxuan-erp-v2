import { prisma } from "@/lib/prisma";

/**
 * V36.14 家戶地址批次對齊「主要聯絡人」地址（可由瀏覽器 API 觸發）。
 *
 * 規則：每一戶，找到「戶內姓名 = 主要聯絡人(contactName) 且有地址」的信眾(Member)，
 * 把家戶地址(Household.address)更新成該信眾的地址。找不到對應信眾或其無地址 → 略過（不亂填）。
 *
 * commit=false（預設）＝預覽：只回「哪幾戶會從什麼改成什麼」，不寫入。
 * commit=true ＝實際更新 Household.address。不動信眾、不動牌位、不動收款。
 */

export type HouseholdAddrChange = {
  householdId: string;
  householdName: string;
  contactName: string | null;
  oldAddress: string | null;
  newAddress: string;
};
export type SkippedHousehold = { householdId: string; householdName: string; reason: string };

export type AlignHouseholdAddressReport = {
  ok: boolean;
  commit: boolean;
  totalHouseholds: number;
  changes: HouseholdAddrChange[];
  skipped: SkippedHousehold[];
  error?: string;
};

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s/g, "").trim();

export async function alignHouseholdAddress(opts: { commit: boolean; householdId?: string | null }): Promise<AlignHouseholdAddressReport> {
  const commit = !!opts.commit;
  const households = await prisma.household.findMany({
    where: { deletedAt: null, ...(opts.householdId ? { id: opts.householdId } : {}) },
    select: {
      id: true, name: true, contactName: true, address: true,
      members: { where: { deletedAt: null }, select: { name: true, address: true } },
    },
  });

  const changes: HouseholdAddrChange[] = [];
  const skipped: SkippedHousehold[] = [];
  for (const h of households) {
    const contact = (h.contactName ?? "").trim();
    if (!contact) { skipped.push({ householdId: h.id, householdName: h.name, reason: "無主要聯絡人" }); continue; }
    // 戶內姓名等於主要聯絡人、且有地址的信眾。
    const m = h.members.find((mm) => (mm.name ?? "").trim() === contact && norm(mm.address));
    if (!m) { skipped.push({ householdId: h.id, householdName: h.name, reason: "查無同名主要聯絡人信眾或其無地址" }); continue; }
    const newAddr = (m.address ?? "").trim();
    if (norm(newAddr) === norm(h.address)) continue; // 已一致，不需改
    changes.push({ householdId: h.id, householdName: h.name, contactName: contact, oldAddress: h.address, newAddress: newAddr });
  }
  changes.sort((a, b) => (a.householdId < b.householdId ? -1 : 1));

  const base: AlignHouseholdAddressReport = { ok: true, commit, totalHouseholds: households.length, changes, skipped };
  if (!commit || changes.length === 0) return base;

  await prisma.$transaction(
    changes.map((c) => prisma.household.update({ where: { id: c.householdId }, data: { address: c.newAddress } }))
  );
  return base;
}
