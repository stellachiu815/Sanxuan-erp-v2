"use client";

import { useState, type FormEvent } from "react";
import Modal from "@/components/Modal";
import { useOperator } from "@/lib/operatorClient";
import { memberRoleLabel } from "@/lib/labels";
import {
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "./formStyles";

type Props = {
  householdId: string;
  members: { id: string; name: string; role: string }[];
  onClose: () => void;
  onSuccess: () => void;
};

/**
 * V12.1「家戶管理中心」指令「十、戶長設計」。
 * 沿用既有 Member.role 的 HOUSEHOLD_HEAD 值，指定後這一戶其他戶長會自動
 * 降級為「其他」（每戶最多一位戶長，見 src/lib/householdManagement.ts
 * assignHouseholdHead() 說明）。
 */
export default function AssignHeadModal({ householdId, members, onClose, onSuccess }: Props) {
  const { operatorUserId } = useOperator();
  const currentHead = members.find((m) => m.role === "HOUSEHOLD_HEAD");
  const [memberId, setMemberId] = useState(currentHead?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting || !memberId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/households/${householdId}/head`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId, memberId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "指定戶長失敗，請稍後再試一次。");
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

  if (members.length === 0) {
    return (
      <Modal title="指定戶長" onClose={onClose}>
        <p className="text-sm text-ink-soft">這個家戶目前沒有成員，無法指定戶長。</p>
        <div className="mt-4 flex justify-end">
          <button type="button" className={secondaryButtonClass} onClick={onClose}>
            關閉
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="指定戶長" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className={labelClass}>選擇這一戶的戶長</label>
          <div className="flex flex-col gap-2">
            {members.map((m) => (
              <label
                key={m.id}
                className="flex items-center gap-3 rounded-2xl border border-cream-200 bg-white px-4 py-3 text-sm"
              >
                <input
                  type="radio"
                  name="head"
                  checked={memberId === m.id}
                  onChange={() => setMemberId(m.id)}
                />
                <span className="text-ink">{m.name}</span>
                <span className="ml-auto text-xs text-ink-faint">{memberRoleLabel[m.role] ?? m.role}</span>
                {m.role === "HOUSEHOLD_HEAD" && (
                  <span className="rounded-full bg-yolk-100 px-2 py-0.5 text-xs text-ink-soft">目前戶長</span>
                )}
              </label>
            ))}
          </div>
        </div>

        {error && <p className={errorTextClass}>{error}</p>}

        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className={secondaryButtonClass} onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button type="submit" className={primaryButtonClass} disabled={submitting || !memberId}>
            {submitting ? "處理中…" : "確認指定戶長"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
