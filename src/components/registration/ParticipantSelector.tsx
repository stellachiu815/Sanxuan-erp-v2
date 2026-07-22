"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";
import {
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";

/**
 * V13.4：報名成員管理（所有活動類型共用）。
 *
 * 支援指令八要求的完整回編能力：
 *   新增成員／移除成員／恢復已移除成員
 *
 * ⚠️ 移除是軟刪除——再次加入同一人會**復原原本那筆**，不會產生第二筆
 * （後端 upsert 三分支處理）。
 */

type Participant = {
  id: string;
  memberId: string;
  nameSnapshot: string;
  deletedAt: string | null;
  printProfileSnapshotAt: string | null;
  member: { id: string; name: string; role: string };
};

type HouseholdMember = {
  id: string;
  name: string;
  role: string;
  isDeceased: boolean;
};

type Props = {
  ritualRecordId: string;
  householdMembers: HouseholdMember[];
  /** 已確認的報名不可隨意增減成員時傳 true（唯讀顯示） */
  readOnly?: boolean;
  onChanged?: () => void;
};

export default function ParticipantSelector({
  ritualRecordId,
  householdMembers,
  readOnly = false,
  onChanged,
}: Props) {
  const [participants, setParticipants] = useState<Participant[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetchRegistration(
        `/api/registrations/${ritualRecordId}/participants?includeRemoved=1`
      );
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setParticipants(data.participants);
      setError(null);
    } catch {
      setError("網路連線問題，請稍後再試一次。");
    }
  }, [ritualRecordId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const active = participants?.filter((p) => !p.deletedAt) ?? [];
  const removed = participants?.filter((p) => p.deletedAt) ?? [];
  const activeIds = new Set(active.map((p) => p.memberId));

  async function add(memberId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchRegistration(
        `/api/registrations/${ritualRecordId}/participants`,
        { method: "POST", body: JSON.stringify({ memberIds: [memberId] }) }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      await reload();
      onChanged?.();
    } catch {
      setError("網路連線問題，請稍後再試一次。");
    } finally {
      setBusy(false);
    }
  }

  async function remove(memberId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchRegistration(
        `/api/registrations/${ritualRecordId}/participants`,
        { method: "DELETE", body: JSON.stringify({ memberId }) }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      await reload();
      onChanged?.();
    } catch {
      setError("網路連線問題，請稍後再試一次。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl bg-white/70 p-6 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm text-ink">本次報名成員</h2>
        <span className="rounded-full bg-cream-100 px-3 py-1 text-xs text-ink-soft">
          {participants === null ? "讀取中…" : `${active.length} 位`}
        </span>
      </div>

      {error && <p className={`mt-3 ${errorTextClass}`}>{error}</p>}

      {/* ── 已納入 ── */}
      <div className="mt-3 flex flex-col gap-2">
        {active.length === 0 && participants !== null && (
          <p className="text-xs text-ink-faint">尚未選擇任何成員。</p>
        )}
        {active.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-cream-50 px-4 py-2.5"
          >
            <span className="text-sm text-ink">
              {p.member.name}
              {p.printProfileSnapshotAt && (
                <span className="ml-2 rounded-full bg-sage-100 px-2 py-0.5 text-xs text-ink-soft">
                  列印資料已產生
                </span>
              )}
            </span>
            {!readOnly && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(p.memberId)}
                className="text-xs text-blossom-300 underline-offset-4 hover:underline disabled:opacity-40"
              >
                移除
              </button>
            )}
          </div>
        ))}
      </div>

      {/* ── 可加入的家戶成員 ── */}
      {!readOnly && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs text-ink-soft">同家戶成員（點選加入）</p>
          <div className="flex flex-wrap gap-1.5">
            {householdMembers
              .filter((m) => !activeIds.has(m.id))
              .map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void add(m.id)}
                  className="min-h-9 rounded-full bg-mist-100 px-3 py-1.5 text-xs text-ink transition hover:bg-mist-200 disabled:opacity-40"
                >
                  ＋{m.name}
                  {m.isDeceased && <span className="ml-1 text-ink-faint">（已辭世）</span>}
                </button>
              ))}
            {householdMembers.filter((m) => !activeIds.has(m.id)).length === 0 && (
              <span className="text-xs text-ink-faint">全戶成員都已納入。</span>
            )}
          </div>
        </div>
      )}

      {/* ── 已移除（可恢復） ── */}
      {removed.length > 0 && (
        <div className="mt-4 border-t border-cream-200 pt-3">
          <p className="mb-1.5 text-xs text-ink-faint">已移除（可恢復）</p>
          <div className="flex flex-wrap gap-1.5">
            {removed.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy || readOnly}
                onClick={() => void add(p.memberId)}
                className="min-h-9 rounded-full bg-cream-200 px-3 py-1.5 text-xs text-ink-soft transition hover:bg-cream-300 disabled:opacity-40"
              >
                ↺ {p.nameSnapshot}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
