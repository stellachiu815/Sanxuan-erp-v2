import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findDuplicateMatches, DUPLICATE_MATCH_REASON_LABEL, type DuplicateCandidate, type DuplicateMatch } from "@/lib/devoteeDuplicateMatcher";
import { normalizeNationalId } from "@/lib/nationalId";

/**
 * V12.0「疑似重複信眾」（對應指令「十三」）：從既有 Member/Household/
 * DevoteeProfile 組出比對候選清單，交給 devoteeDuplicateMatcher.ts 的
 * 純函式做實際比對。這裡「只查詢、不合併」——沒有任何合併資料的函式，
 * 呼叫端只能取得比對結果做人工確認。
 */

export type DuplicateGroupView = {
  reason: string;
  reasonLabel: string;
  members: { memberId: string; name: string; householdId: string; householdName: string }[];
};

export async function listSuspectedDuplicateDevotees(): Promise<DuplicateGroupView[]> {
  const members = await prisma.member.findMany({
    where: { deletedAt: null, household: { deletedAt: null } },
    include: { household: { select: { id: true, name: true, phone: true, address: true } }, devoteeProfile: { select: { mobile: true } } },
  });

  const candidates: DuplicateCandidate[] = members.map((m) => ({
    memberId: m.id,
    name: m.name,
    phone: m.devoteeProfile?.mobile || m.household.phone || null,
    address: m.household.address || null,
    // V12.2 Smoke test 修正：這裡原本自己內嵌一份 birthdayKey 組法，跟建立前
    // 比對那條路徑各寫一份，是這次時區差一天問題能長期潛伏的原因之一。改成
    // 兩條路徑共用同一個 buildBirthdayKey()，行為完全一致。
    birthdayKey: buildBirthdayKey(m),
    householdId: m.householdId,
  }));

  const matches = findDuplicateMatches(candidates);

  const householdNameMap = new Map(members.map((m) => [m.householdId, m.household.name]));
  const nameMap = new Map(members.map((m) => [m.id, m.name]));

  // 依 reason 分組顯示，每一組列出兩位信眾（畫面可以自行合併同一組多筆配對）。
  const groups: DuplicateGroupView[] = matches.map((m: DuplicateMatch) => ({
    reason: m.reason,
    reasonLabel: DUPLICATE_MATCH_REASON_LABEL[m.reason],
    members: [
      { memberId: m.a.memberId, name: nameMap.get(m.a.memberId) ?? m.a.name, householdId: m.a.householdId, householdName: householdNameMap.get(m.a.householdId) ?? "" },
      { memberId: m.b.memberId, name: nameMap.get(m.b.memberId) ?? m.b.name, householdId: m.b.householdId, householdName: householdNameMap.get(m.b.householdId) ?? "" },
    ],
  }));

  return groups;
}

// ============================================================
// V12.2「信眾建立與查詢中心」指令「二、建立前重複提醒」
// ============================================================

/** 建立前比對時，回傳給畫面的辨識資訊（指令「二」逐項要求的欄位）。 */
export type PreCreateDuplicateView = {
  memberId: string;
  name: string;
  householdId: string;
  householdName: string;
  /** 個人手機優先，其次家戶電話——跟既有比對規則採用的「電話」定義一致。 */
  phone: string | null;
  address: string | null;
  birthdayDisplay: string | null;
  reasons: string[];
};

/**
 * 把一位成員（或一組即將建立的資料）轉成比對用的候選格式。
 * 這裡是既有 listSuspectedDuplicateDevotees() 內原本就有的組法，抽出來讓
 * 「離線清單」與「建立前提醒」共用同一套欄位定義，避免兩邊對「電話要用
 * 哪一個欄位」「生日 key 怎麼組」產生分歧。
 */
/**
 * 把「只有日期、沒有時間意義」的 solarBirthDate 轉成穩定的 yyyy-MM-dd。
 *
 * ⚠️ V12.2 Smoke test 修正：原本這裡直接用 `toISOString().slice(0, 10)`，
 * 在 Asia/Taipei（UTC+8）會出現差一天的問題，導致「同名＋同生日」永遠比不中：
 *
 *   新輸入（parseSolarDateString 用 Date.UTC 建立）
 *     → 1990-05-10T00:00:00Z → toISOString → "1990-05-10"
 *   既有資料（Prisma @db.Date 依驅動／連線時區可能回本地午夜）
 *     → 1990-05-09T16:00:00Z → toISOString → "1990-05-09"   ← 差一天
 *
 * 兩邊來源不同（一邊是剛解析的輸入、一邊是資料庫讀回），只要其中一邊是
 * 本地午夜就會錯開。離線的「疑似重複清單」不會踩到，是因為它兩邊都來自
 * 資料庫、偏移一致；建立前比對是這次新增的路徑，才會暴露這個問題。
 *
 * 修正方式：date-only 的值，正確的那一種解讀一定落在「午夜」。因此先看
 * UTC 時間是不是午夜，是就用 UTC 曆法欄位，不是就用本地曆法欄位。兩種
 * 儲存慣例都能得到同一個日曆日期，也不受伺服器時區影響。
 *
 * ⚠️ 這是「格式正規化」，沒有動到 devoteeDuplicateMatcher.ts 的比對演算法
 * （指令「七」：不得修改重複比對演算法本身）。
 */
