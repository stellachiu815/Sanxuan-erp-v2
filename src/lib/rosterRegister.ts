import { prisma } from "@/lib/prisma";
import { createHousehold } from "@/lib/householdManagement";
import { createMemberForHousehold } from "@/lib/memberCreate";
import { registerItemsBatch, type BatchItemEntry } from "@/lib/registrationItemRegistration";
import { confirmRegistration } from "@/lib/activityRegistration";
import type { Role } from "@/lib/permissions";

/**
 * 名單型（贊普型）報名引擎——補庫／宮燈等「選人、一人一份 × 固定單價、姓名總名單」共用。
 *
 * 快速報名(現場)與公開報名(對外)**共用這一支**;公開報名一律建草稿、由廟方確認(confirm)。
 * 完全重用既有、已驗證的零件:createHousehold／createMemberForHousehold(新信眾自動建檔)、
 * registerItemsBatch(建報名+固定價計價)、confirmRegistration(草稿→正式)。不另建第二套。
 *
 * 一位報名者可幫家人朋友報(people 多筆);既有信眾帶 existingMemberId、新信眾直接填姓名等,
 * 系統當場建檔。金額＝固定單價 × 份數(quantity;預設 1)。
 */

/** 活動類型 → 名單型報名項目 key(宮燈新增活動類型後在此加一行即可)。 */
const ROSTER_ITEM_KEY: Record<string, string> = {
  STORAGE_REPAYMENT: "STORAGE_TROUSERS",
  PALACE_LANTERN: "PALACE_LANTERN",
};

export type RosterPerson = {
  /** 既有信眾:直接用這位(不再新建)。 */
  existingMemberId?: string | null;
  /** 新信眾:姓名(existingMemberId 為空時必填)。 */
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  birthdayType?: "SOLAR" | "LUNAR" | null;
  solarBirthDate?: string | null;
  lunarBirthYear?: number | null;
  lunarBirthMonth?: number | null;
  lunarBirthDay?: number | null;
  lunarIsLeapMonth?: boolean | null;
  /** 份數(預設 1)。 */
  quantity?: number | null;
};

export type RosterRegInput = {
  templeEventId: string;
  /** 報名項目 key;省略時依活動類型自動決定(補庫→STORAGE_TROUSERS)。 */
  itemKey?: string | null;
  people: RosterPerson[];
  /** 送出後是否立即確認(草稿→正式);公開報名一般 false(留草稿人工確認)。 */
  confirm?: boolean;
};

export type RosterRegResult =
  | { ok: true; created: number; ritualRecordIds: string[]; confirmed: number; confirmErrors: string[] }
  | { ok: false; status: number; error: string };

function s(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

export async function rosterRegister(
  input: RosterRegInput,
  operator: { id: string; name: string; role: Role }
): Promise<RosterRegResult> {
  const event = await prisma.templeEvent.findUnique({
    where: { id: input.templeEventId },
    select: { id: true, activityType: true, year: true },
  });
  if (!event) return { ok: false, status: 404, error: "找不到這個活動" };
  const year = event.year;

  const itemKey = s(input.itemKey) ?? ROSTER_ITEM_KEY[event.activityType];
  if (!itemKey) return { ok: false, status: 400, error: "這個活動尚未支援名單型報名" };

  const itemType = await prisma.registrationItemType.findUnique({
    where: { key: itemKey },
    select: { id: true },
  });
  if (!itemType) return { ok: false, status: 404, error: "找不到報名項目設定" };

  const people = (input.people ?? []).filter((p) => p.existingMemberId || s(p.name));
  if (people.length === 0) return { ok: false, status: 400, error: "請至少填一位報名者" };

  // 報名必填：姓名、生日、地址（電話選填）。缺任一不建立、不確認——與「缺必備資料不能確認報名」一致。
  const hasBirth = (p: RosterPerson): boolean =>
    !!s(p.solarBirthDate) || (p.lunarBirthYear != null && p.lunarBirthMonth != null && p.lunarBirthDay != null);

  // 逐位解析既有 / 建立新信眾 → 組 BatchItemEntry(每位一筆固定價項目)。
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
      // 既有信眾也要資料齊全：生日＋地址（個人地址或家戶地址）。缺就擋，請先到信眾頁補齊。
      const mHasBirth = !!m.solarBirthDate || (m.lunarBirthYear != null && m.lunarBirthMonth != null && m.lunarBirthDay != null);
      const mHasAddress = !!s(m.address) || !!s(m.household?.address ?? null);
      const miss: string[] = [];
      if (!mHasBirth) miss.push("生日");
      if (!mHasAddress) miss.push("地址");
      if (miss.length > 0) {
        return { ok: false, status: 400, error: `「${m.name}」還缺：${miss.join("、")}。請先到信眾頁補齊後再報名（報名需要姓名、生日、地址）。` };
      }
      memberId = m.id;
      householdId = m.householdId;
    } else {
      // 新填的信眾：姓名、生日、地址都要齊。
      const miss: string[] = [];
      if (!s(p.name)) miss.push("姓名");
      if (!hasBirth(p)) miss.push("生日");
      if (!s(p.address)) miss.push("地址");
      if (miss.length > 0) {
        return { ok: false, status: 400, error: `「${s(p.name) ?? "新報名者"}」還缺：${miss.join("、")}（報名需要姓名、生日、地址）。` };
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
          birthdayType: p.birthdayType ?? undefined,
          solarBirthDate: p.solarBirthDate ?? undefined,
          lunarBirthYear: p.lunarBirthYear ?? undefined,
          lunarBirthMonth: p.lunarBirthMonth ?? undefined,
          lunarBirthDay: p.lunarBirthDay ?? undefined,
          lunarIsLeapMonth: p.lunarIsLeapMonth ?? undefined,
        },
        operator.name,
        "名單型報名：新增信眾"
      );
      memberId = mem.member.id;
    }
    householdIds.add(householdId);
    const qty = Math.max(1, Math.floor(Number(p.quantity ?? 1)) || 1);
    entries.push({ memberId, registrationItemTypeId: itemType.id, year, quantity: qty });
  }

  const res = await registerItemsBatch(entries, operator.name, operator.id);
  if (!res.ok) return { ok: false, status: res.status, error: res.error };

  // 找出各戶建立的 RitualRecord(每戶一筆),供回傳與(選)確認。
  const records = await prisma.ritualRecord.findMany({
    where: { householdId: { in: [...householdIds] }, activityType: event.activityType, year, deletedAt: null },
    select: { id: true },
  });
  const ritualRecordIds = records.map((r) => r.id);

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
