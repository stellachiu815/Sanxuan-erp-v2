"use client";

import { useState } from "react";
import Link from "next/link";
import { activityTypeLabel, templeEventStatusLabel } from "@/lib/labels";
import { formatIsoDateToRocCompact } from "@/lib/minguoDate";

/**
 * V17「活動報名首頁」卡片畫面。
 *
 * 只把「目前可報名」的活動放在主要報名區；截止／完成／封存／取消的活動收進
 * 次要「已結束／不可報名」區塊（可再進入活動管理處理）。每張卡直接提供
 * 「開始報名」，導向「搜尋信眾／家戶」步驟並帶上活動 context，不需先進管理頁。
 *
 * ⚠️ 卡片來源是 TempleEvent（server 端已用 canAcceptRegistration 過濾），
 * 不寫死普渡或年度燈個別入口；未來活動精靈建立並開放的活動會自動出現。
 */

type ActivityCard = {
  id: string;
  activityType: string;
  year: number;
  name: string;
  status: string;
  eventDate: string | null;
  canRegister: boolean;
  reason: string;
};

/** V15R4 年度燈統一：這張活動卡代表「年度燈」，卡內可報名子項目如下（顯示用，實際報名仍走既有項目）。 */
const ANNUAL_LANTERN_TYPE = "ANNUAL_LANTERN";
const ANNUAL_LANTERN_ITEMS = ["光明燈", "太歲燈", "全家燈", "祭改"];

/**
 * V17.1 活動日期顯示規則：有正式日期→顯示實際民國日期；無日期（或無法格式化）→「尚未設定」。
 * 不顯示「活動日期」空 placeholder、不猜測、不寫死。資料來源＝TempleEvent.solarDate（現有正式國曆日期欄位）。
 */
function rocDateOrUnset(iso: string | null): string {
  if (!iso) return "尚未設定";
  const s = formatIsoDateToRocCompact(iso);
  return s && s.trim() ? s : "尚未設定";
}

/** 開始報名 → 進入「搜尋信眾／家戶」步驟，並帶上本次要報名的活動 context。 */
function registerHref(a: ActivityCard): string {
  const params = new URLSearchParams({
    registerActivityType: a.activityType,
    registerYear: String(a.year),
    registerName: a.name,
  });
  return `/devotee-center/list?${params.toString()}`;
}

export default function RegistrationHomeScreen({
  openActivities,
  closedActivities,
}: {
  openActivities: ActivityCard[];
  closedActivities: ActivityCard[];
}) {
  const [showClosed, setShowClosed] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium text-ink">活動報名</h1>
          <p className="mt-1 text-sm text-ink-soft">選擇要報名的活動，再搜尋信眾或家戶進行報名。</p>
        </div>
        <Link
          href="/activities"
          className="rounded-full bg-cream-200 px-4 py-2 text-sm text-ink-soft transition hover:bg-cream-300"
        >
          活動管理 →
        </Link>
      </div>

      {openActivities.length === 0 ? (
        <p className="rounded-2xl bg-white/70 p-8 text-center text-sm text-ink-soft shadow-soft">
          目前沒有開放報名的活動。請至「活動管理」建立活動或開放報名。
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {openActivities.map((a) => (
            <li key={a.id} className="flex flex-col rounded-2xl bg-white/70 p-6 shadow-soft transition hover:shadow-card">
              <div className="flex items-center justify-between">
                {/* V17.1：活動類型徽章只顯示一次（activityTypeLabel["ANNUAL_LANTERN"] 已是「年度燈」，
                    不再另加重複的年度燈徽章）。 */}
                <span className="rounded-full bg-mist-100 px-3 py-1 text-xs text-ink-soft">
                  {activityTypeLabel[a.activityType] ?? a.activityType}
                </span>
                <span className="rounded-full bg-sage-100 px-3 py-1 text-xs text-ink-soft">
                  {templeEventStatusLabel[a.status] ?? a.status}
                </span>
              </div>

              <h3 className="mt-3 text-lg font-medium text-ink">{a.name}</h3>
              <p className="mt-1 text-xs text-ink-faint">
                民國 {a.year} 年度　活動日期：{rocDateOrUnset(a.eventDate)}
              </p>

              {a.activityType === ANNUAL_LANTERN_TYPE && (
                <p className="mt-2 text-xs text-ink-soft">可報名項目：{ANNUAL_LANTERN_ITEMS.join("、")}</p>
              )}

              <div className="mt-4 flex-1" />
              <Link
                href={registerHref(a)}
                className="mt-2 inline-flex items-center justify-center rounded-full bg-sage-200 px-5 py-2 text-sm font-medium text-ink transition hover:bg-sage-300"
              >
                開始報名 →
              </Link>
            </li>
          ))}
        </ul>
      )}

      {closedActivities.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowClosed((v) => !v)}
            className="text-sm text-ink-faint underline-offset-4 hover:underline"
          >
            {showClosed ? "收合" : "顯示"}已結束／不可報名的活動（{closedActivities.length}）
          </button>
          {showClosed && (
            <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {closedActivities.map((a) => (
                <li key={a.id} className="rounded-2xl bg-cream-50 p-5 shadow-soft">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-mist-100 px-3 py-1 text-xs text-ink-soft">
                      {activityTypeLabel[a.activityType] ?? a.activityType}
                    </span>
                    <span className="rounded-full bg-cream-200 px-3 py-1 text-xs text-ink-faint">{a.reason}</span>
                  </div>
                  <h3 className="mt-3 text-base font-medium text-ink-soft">{a.name}</h3>
                  <p className="mt-1 text-xs text-ink-faint">民國 {a.year} 年度</p>
                  <Link
                    href={a.activityType === "PURIFICATION" ? `/purification/${a.id}` : `/activities/${a.id}`}
                    className="mt-3 inline-block text-xs text-ink-faint underline-offset-4 hover:underline"
                  >
                    進入活動管理 →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
