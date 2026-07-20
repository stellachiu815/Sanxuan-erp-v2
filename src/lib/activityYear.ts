/**
 * V13.1 指令九／十：**活動年度（Activity Year）的唯一一套判斷機制。**
 *
 * 指令十明確要求「不得為每個模組另外建立互不相容的年份邏輯，應共用同一套
 * 活動年度選擇與判斷機制」。因此普渡、年度燈、宮慶、祭改與其他年度性活動，
 * 一律透過這一支決定要用哪個年度，不得各自寫一份。
 *
 * ── 資料落點 ────────────────────────────────────────────
 * 活動年度掛在既有的 **TempleEvent**（@@unique([activityType, year])），
 * 沒有新建任何「活動年度」資料表。TempleEvent 本來就是「一年度 × 一活動
 * 類型」的主檔，它已經是這個專案的活動年度概念。
 *
 * ⚠️ 不要跟 V1 時代的 `Activity` 資料表搞混——那張表自 2026-07-15 起停用、
 * 沒有任何讀寫，不得在上面擴充。
 *
 * ── 為什麼不能只看今天 ───────────────────────────────────
 * 指令九：「不得只以程式寫死『今天是否超過農曆七月十八』」。
 * 指令十一：年度燈在 115 年底受理 116 年度，此時 today 完全無法決定年度。
 *
 * 所以這支的判斷順序是：
 *   1. 先看**活動實際資料**（是否開放報名、是否完成、是否封存、截止日）
 *   2. 只有在多個年度都符合時，才用今天日期做「挑最接近的那個」的排序
 *   3. 完全沒有可用年度時 → 明確回報，**不偷偷建立不存在的活動**
 */

import { prisma } from "@/lib/prisma";
import type { ActivityType } from "@prisma/client";

/** 一個候選活動年度的完整判斷資料。 */
export type ActivityYearCandidate = {
  templeEventId: string;
  activityType: ActivityType;
  /** 活動使用年度（民國） */
  year: number;
  name: string;
  registrationStartAt: Date | null;
  registrationEndAt: Date | null;
  /** 實際活動日期（國曆） */
  eventDate: Date | null;
  isRegistrationOpen: boolean;
  isPrintOpen: boolean;
  isCompleted: boolean;
  isArchived: boolean;
  status: string;
};

/** 為什麼這個年度被選中／被排除，供畫面顯示，不讓使用者面對一個沒有理由的預設值。 */
export type ActivityYearDecision =
  | {
      ok: true;
      candidate: ActivityYearCandidate;
      /** 選中理由，例如「本年度普渡仍開放報名」 */
      reason: string;
      /** 其他可切換的年度（指令九：允許修改年度） */
      alternatives: ActivityYearCandidate[];
    }
  | {
      ok: false;
      /** 為什麼沒有可用年度 */
      reason: string;
      /** 即使不可用也一併回傳，讓畫面能顯示「已有這些年度，但都不符合」 */
      alternatives: ActivityYearCandidate[];
    };

/** 是否可接受新報名。純函式，方便單獨測試。 */
export function canAcceptRegistration(
  c: ActivityYearCandidate,
  today: Date
): { ok: boolean; reason: string } {
  if (c.isArchived) return { ok: false, reason: "活動已封存" };
  if (c.isCompleted) return { ok: false, reason: "活動已完成" };
  if (c.status === "CANCELLED") return { ok: false, reason: "活動已取消" };
  if (c.status === "CLOSED") return { ok: false, reason: "活動已結案" };
  // 管理者的明確意志優先於日期（指令九：優先使用實際的活動資料）
  if (!c.isRegistrationOpen) return { ok: false, reason: "活動未開放報名" };
  if (c.registrationEndAt && today > c.registrationEndAt) {
    return { ok: false, reason: "已超過截止受理日期" };
  }
  if (c.registrationStartAt && today < c.registrationStartAt) {
    return { ok: false, reason: "尚未到開始受理日期" };
  }
  return { ok: true, reason: "開放報名中" };
}

/** 是否可列印。與報名分開判斷——報名截止後通常仍需補印。 */
export function canPrint(c: ActivityYearCandidate): { ok: boolean; reason: string } {
  if (c.isArchived) return { ok: false, reason: "活動已封存" };
  if (c.status === "CANCELLED") return { ok: false, reason: "活動已取消" };
  if (!c.isPrintOpen) return { ok: false, reason: "活動未開放列印" };
  return { ok: true, reason: "開放列印中" };
}

