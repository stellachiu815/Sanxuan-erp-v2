import { prisma } from "@/lib/prisma";
import { createHousehold } from "@/lib/householdManagement";
import { createMemberForHousehold } from "@/lib/memberCreate";
import { registerItemsBatch, type BatchItemEntry } from "@/lib/registrationItemRegistration";
import { confirmRegistration } from "@/lib/activityRegistration";
import { loadFamilyEligibleMembers } from "@/lib/familyLantern";
import type { Role } from "@/lib/permissions";

/**
 * 年度燈（光明燈／太歲燈）快速報名＋公開報名引擎——與補庫一樣重用既有零件
 * （createHousehold／createMemberForHousehold／registerItemsBatch／confirmRegistration），不建第二套。
 *
 * 與補庫的差別：一位報名者可選「光明燈」和／或「太歲燈」，各自份數 → 每選一種燈就是一筆項目。
 * 全家燈（家戶層級、需納入家戶成員名單）不在這個簡化入口，走信眾頁的年度燈選單處理。
 *
 * 報名必填：姓名、生日、地址（電話選填）——點燈要算歲數／生肖，缺資料不建立、不確認。
 * 金額＝該年度「年度燈單價設定」的光明／太歲單價 × 份數（未設單價 → 應收 0 → 確認會被擋，先設單價）。
 */

// 年度燈底下可分別報名的「個人項目」：光明燈／太歲燈／祭改（各自獨立，同中元普渡的作法）。
// 全家燈是家戶層級，另走 family。
export const ANNUAL_LANTERN_ITEM_KEYS = ["LANTERN_GUANGMING", "LANTERN_TAISUI", "LANTERN_PURIFICATION"] as const;
export type AnnualLanternItemKey = (typeof ANNUAL_LANTERN_ITEM_KEYS)[number];

export type AnnualLanternPerson = {
  existingMemberId?: string | null;
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  /** 性別（男／女）——祭改小人頭需要；新信眾一併建檔。 */
  gender?: string | null;
  solarBirthDate?: string | null;
  lunarBirthYear?: number | null;
  lunarBirthMonth?: number | null;
  lunarBirthDay?: number | null;
  lunarIsLeapMonth?: boolean | null;
  /** 這位要報的項目與份數，例如 [{ itemKey:"LANTERN_GUANGMING", quantity:1 }, { itemKey:"LANTERN_PURIFICATION" }]。 */
  lanterns: { itemKey: AnnualLanternItemKey; quantity?: number | null }[];
};

/**
 * 全家燈（整戶一份、固定價）。兩種來源二選一：
 *  - existingMemberId：既有信眾 → 全家燈涵蓋「他的整戶」（伺服器重查本戶合格成員全數納入）。
 *  - household + members：新家戶 → 建戶＋逐位建家人（每位需姓名＋生日；地址用家戶地址），全數納入。
 */
export type AnnualLanternFamily = {
  existingMemberId?: string | null;
  household?: { contactName?: string | null; address?: string | null; phone?: string | null } | null;
  members?: { name?: string | null; solarBirthDate?: string | null; gender?: string | null }[] | null;
};

export type AnnualLanternRegInput = {
  templeEventId: string;
  people: AnnualLanternPerson[];
  /** 選填：加報全家燈（整戶一份）。 */
  family?: AnnualLanternFamily | null;
  confirm?: boolean;
};

export type AnnualLanternRegResult =
  | { ok: true; created: number; ritualRecordIds: string[]; confirmed: number; confirmErrors: string[] }
  | { ok: false; status: number; error: string };