export function toCalendarDateKey(d: Date): string {
  const isUtcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  const y = isUtcMidnight ? d.getUTCFullYear() : d.getFullYear();
  const m = (isUtcMidnight ? d.getUTCMonth() : d.getMonth()) + 1;
  const day = isUtcMidnight ? d.getUTCDate() : d.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function buildBirthdayKey(m: {
  solarBirthDate: Date | null;
  lunarBirthYear: number | null;
  lunarBirthMonth: number | null;
  lunarBirthDay: number | null;
  lunarIsLeapMonth: boolean;
}): string | null {
  if (m.solarBirthDate) return `solar:${toCalendarDateKey(m.solarBirthDate)}`;
  if (m.lunarBirthYear && m.lunarBirthMonth && m.lunarBirthDay) {
    return `lunar:${m.lunarBirthYear}-${m.lunarBirthMonth}-${m.lunarBirthDay}-${m.lunarIsLeapMonth}`;
  }
  return null;
}

export type PreCreateDuplicateInput = {
  name: string;
  /** 個人手機（優先）或家戶電話 */
  phone?: string | null;
  address?: string | null;
  solarBirthDate?: Date | null;
  lunarBirthYear?: number | null;
  lunarBirthMonth?: number | null;
  lunarBirthDay?: number | null;
  lunarIsLeapMonth?: boolean;
  /**
   * V13.1 指令十四：身分證字號。這是**最強的比對訊號**——身分證相同幾乎
   * 可以確定是同一個人。但仍然只提醒、不自動合併（指令十四明令
   * 「不得自動合併不同的人」）。
   */
  nationalId?: string | null;
  /**
   * 已經確定要加入的家戶（模式 A）。有帶的時候，既有的
   * SAME_HOUSEHOLD_SAME_NAME 規則才有意義——「同一戶裡已經有一位同名的人」
   * 是最需要提醒的情況（例如不小心把同一位家人加了兩次）。建立新家戶
   * （模式 B）時不會有這個值。
   */
  householdId?: string | null;
};

/**
 * 建立信眾**之前**的疑似重複比對。
 *
 * ⚠️ 這支只回傳「疑似重複的既有信眾清單」，**不做任何阻擋、不做任何合併**
 * （指令「二」：不可只用姓名阻止建立、不可自動合併資料；裁決事項：疑似
 * 重複只提醒，由操作者決定是否繼續）。
 *
 * ⚠️ 比對規則完全沿用既有的 findDuplicateMatches()，**沒有修改比對演算法
 * 本身**（指令「九、明確不做」）。作法是把「即將建立的這一筆」當成一個
 * 虛擬候選（memberId 用一個不可能存在的哨兵值），跟既有信眾一起丟進同一個
 * 比對函式，再只挑出與這筆虛擬候選配對的結果。
 *
 * 效能考量：離線清單頁是 O(n²) 全量兩兩比對，這裡是高頻的建立流程，不能
 * 那樣做。因此先用資料庫把候選範圍縮小到「同名、或同電話、或同地址」的
 * 成員（這已經涵蓋三條規則的必要條件——三條規則都要求姓名相同，第四條
 * SAME_PHONE_DIFFERENT_NAME 則要求電話相同），再對這個很小的集合做比對。
 */
export async function findPreCreateDuplicates(
  input: PreCreateDuplicateInput
): Promise<PreCreateDuplicateView[]> {
  const name = input.name.trim();
  if (!name) return [];

  const phone = input.phone?.trim() || null;
  const address = input.address?.trim() || null;
  // V13.1 指令十四：身分證納入比對。空白不比對——大量信眾的身分證是 null，
  // 若把 null 當成「相同」會讓每一位新信眾都跟所有沒填身分證的人配對成功。
  const nationalId = normalizeNationalId(input.nationalId);

  // 縮小候選範圍：同名 OR 同電話 OR 同地址。三條「同名＋X」規則都要求同名，
  // 所以同名這一條就足以涵蓋；另外兩條是為了讓「電話相同但姓名不同」這種
  // 既有規則也能在建立前被提醒到。
  const or: Prisma.MemberWhereInput[] = [{ name }];
  if (phone) {
    or.push({ devoteeProfile: { is: { mobile: phone } } });
    or.push({ household: { phone } });
  }
  if (address) or.push({ household: { address } });
  // 身分證相同：即使姓名、電話、地址全都不同也要提醒（改名、搬家的情況）
  if (nationalId) or.push({ nationalId });

  const nearby = await prisma.member.findMany({
    where: { deletedAt: null, household: { deletedAt: null }, OR: or },
    include: {
      household: { select: { id: true, name: true, phone: true, address: true } },
      devoteeProfile: { select: { mobile: true } },
    },
    take: 50, // 建立流程是高頻操作，候選數量設上限避免極端資料拖慢送出
  });

  if (nearby.length === 0) return [];

  const NEW_ID = "__pending_new_member__"; // 哨兵值，不會與真實 cuid 衝突

  const existing: DuplicateCandidate[] = nearby.map((m) => ({
    memberId: m.id,
    name: m.name,
    phone: m.devoteeProfile?.mobile || m.household.phone || null,
    address: m.household.address || null,
    birthdayKey: buildBirthdayKey(m),
    householdId: m.householdId,
  }));

  const pending: DuplicateCandidate = {
    name,
    phone,
    address,
    birthdayKey: buildBirthdayKey({
      solarBirthDate: input.solarBirthDate ?? null,
      lunarBirthYear: input.lunarBirthYear ?? null,
      lunarBirthMonth: input.lunarBirthMonth ?? null,
      lunarBirthDay: input.lunarBirthDay ?? null,
      lunarIsLeapMonth: input.lunarIsLeapMonth ?? false,
    }),
    memberId: NEW_ID,
    // 模式 A 已經選好家戶時帶入真實家戶編號，讓既有的
    // SAME_HOUSEHOLD_SAME_NAME 規則能正確發揮作用；模式 B（新家戶）還沒有
    // 家戶，用哨兵值避免誤觸該規則。
    householdId: input.householdId || "__pending__",
  };

  const matches = findDuplicateMatches([pending, ...existing]);

  // 只保留「與即將建立的這一筆」有關的配對。
  const byMemberId = new Map<string, PreCreateDuplicateView>();
  const memberMap = new Map(nearby.map((m) => [m.id, m]));

  for (const match of matches) {
    const involvesPending = match.a.memberId === NEW_ID || match.b.memberId === NEW_ID;
    if (!involvesPending) continue;

    const other = match.a.memberId === NEW_ID ? match.b : match.a;
    const source = memberMap.get(other.memberId);
    if (!source) continue;

    const reasonLabel = DUPLICATE_MATCH_REASON_LABEL[match.reason];
    const found = byMemberId.get(other.memberId);
    if (found) {
      if (!found.reasons.includes(reasonLabel)) found.reasons.push(reasonLabel);
      continue;
    }

    byMemberId.set(other.memberId, {
      memberId: source.id,
      name: source.name,
      householdId: source.householdId,
      householdName: source.household.name,
      phone: source.devoteeProfile?.mobile || source.household.phone || null,
      address: source.household.address || null,
      birthdayDisplay: source.solarBirthDate
        ? toCalendarDateKey(source.solarBirthDate)
        : source.lunarBirthYear && source.lunarBirthMonth && source.lunarBirthDay
          ? `農曆 ${source.lunarBirthYear}/${source.lunarBirthMonth}/${source.lunarBirthDay}${source.lunarIsLeapMonth ? "（閏）" : ""}`
          : null,
      reasons: [reasonLabel],
    });
  }

  /**
   * V13.1 指令十四：身分證相同 → 一律列為疑似重複。
   *
   * 這一段刻意**獨立於 findDuplicateMatches()** 之外處理，理由有兩個：
   * 1. 不修改既有的比對演算法本身（V12.2 的既定約束，其他呼叫端依賴它）。
   * 2. 身分證相同的訊號比「同名＋同生日」更強，即使姓名完全不同也要提醒
   *    ——改名、婚後冠夫姓、Excel 打錯字都會造成同一個人姓名不同。
   *    這種情況 findDuplicateMatches 的規則（全部要求同名）不會命中。
   *
   * 依然只是提醒，不阻擋、不自動合併。
   */
  if (nationalId) {
    for (const m of nearby) {
      if (normalizeNationalId(m.nationalId) !== nationalId) continue;
      const label = "身分證字號相同";
      const found = byMemberId.get(m.id);
      if (found) {
        if (!found.reasons.includes(label)) found.reasons.unshift(label);
        continue;
      }
      byMemberId.set(m.id, {
        memberId: m.id,
        name: m.name,
        householdId: m.householdId,
        householdName: m.household.name,
        phone: m.devoteeProfile?.mobile || m.household.phone || null,
        address: m.household.address || null,
        birthdayDisplay: m.solarBirthDate
          ? toCalendarDateKey(m.solarBirthDate)
          : m.lunarBirthYear && m.lunarBirthMonth && m.lunarBirthDay
            ? `農曆 ${m.lunarBirthYear}/${m.lunarBirthMonth}/${m.lunarBirthDay}${m.lunarIsLeapMonth ? "（閏）" : ""}`
            : null,
        reasons: [label],
      });
    }
  }

  return [...byMemberId.values()];
}
