import Link from "next/link";
import type { ActivityType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canAcceptRegistration } from "@/lib/activityYear";
import { activityTypeLabel } from "@/lib/labels";

/**
 * 首頁「開放報名中的活動・現場快速報名」捷徑。
 * 依「活動設定」的**開放報名＋開始/截止受理日期**判斷(canAcceptRegistration)——
 * 只要該活動報名開放(在受理日期區間內、且開關開),首頁就自動冒出一鍵進報名的按鈕,
 * 不用點進活動頁。報名關閉或過了截止日就不顯示。純唯讀查詢。
 *
 * 涵蓋：補庫、宮燈（名單型 → /roster-register）、年度燈（點燈 → /annual-lantern-register）。
 */
const ROSTER_ACTIVITY_TYPES = ["STORAGE_REPAYMENT", "PALACE_LANTERN", "ANNUAL_LANTERN"] as const;

/** 每種活動的現場報名網址與按鈕字。年度燈走點燈頁；其餘走名單型報名頁。 */
function entryFor(activityType: string, id: string): { href: string; verb: string } {
  if (activityType === "ANNUAL_LANTERN") return { href: `/annual-lantern-register/${id}`, verb: "現場快速點燈" };
  return { href: `/roster-register/${id}`, verb: "現場快速報名" };
}

export default async function HomeInSeasonRosterRegister() {
  let events;
  try {
    events = await prisma.templeEvent.findMany({
      where: { isArchived: false, activityType: { in: ROSTER_ACTIVITY_TYPES as unknown as ActivityType[] } },
      select: {
        id: true, activityType: true, year: true, name: true,
        registrationStartAt: true, registrationEndAt: true, solarDate: true,
        isRegistrationOpen: true, isPrintOpen: true, isCompleted: true, isArchived: true, status: true,
      },
    });
  } catch {
    return null; // 查詢失敗不影響首頁其他區塊
  }

  const now = new Date();
  const open = events.filter((e) =>
    canAcceptRegistration(
      {
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
      },
      now
    ).ok
  );
  if (open.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {open.map((e) => {
        const { href, verb } = entryFor(e.activityType, e.id);
        return (
          <Link
            key={e.id}
            href={href}
            className="rounded-full bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-card hover:bg-emerald-700"
          >
            🕯️ {verb}（{activityTypeLabel[e.activityType] ?? e.name}）→
          </Link>
        );
      })}
    </div>
  );
}
