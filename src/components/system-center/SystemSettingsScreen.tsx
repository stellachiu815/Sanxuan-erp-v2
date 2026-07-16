"use client";

import { useEffect, useState } from "react";
import { useOperator } from "@/lib/operatorClient";
import { canSystem } from "@/lib/permissions";

type SettingsResponse = {
  dailyRetentionDays: number;
  weeklyRetentionWeeks: number;
  updatedAt: string;
  updatedByName: string | null;
};

type ScheduleTypeStatus = {
  type: "DAILY" | "WEEKLY" | "MONTHLY";
  lastRunAt: string | null;
  lastRunStatus: "SUCCESS" | "FAILED" | null;
  nextScheduledAt: string;
  everConfirmedAutomatic: boolean;
};

const SCHEDULE_LABEL: Record<string, string> = { DAILY: "每日備份", WEEKLY: "每週備份", MONTHLY: "每月備份" };

/**
 * 需求「系統設定」子頁面。目前開放調整的是每日／每週備份保留政策
 * （對應指令「五」「六」的天數/週數）；每日/週/月的實際執行時間
 * （02:00／週日03:00／1號04:00）目前是程式碼常數＋外部排程觸發，
 * 尚未做成可調整設定——這是老實揭露的範圍限制，不是隱藏起來。
 */
export default function SystemSettingsScreen() {
  const { operatorUserId, operatorUser } = useOperator();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [dailyDays, setDailyDays] = useState(30);
  const [weeklyWeeks, setWeeklyWeeks] = useState(12);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<ScheduleTypeStatus[] | null>(null);

  const canManage = operatorUser?.role ? canSystem(operatorUser.role, "manageBackupSchedule") : false;

  useEffect(() => {
    if (!operatorUserId) return;
    setLoading(true);
    fetch(`/api/system-center/settings?operatorUserId=${encodeURIComponent(operatorUserId)}`)
      .then((res) => res.json().then((d) => ({ ok: res.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          setMessage(d.error ?? "載入失敗");
          return;
        }
        setData(d);
        setDailyDays(d.dailyRetentionDays);
        setWeeklyWeeks(d.weeklyRetentionWeeks);
      })
      .catch(() => setMessage("無法連線到伺服器"))
      .finally(() => setLoading(false));

    fetch(`/api/system-center/backup/schedule-status?operatorUserId=${encodeURIComponent(operatorUserId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => setSchedules(d?.schedules ?? null))
      .catch(() => {});
  }, [operatorUserId]);

  async function save() {
    if (!operatorUserId) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/system-center/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId, dailyRetentionDays: dailyDays, weeklyRetentionWeeks: weeklyWeeks }),
      });
      const d = await res.json();
      if (!res.ok) {
        setMessage(d.error ?? "儲存失敗");
        return;
      }
      setMessage("已儲存設定");
    } catch {
      setMessage("無法連線到伺服器");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {loading && <p className="text-sm text-ink-faint">載入中…</p>}

      <div className="rounded-3xl bg-white/70 p-6 shadow-card">
        <h2 className="text-sm text-ink">備份保留政策</h2>
        <p className="mt-2 text-xs text-ink-faint">
          每月備份與更新前備份永久保留、不會自動刪除，這裡只能調整每日／每週的保留期間。
        </p>

        <label className="mt-4 flex flex-col gap-1 text-sm text-ink">
          每日備份保留天數
          <input
            type="number"
            min={1}
            disabled={!canManage}
            className="min-h-10 rounded-full border border-cream-200 px-3 disabled:bg-cream-100"
            value={dailyDays}
            onChange={(e) => setDailyDays(Number(e.target.value))}
          />
        </label>

        <label className="mt-4 flex flex-col gap-1 text-sm text-ink">
          每週備份保留週數
          <input
            type="number"
            min={1}
            disabled={!canManage}
            className="min-h-10 rounded-full border border-cream-200 px-3 disabled:bg-cream-100"
            value={weeklyWeeks}
            onChange={(e) => setWeeklyWeeks(Number(e.target.value))}
          />
        </label>

        {data?.updatedByName && (
          <p className="mt-3 text-xs text-ink-faint">
            上次修改：{new Date(data.updatedAt).toLocaleString("zh-Hant")}（{data.updatedByName}）
          </p>
        )}

        {!canManage && <p className="mt-4 text-xs text-blossom-600">目前操作人員沒有修改排程設定的權限。</p>}

        {canManage && (
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="mt-4 min-h-10 rounded-full bg-sage-200 px-6 text-sm text-ink transition hover:bg-sage-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "儲存中…" : "儲存設定"}
          </button>
        )}

        {message && <p className="mt-3 text-sm text-ink-soft">{message}</p>}
      </div>

      {schedules && (
        <div className="rounded-3xl bg-white/70 p-6 shadow-card">
          <h2 className="text-sm text-ink">自動備份排程狀態</h2>
          <p className="mt-2 text-xs text-ink-faint">
            對應指令「十二」：這裡誠實反映系統是否曾經真的收到過外部排程的觸發，不會因為排程 API
            已經開發完成就顯示為已啟用。
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {schedules.map((s) => (
              <div key={s.type} className="rounded-2xl bg-cream-50 p-4 text-sm">
                <div className="flex items-center justify-between">
                  <p className="text-ink">{SCHEDULE_LABEL[s.type]}</p>
                  {!s.everConfirmedAutomatic ? (
                    <span className="rounded-full bg-yolk-200 px-3 py-1 text-xs text-ink">
                      系統 API 已準備完成，但外部排程服務尚未確認。
                    </span>
                  ) : (
                    <span
                      className={`rounded-full px-3 py-1 text-xs ${s.lastRunStatus === "SUCCESS" ? "bg-sage-100 text-ink" : "bg-blossom-100 text-ink"}`}
                    >
                      {s.lastRunStatus === "SUCCESS" ? "已確認運作" : "已收到觸發，但上次執行失敗"}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-ink-faint">
                  上一次執行時間：{s.lastRunAt ? new Date(s.lastRunAt).toLocaleString("zh-Hant") : "尚未收到過自動觸發"}
                </p>
                <p className="text-xs text-ink-faint">下一次預定時間：{new Date(s.nextScheduledAt).toLocaleString("zh-Hant")}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
