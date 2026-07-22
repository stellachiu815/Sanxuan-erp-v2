"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";
import {
  labelClass,
  checkboxRowClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";

/**
 * V13.4：從信眾詳情頁新增活動報名。
 *
 * 流程（指令三、六）：
 *   ① 選活動（清單完全從 TempleEvent 動態取得，前端零寫死）
 *   ② 選「沿用去年」或「全新手動建立」
 *   ③ 勾選本人與同家戶成員
 *   ④ 建立／取得唯一的 RitualRecord，寫入成員
 *   ⑤ 導向共用報名編輯器填內容
 *
 * ⚠️ 已有報名時**不是錯誤**——直接開啟既有那一筆並提示。
 */

type AvailableActivity = {
  templeEventId: string;
  activityType: string;
  year: number;
  name: string;
  eventDate: string | null;
  status: string;
  formSupported: boolean;
  formUnsupportedReason: string | null;
  alreadyRegistered: boolean;
  existingRitualRecordId: string | null;
  existingStatus: string | null;
};

type HouseholdMember = { id: string; name: string; role: string; isDeceased: boolean };

type Props = {
  memberId: string;
  onClose: () => void;
};

export default function NewActivityRegistrationDialog({ memberId, onClose }: Props) {
  const router = useRouter();
  const [activities, setActivities] = useState<AvailableActivity[] | null>(null);
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [mode, setMode] = useState<"NEW" | "CARRY_OVER">("NEW");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [carryTableNumber, setCarryTableNumber] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchRegistration(
        `/api/devotee-center/${memberId}/available-activities`
      );
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setActivities(data.activities);
      setHouseholdMembers(data.householdMembers);
      // 預設勾選本人
      setSelectedMemberIds([memberId]);
    } catch {
      setError("網路連線問題，請稍後再試一次。");
    }
  }, [memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = activities?.find((a) => a.templeEventId === selectedEventId) ?? null;

  function toggleMember(id: string) {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function submit() {
    if (!selected) return;

    // 已有報名 → 直接開啟既有那一筆
    if (selected.alreadyRegistered && selected.existingRitualRecordId) {
      router.push(`/registration/${selected.existingRitualRecordId}?from=${memberId}`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetchRegistration(
        `/api/devotee-center/${memberId}/activity-registrations`,
        {
          method: "POST",
          body: JSON.stringify({
            templeEventId: selected.templeEventId,
            memberIds: selectedMemberIds,
            mode,
            carryOverOptions:
              mode === "CARRY_OVER" ? { copyTableNumber: carryTableNumber } : undefined,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      router.push(`${data.editorUrl}?from=${memberId}`);
    } catch {
      setError("網路連線問題，請稍後再試一次。");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    selected !== null &&
    (selected.alreadyRegistered || (selected.formSupported && selectedMemberIds.length > 0));

  return (
    <Modal title="新增活動報名" onClose={onClose}>
      {activities === null ? (
        <p className="py-8 text-center text-sm text-ink-soft">{error ?? "讀取中…"}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {error && <p className={errorTextClass}>{error}</p>}

          {/* ── ① 選活動 ── */}
          <div>
            <label className={labelClass}>選擇活動</label>
            {activities.length === 0 ? (
              <p className="rounded-2xl bg-cream-100 px-4 py-3 text-sm text-ink-soft">
                目前沒有開放報名的活動。請先於活動中心建立活動年度並開放報名。
              </p>
            ) : (
              <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
                {activities.map((a) => (
                  <button
                    key={a.templeEventId}
                    type="button"
                    onClick={() => setSelectedEventId(a.templeEventId)}
                    className={`rounded-xl px-4 py-3 text-left text-sm transition ${
                      selectedEventId === a.templeEventId
                        ? "bg-sage-100 text-ink"
                        : "bg-cream-50 text-ink-soft hover:bg-cream-100"
                    }`}
                  >
                    <span className="text-ink">
                      民國 {a.year} 年　{a.name}
                    </span>
                    <span className="ml-2 text-xs text-ink-faint">
                      {a.eventDate ?? "日期未定"}
                    </span>
                    {a.alreadyRegistered && (
                      <span className="ml-2 rounded-full bg-yolk-100 px-2 py-0.5 text-xs text-ink">
                        已有報名
                      </span>
                    )}
                    {!a.formSupported && (
                      <span className="ml-2 rounded-full bg-blossom-100 px-2 py-0.5 text-xs text-ink">
                        尚未設定報名表
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selected && !selected.formSupported && (
            <p className="rounded-2xl bg-blossom-100 px-4 py-3 text-xs leading-relaxed text-ink">
              {selected.formUnsupportedReason}
            </p>
          )}

          {selected?.alreadyRegistered && (
            <p className="rounded-2xl bg-yolk-100 px-4 py-3 text-sm text-ink">
              此家戶本年度已有這項活動資料，將為你開啟原報名紀錄
              （目前狀態：{selected.existingStatus === "CONFIRMED" ? "已確認" : "草稿"}）。
            </p>
          )}

          {/* ── ② 沿用 or 全新 ── */}
          {selected && selected.formSupported && !selected.alreadyRegistered && (
            <>
              <div>
                <label className={labelClass}>建立方式</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setMode("NEW")}
                    className={`min-h-11 rounded-full px-4 py-2 text-sm transition ${
                      mode === "NEW" ? "bg-mist-200 text-ink" : "bg-cream-100 text-ink-soft"
                    }`}
                  >
                    全新手動建立
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("CARRY_OVER")}
                    className={`min-h-11 rounded-full px-4 py-2 text-sm transition ${
                      mode === "CARRY_OVER" ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft"
                    }`}
                  >
                    沿用去年資料
                  </button>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
                  {mode === "NEW"
                    ? "完全不帶入去年任何內容，所有欄位手動填寫。"
                    : "沿用去年的報名內容與人員；付款、收據、列印與對帳狀態一律不沿用，全部重新開始。"}
                </p>
              </div>

              {mode === "CARRY_OVER" && selected.activityType === "UNIVERSAL_SALVATION" && (
                <label className={checkboxRowClass}>
                  <input
                    type="checkbox"
                    checked={carryTableNumber}
                    onChange={(e) => setCarryTableNumber(e.target.checked)}
                  />
                  同時沿用去年的普渡桌號（預設不沿用，桌號通常每年重新安排）
                </label>
              )}

              {/* ── ③ 選成員 ── */}
              <div>
                <label className={labelClass}>本次報名成員</label>
                <div className="flex flex-wrap gap-1.5">
                  {householdMembers.map((m) => {
                    const on = selectedMemberIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleMember(m.id)}
                        className={`min-h-9 rounded-full px-3 py-1.5 text-xs transition ${
                          on ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft hover:bg-cream-200"
                        }`}
                      >
                        {on ? "✓ " : ""}
                        {m.name}
                        {m.id === memberId && <span className="ml-1 text-ink-faint">本人</span>}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-xs text-ink-faint">
                  同一家戶只會建立一筆活動報名，勾選的成員都會納入這一筆，不會重複建立。
                </p>
              </div>
            </>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button type="button" className={secondaryButtonClass} onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => void submit()}
              disabled={busy || !canSubmit}
            >
              {busy
                ? "處理中…"
                : selected?.alreadyRegistered
                  ? "開啟既有報名"
                  : "建立並填寫內容"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
