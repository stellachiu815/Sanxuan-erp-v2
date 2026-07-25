"use client";

import { useState } from "react";
import Link from "next/link";
import { primaryButtonClass } from "@/components/household/formStyles";
import { activityTypeLabel, templeEventStatusLabel } from "@/lib/labels";
import ActivityWizard from "./ActivityWizard";

type EventItem = { id: string; activityType: string; year: number; name: string; status: string };

/** V15R4 年度燈統一（方案A）：這四個活動類型同屬「年度燈」群組，畫面標示為同一年度活動。 */
const ANNUAL_LANTERN_MEMBERS = new Set(["GUANGMING_LANTERN", "TAISUI_LANTERN", "FAMILY_LANTERN", "PURIFICATION"]);

export default function ActivityListScreen({ initialEvents }: { initialEvents: EventItem[] }) {
  const [showWizard, setShowWizard] = useState(false);
  const [events] = useState(initialEvents);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-medium text-ink">活動管理</h1>
        <button type="button" className={primaryButtonClass} onClick={() => setShowWizard(true)}>
          ＋ 建立宮務活動
        </button>
      </div>

      {events.length === 0 ? (
        <p className="rounded-2xl bg-white/70 p-8 text-center text-sm text-ink-soft shadow-soft">
          目前還沒有任何宮務活動，請先建立第一個活動。
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => (
            <li key={e.id}>
              <Link
                href={e.activityType === "PURIFICATION" ? `/purification/${e.id}` : `/activities/${e.id}`}
                className="block rounded-2xl bg-white/70 p-6 shadow-soft transition hover:shadow-card"
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    {ANNUAL_LANTERN_MEMBERS.has(e.activityType) && (
                      <span className="rounded-full bg-yolk-100 px-2 py-1 text-xs text-ink-soft">年度燈</span>
                    )}
                    <span className="rounded-full bg-mist-100 px-3 py-1 text-xs text-ink-soft">
                      {activityTypeLabel[e.activityType] ?? e.activityType}
                    </span>
                  </span>
                  <span className="rounded-full bg-sage-100 px-3 py-1 text-xs text-ink-soft">
                    {templeEventStatusLabel[e.status] ?? e.status}
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-medium text-ink">{e.name}</h3>
                <p className="mt-1 text-xs text-ink-faint">民國 {e.year} 年度</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {showWizard && <ActivityWizard existingEvents={events} onClose={() => setShowWizard(false)} />}
    </div>
  );
}
