import { prisma } from "@/lib/prisma";
import { solarToLunar } from "@/lib/lunar";

/**
 * V12.0「生日提醒」（對應指令「十」）。
 *
 * ⚠️ 誠實揭露農曆換算的實際能力範圍（指令「十」明確要求，不得假裝換算
 * 完全正確）：
 *
 * 系統已經有 src/lib/lunar.ts，底層使用真正的 lunar-javascript 函式庫
 * （支援閏月/干支/生肖），不是簡化或錯誤的自製演算法——這不是本輪新寫的
 * 東西，是既有「生日與農曆中心」（V5.0）就已經在用的同一套換算邏輯，
 * 這裡直接沿用，沒有另外做一套。
 *
 * 但即使底層函式庫是正確的，這裡仍然只做「有把握」的兩件事，刻意不做
 * 「農曆生日精準換算成今年對應的國曆日期」這件更複雜的事：
 *
 * 1. 「本月農曆生日」——單純比對 Member.lunarBirthMonth 是否等於今天換算
 *    出來的農曆月份，這是儲存的農曆月日直接比對，可靠。
 * 2. 「今日國曆生日」「未來七日國曆生日」——只針對「本來就有登記國曆生日
 *    （solarBirthDate）」的信眾計算，用月/日比對是否落在區間內，這是純
 *    國曆比對，不牽涉農曆換算，可靠。
 * 3. 「只有農曆生日、沒有國曆生日」的信眾——不會出現在「今日國曆生日」
 *    「未來七日國曆生日」這兩份名單裡。原因：把一個農曆月日換算成「今年
 *    對應的國曆日期」需要處理農曆新年跨年、閏月是否存在等邊界情況，這裡
 *    沒有能力在這個沙盒環境（無法安裝 lunar-javascript、無法實際執行
 *    測試）驗證這類邊界換算的正確性，依指令原文「不得假裝換算完全正確」
 *    ，選擇不做這個換算，而不是做一個沒把握、可能算錯的版本。這些信�众
 *    仍然會出現在「本月農曆生日」名單裡（見上面第 1 點），只是不會出現
 *    在以國曆日期為準的兩份名單。
 *
 * 往生信眾一律不出現在任何生日提醒名單（對應指令「十、往生及停用信眾
 * 預設不出現在生日提醒中」）。這裡一併排除已停用（isDisabled）的信眾，
 * 這是本輪的設計判斷（停用的信眾不太需要主動生日關懷），非逐字規定。
 */

export type BirthdayEntry = {
  memberId: string;
  name: string;
  householdId: string;
  householdName: string;
  contact: string | null;
  solarBirthDate: string | null;
  lunarBirthDisplay: string | null;
};

async function eligibleMembersBase() {
  return prisma.member.findMany({
    where: {
      deletedAt: null,
      isDeceased: false,
      household: { deletedAt: null },
      OR: [{ solarBirthDate: { not: null } }, { lunarBirthMonth: { not: null } }],
    },
    include: {
      household: { select: { id: true, name: true, phone: true } },
      devoteeProfile: { select: { isDisabled: true, mobile: true } },
    },
  });
}

function toEntry(m: Awaited<ReturnType<typeof eligibleMembersBase>>[number]): BirthdayEntry {
  return {
    memberId: m.id,
    name: m.name,
    householdId: m.householdId,
    householdName: m.household.name,
    contact: m.devoteeProfile?.mobile || m.household.phone || null,
    solarBirthDate: m.solarBirthDate ? m.solarBirthDate.toISOString().slice(0, 10) : null,
    lunarBirthDisplay:
      m.lunarBirthMonth && m.lunarBirthDay
        ? `農曆${m.lunarIsLeapMonth ? "閏" : ""}${m.lunarBirthMonth}月${m.lunarBirthDay}日`
        : null,
  };
}

/** 「今日國曆生日」「未來七日國曆生日」共用：只看已登記 solarBirthDate 的信眾。 */
async function listSolarBirthdaysInWindow(startOffsetDays: number, endOffsetDays: number, now: Date): Promise<BirthdayEntry[]> {
  const members = await eligibleMembersBase();
  const results: BirthdayEntry[] = [];

  for (const m of members) {
    if (m.devoteeProfile?.isDisabled) continue;
    if (!m.solarBirthDate) continue;

    const bMonth = m.solarBirthDate.getUTCMonth();
    const bDay = m.solarBirthDate.getUTCDate();

    for (let offset = startOffsetDays; offset <= endOffsetDays; offset++) {
      const check = new Date(now);
      check.setUTCHours(0, 0, 0, 0);
      check.setUTCDate(check.getUTCDate() + offset);
      if (check.getUTCMonth() === bMonth && check.getUTCDate() === bDay) {
        results.push(toEntry(m));
        break;
      }
    }
  }
  return results;
}

export async function listTodaySolarBirthdays(now: Date = new Date()): Promise<BirthdayEntry[]> {
  return listSolarBirthdaysInWindow(0, 0, now);
}

export async function listUpcoming7DaySolarBirthdays(now: Date = new Date()): Promise<BirthdayEntry[]> {
  return listSolarBirthdaysInWindow(0, 7, now);
}

export async function listThisMonthSolarBirthdays(now: Date = new Date()): Promise<BirthdayEntry[]> {
  const members = await eligibleMembersBase();
  const currentMonth = now.getUTCMonth();
  return members
    .filter((m) => !m.devoteeProfile?.isDisabled && m.solarBirthDate && m.solarBirthDate.getUTCMonth() === currentMonth)
    .map(toEntry);
}

/** 「本月農曆生日」：直接比對儲存的農曆月份，見上方檔案說明第 1 點。 */
export async function listThisMonthLunarBirthdays(now: Date = new Date()): Promise<BirthdayEntry[]> {
  const currentLunarMonth = solarToLunar(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))).month;
  const members = await eligibleMembersBase();
  return members
    .filter((m) => !m.devoteeProfile?.isDisabled && m.lunarBirthMonth === currentLunarMonth)
    .map(toEntry);
}

/**
 * 「今日農曆生日」（V11.2 首頁 Dashboard 新增，需求「一、今日生日」）。
 *
 * 沿用上面「本月農曆生日」同一套可靠比對方式（同樣用 solarToLunar() 這個
 * 既有、單一集中管理的換算函式，沒有另外寫一套換算邏輯），只是把比對範圍
 * 從「月份是否相同」再收斂到「月、日（含是否閏月）是否都相同」——這仍然
 * 是「儲存的農曆月日 vs 今天換算出的農曆月日」直接比對，不涉及「把農曆
 * 生日換算成今年對應的國曆日期」那個檔案開頭說明中刻意不做的複雜運算，
 * 可靠程度與既有的月份比對一致。
 */
export async function listTodayLunarBirthdays(now: Date = new Date()): Promise<BirthdayEntry[]> {
  const todayLunar = solarToLunar(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  const members = await eligibleMembersBase();
  return members
    .filter(
      (m) =>
        !m.devoteeProfile?.isDisabled &&
        m.lunarBirthMonth === todayLunar.month &&
        m.lunarBirthDay === todayLunar.day &&
        Boolean(m.lunarIsLeapMonth) === todayLunar.isLeapMonth
    )
    .map(toEntry);
}