function s(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

export async function annualLanternRosterRegister(
  input: AnnualLanternRegInput,
  operator: { id: string; name: string; role: Role }
): Promise<AnnualLanternRegResult> {
  const event = await prisma.templeEvent.findUnique({
    where: { id: input.templeEventId },
    select: { id: true, activityType: true, year: true },
  });
  if (!event) return { ok: false, status: 404, error: "找不到這個活動" };
  if (event.activityType !== "ANNUAL_LANTERN") {
    return { ok: false, status: 400, error: "這個活動不是年度燈" };
  }
  const year = event.year;

  // 光明／太歲／全家燈的報名項目設定 id。
  const itemTypes = await prisma.registrationItemType.findMany({
    where: { key: { in: [...ANNUAL_LANTERN_ITEM_KEYS, "LANTERN_FAMILY"] } },
    select: { id: true, key: true },
  });
  const idByKey = new Map(itemTypes.map((t) => [t.key, t.id]));
  if (!idByKey.get("LANTERN_GUANGMING") || !idByKey.get("LANTERN_TAISUI")) {
    return { ok: false, status: 404, error: "找不到年度燈的報名項目設定" };
  }
  const familyItemId = idByKey.get("LANTERN_FAMILY") ?? null;

  const hasBirth = (p: AnnualLanternPerson): boolean =>
    !!s(p.solarBirthDate) || (p.lunarBirthYear != null && p.lunarBirthMonth != null && p.lunarBirthDay != null);

  // 只留有選燈的人。
  const people = (input.people ?? []).filter(
    (p) => (p.existingMemberId || s(p.name)) && Array.isArray(p.lanterns) && p.lanterns.some((l) => l.itemKey)
  );
  // 全家燈：有既有信眾或有家人名單即算有效。
  const family = input.family ?? null;
  const hasFamily = !!family && (!!s(family.existingMemberId) || (Array.isArray(family.members) && family.members.some((m) => s(m.name))));
  if (people.length === 0 && !hasFamily) {
    return { ok: false, status: 400, error: "請至少填一位報名者並選一種燈，或加報全家燈" };
  }

  const entries: BatchItemEntry[] = [];
  const householdIds = new Set<string>();
  for (const p of people) {
    let memberId: string;
    let householdId: string;
    if (p.existingMemberId) {
      const m = await prisma.member.findFirst({
        where: { id: p.existingMemberId, deletedAt: null },
        select: {
          id: true, householdId: true, name: true,
          solarBirthDate: true, lunarBirthYear: true, lunarBirthMonth: true, lunarBirthDay: true,
          address: true, household: { select: { address: true } },
        },
      });
      if (!m) return { ok: false, status: 404, error: "找不到選取的信眾（可能已被刪除）" };
      const mHasBirth = !!m.solarBirthDate || (m.lunarBirthYear != null && m.lunarBirthMonth != null && m.lunarBirthDay != null);
      const mHasAddress = !!s(m.address) || !!s(m.household?.address ?? null);
      const miss: string[] = [];
      if (!mHasBirth) miss.push("生日");
      if (!mHasAddress) miss.push("地址");
      if (miss.length > 0) {
        return { ok: false, status: 400, error: `「${m.name}」還缺：${miss.join("、")}。請先到信眾頁補齊後再點燈（點燈需要姓名、生日、地址）。` };
      }
      memberId = m.id;
      householdId = m.householdId;
    } else {
      const miss: string[] = [];
      if (!s(p.name)) miss.push("姓名");
      if (!hasBirth(p)) miss.push("生日");
      if (!s(p.address)) miss.push("地址");
      if (miss.length > 0) {
        return { ok: false, status: 400, error: `「${s(p.name) ?? "新報名者"}」還缺：${miss.join("、")}（點燈需要姓名、生日、地址）。` };
      }
      const name = s(p.name) as string;
      const surname = name.charAt(0);
      const hh = await createHousehold(
        { name: surname ? `${surname}家` : name, contactName: name, address: s(p.address), phone: s(p.phone) },
        operator.name
      );
      householdId = hh.household.id;
      const mem = await createMemberForHousehold(
        householdId,
        {
          name,
          isPrimaryContact: true,
          personalAddress: s(p.address),
          gender: s(p.gender) ?? undefined,
          birthdayType: s(p.solarBirthDate) ? "SOLAR" : (p.lunarBirthYear != null ? "LUNAR" : undefined),
          solarBirthDate: p.solarBirthDate ?? undefined,
          lunarBirthYear: p.lunarBirthYear ?? undefined,
          lunarBirthMonth: p.lunarBirthMonth ?? undefined,
          lunarBirthDay: p.lunarBirthDay ?? undefined,
          lunarIsLeapMonth: p.lunarIsLeapMonth ?? undefined,
        },
        operator.name,
        "年度燈報名：新增信眾"
      );
      memberId = mem.member.id;
    }
    householdIds.add(householdId);

    // 這位選的每一種燈各一筆項目（去重：同一種燈只取一筆，份數以最後一筆為準）。
    const seen = new Set<string>();
    for (const l of p.lanterns) {
      const itemId = idByKey.get(l.itemKey);
      if (!itemId || seen.has(l.itemKey)) continue;
      seen.add(l.itemKey);
      const qty = Math.max(1, Math.floor(Number(l.quantity ?? 1)) || 1);
      entries.push({ memberId, registrationItemTypeId: itemId, year, quantity: qty });
    }
  }

  // 全家燈（整戶一份）。既有信眾→全戶納入；新家戶→建戶＋建家人（每位姓名＋生日）全數納入。
  if (hasFamily && family) {
    if (!familyItemId) return { ok: false, status: 404, error: "找不到全家燈的報名項目設定" };
    let anchorMemberId: string;
    let familyHouseholdId: string;
    let includedMemberIds: string[];
    if (s(family.existingMemberId)) {
      const m = await prisma.member.findFirst({
        where: { id: family.existingMemberId as string, deletedAt: null },
        select: { id: true, householdId: true, name: true },
      });
      if (!m) return { ok: false, status: 404, error: "找不到全家燈選取的信眾（可能已被刪除）" };
      const eligible = await loadFamilyEligibleMembers(m.householdId);
      if (eligible.length === 0) return { ok: false, status: 400, error: "這一戶目前沒有可納入全家燈的成員" };
      anchorMemberId = m.id;
      familyHouseholdId = m.householdId;
      includedMemberIds = eligible.map((e) => e.id);
    } else {
      const addr = s(family.household?.address);
      const members = (family.members ?? []).filter((mm) => s(mm.name));
      if (members.length === 0) return { ok: false, status: 400, error: "全家燈請至少填一位家人姓名" };
      if (!addr) return { ok: false, status: 400, error: "全家燈需要地址" };
      for (const mm of members) {
        if (!s(mm.name) || !s(mm.solarBirthDate)) {
          return { ok: false, status: 400, error: `全家燈家人「${s(mm.name) ?? "（未填）"}」缺姓名或生日（點燈需要生日）。` };
        }
      }
      const contactName = s(family.household?.contactName) ?? (s(members[0].name) as string);
      const surname = contactName.charAt(0);
      const hh = await createHousehold(
        { name: surname ? `${surname}家` : contactName, contactName, address: addr, phone: s(family.household?.phone) },
        operator.name
      );
      familyHouseholdId = hh.household.id;
      const createdIds: string[] = [];
      for (let i = 0; i < members.length; i++) {
        const mm = members[i];
        const mem = await createMemberForHousehold(
          familyHouseholdId,
          { name: s(mm.name) as string, isPrimaryContact: i === 0, personalAddress: addr, gender: s(mm.gender) ?? undefined, birthdayType: "SOLAR", solarBirthDate: mm.solarBirthDate ?? undefined },
          operator.name,
          "全家燈報名：新增家人"
        );
        createdIds.push(mem.member.id);
      }
      anchorMemberId = createdIds[0];
      includedMemberIds = createdIds;
    }
    householdIds.add(familyHouseholdId);
    entries.push({ memberId: anchorMemberId, registrationItemTypeId: familyItemId, year, quantity: 1, participantMemberIds: includedMemberIds });
  }

  if (entries.length === 0) return { ok: false, status: 400, error: "請至少選一種燈" };

  const res = await registerItemsBatch(entries, operator.name, operator.id);
  if (!res.ok) return { ok: false, status: res.status, error: res.error };

  const ritualRecordIds = res.ritualRecordIds;

  let confirmed = 0;
  const confirmErrors: string[] = [];
  if (input.confirm) {
    for (const id of ritualRecordIds) {
      const c = await confirmRegistration(id, operator.name);
      if (c.ok) confirmed++;
      else confirmErrors.push(c.error);
    }
  }

  return { ok: true, created: entries.length, ritualRecordIds, confirmed, confirmErrors };
}