/**
 * 從候選清單中挑出預設年度（純函式，核心決策邏輯集中在這裡）。
 *
 * 規則（指令九）：
 *   1. 優先挑「目前可接受報名」的年度；有多個時挑**年度最小**的那個
 *      （最接近、最該先處理的那一場，而不是最遠的那一場）
 *   2. 都不能報名時，挑「年度大於等於今年、且未完成未封存」的下一個年度
 *   3. 再沒有 → ok: false，由畫面提示先建立活動
 *
 * @param todayMinguoYear 今天的民國年。只用在規則 2 的排序，**不用來決定
 *        「是否過了農曆七月十八」**——那是指令九明令禁止的寫死判斷。
 */
export function pickDefaultActivityYear(
  candidates: ActivityYearCandidate[],
  today: Date,
  todayMinguoYear: number
): ActivityYearDecision {
  const sorted = [...candidates].sort((a, b) => a.year - b.year);

  // 規則 1：目前開放報名的年度
  const openOnes = sorted.filter((c) => canAcceptRegistration(c, today).ok);
  if (openOnes.length > 0) {
    const picked = openOnes[0];
    return {
      ok: true,
      candidate: picked,
      reason: `民國 ${picked.year} 年${picked.name ? `「${picked.name}」` : ""}目前開放報名`,
      alternatives: sorted.filter((c) => c.templeEventId !== picked.templeEventId),
    };
  }

  // 規則 2：下一個尚未完成、未封存的年度
  const upcoming = sorted.filter(
    (c) =>
      !c.isArchived &&
      !c.isCompleted &&
      c.status !== "CANCELLED" &&
      c.year >= todayMinguoYear
  );
  if (upcoming.length > 0) {
    const picked = upcoming[0];
    return {
      ok: true,
      candidate: picked,
      reason: `本年度已完成或已截止，預設改為下一個已建立的年度：民國 ${picked.year} 年`,
      alternatives: sorted.filter((c) => c.templeEventId !== picked.templeEventId),
    };
  }

  return {
    ok: false,
    reason:
      candidates.length === 0
        ? "尚未建立任何年度活動，請先於活動中心建立活動年度"
        : "既有的活動年度都已完成、已截止或已封存，請先建立新的活動年度",
    alternatives: sorted,
  };
}

/** DB 查詢：取得某活動類型的所有候選年度。 */
export async function listActivityYearCandidates(
  activityType: ActivityType
): Promise<ActivityYearCandidate[]> {
  const events = await prisma.templeEvent.findMany({
    where: { activityType },
    orderBy: { year: "asc" },
  });
  return events.map((e) => ({
    templeEventId: e.id,
    activityType: e.activityType,
    year: e.year,
    name: e.name,
    registrationStartAt: e.registrationStartAt,
    registrationEndAt: e.registrationEndAt,
    eventDate: e.solarDate,
    isRegistrationOpen: e.isRegistrationOpen,
    isPrintOpen: e.isPrintOpen,
    isCompleted: e.isCompleted,
    isArchived: e.isArchived,
    status: e.status,
  }));
}

/**
 * 取得某活動類型的預設年度（指令九、十的對外唯一入口）。
 *
 * 中元普渡、年度燈、宮慶、祭改都呼叫這一支，不各自實作。
 *
 * ⚠️ 這支**絕不建立活動**。若沒有可用年度，回傳 ok:false 由畫面提示
 * 使用者先建立——指令九：「不得偷偷建立不存在的活動」。
 */
export async function resolveDefaultActivityYear(
  activityType: ActivityType,
  now: Date = new Date()
): Promise<ActivityYearDecision> {
  const candidates = await listActivityYearCandidates(activityType);
  const todayMinguoYear = now.getFullYear() - 1911;
  return pickDefaultActivityYear(candidates, now, todayMinguoYear);
}

/**
 * 中元普渡的預設年度（指令九）。
 *
 * 三玄宮固定普渡日為農曆七月十八，但**這個日期只用來建立活動時填寫
 * 活動日期**，不用來在程式裡判斷「今天過了沒」。年度選擇一律依活動資料
 * （是否開放報名／是否完成／截止日），與其他活動類型共用同一套邏輯。
 */
export async function resolveDefaultUniversalSalvationYear(
  now: Date = new Date()
): Promise<ActivityYearDecision> {
  return resolveDefaultActivityYear("UNIVERSAL_SALVATION", now);
}

/** 三玄宮固定普渡日：農曆七月十八。供建立活動時預填活動日期使用。 */
export const UNIVERSAL_SALVATION_LUNAR_MONTH = 7;
export const UNIVERSAL_SALVATION_LUNAR_DAY = 18;
