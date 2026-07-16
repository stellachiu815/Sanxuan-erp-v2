"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";

type Props = {
  title: string;
  label: string;
  confirmLabel?: string;
  onCancel: () => void;
  onSubmit: (reason: string) => Promise<{ ok: boolean; error?: string }>;
};

/**
 * 通用的「請填寫原因」表單彈窗（V11.1.1 新增），取代 window.prompt()。
 * 用在標記不需開立／撤銷不需開立這類「一定要填原因、但不需要核准人」的操作。
 */
export default function ReasonDialog({ title, label, confirmLabel = "確定", onCancel, onSubmit }: Props) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (!reason.trim()) {
      setError("請輸入原因");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await onSubmit(reason.trim());
    setBusy(false);
    if (!result.ok) setError(result.error ?? "操作失敗");
  }

  return (
    <Modal title={title} onClose={onCancel}>
      <div className="flex flex-col gap-4">
        <div>
          <label className={labelClass}>{label}</label>
          <textarea
            className={inputClass}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </div>
        {error && <p className={errorTextClass}>{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className={secondaryButtonClass} onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="button" className={primaryButtonClass} onClick={handleSubmit} disabled={busy}>
            {busy ? "處理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
