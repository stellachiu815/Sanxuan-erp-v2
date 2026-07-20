"use client";

import { useState, type FormEvent } from "react";
import Modal from "@/components/Modal";
import { worshipTypeOptions } from "@/lib/labels";
import { useOperator } from "@/lib/operatorClient";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "./formStyles";

type Props = {
  householdId: string;
  onClose: () => void;
  onSuccess: () => void;
};

export default function AddWorshipModal({ householdId, onClose, onSuccess }: Props) {
  // V12.1 一次性修正指令「二之4」：POST /api/households/[id]/worship 這次
  // 補上了權限檢查，這裡必須帶目前操作人員。同 AddMemberModal，只在已包
  // <OperatorProvider> 的 QuickActionsPanel 底下開啟，沿用既有 useOperator()。
  const { operatorUserId } = useOperator();
  const [type, setType] = useState<"ANCESTOR_LINE" | "INDIVIDUAL">("ANCESTOR_LINE");
  const [displayName, setDisplayName] = useState("");
  const [yangshangName, setYangshangName] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) {
      setError("請輸入名稱");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/households/${householdId}/worship`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorUserId,
          type,
          displayName: displayName.trim(),
          yangshangName: yangshangName.trim() || null,
          location: location.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "新增失敗，請稍後再試一次。");
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
    <Modal title="新增祭祀資料" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className={labelClass}>類型</label>
          <select
            className={inputClass}
            value={type}
            onChange={(e) => setType(e.target.value as "ANCESTOR_LINE" | "INDIVIDUAL")}
          >
            {worshipTypeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>名稱</label>
          <input
            className={inputClass}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={
              type === "ANCESTOR_LINE" ? "例如：王姓歷代祖先" : "例如：王大明 乙位正魂"
            }
            autoFocus
          />
        </div>

        <div>
          <label className={labelClass}>陽上姓名</label>
          <input
            className={inputClass}
            value={yangshangName}
            onChange={(e) => setYangshangName(e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass}>安奉位置</label>
          <input
            className={inputClass}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass}>備註</label>
          <textarea
            className={inputClass}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error && <p className={errorTextClass}>{error}</p>}

        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className={secondaryButtonClass} onClick={onClose}>
            取消
          </button>
          <button type="submit" className={primaryButtonClass} disabled={submitting}>
            {submitting ? "新增中…" : "新增祭祀資料"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
