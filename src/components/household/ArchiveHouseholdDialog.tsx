"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { useOperator } from "@/lib/operatorClient";
import { labelClass, inputClass, primaryButtonClass, secondaryButtonClass, errorTextClass } from "./formStyles";

type Props = {
  householdId: string;
  memberCount: number;
  onClose: () => void;
  onSuccess: () => void;
};

/**
 * V12.1「家戶管理中心」指令「十四、空家戶處理」。
 * 只有目前沒有在職成員（memberCount === 0）的家戶才能封存——沿用既有
 * Household.deletedAt／deletedByName（V8.0「刪除保護」），封存後可從
 * 既有回收區畫面用既有還原功能復原，不是永久刪除。
 */
export default function ArchiveHouseholdDialog({ householdId, memberCount, onClose, onSuccess }: Props) {
  const { operatorUserId } = useOperator();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canArchive = memberCount === 0;

  async function handleConfirm() {
    if (submitting || !canArchive) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/households/${householdId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "封存失敗，請稍後再試一次。");
        return;
      }
      onSuccess();
      onClose();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="封存空家戶" onClose={onClose}>
      {!canArchive ? (
        <p className="text-sm text-ink-soft">
          這個家戶目前還有 {memberCount} 位成員，請先把成員轉移或拆分到其他家戶後才能封存。
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="rounded-2xl bg-blossom-50 px-4 py-3 text-sm text-ink-soft">
            封存後這個家戶不會出現在一般家戶列表，但資料不會被刪除，可以從「系統管理中心 → 回收區」隨時還原。
          </p>
          <div>
            <label className={labelClass}>封存原因（選填）</label>
            <input className={`${inputClass} min-h-11`} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {error && <p className={errorTextClass}>{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className={`${secondaryButtonClass} min-h-11 w-full sm:w-auto`} onClick={onClose} disabled={submitting}>
              取消
            </button>
            <button
              type="button"
              className="rounded-full bg-blossom-200 px-5 py-2.5 text-sm text-ink transition hover:bg-blossom-300 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleConfirm}
              disabled={submitting}
            >
              {submitting ? "處理中…" : "確認封存家戶"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
