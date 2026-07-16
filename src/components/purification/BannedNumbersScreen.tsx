"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { errorTextClass, inputClass, primaryButtonClass } from "@/components/household/formStyles";
import ConfirmDialog from "@/components/system/ConfirmDialog";
import Toast from "@/components/ritual/Toast";

type BannedNumber = { id: string; number: number; reason: string | null; createdAt: string };

export default function BannedNumbersScreen({ initialBannedNumbers }: { initialBannedNumbers: BannedNumber[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialBannedNumbers);
  const [number, setNumber] = useState("");
  const [reason, setReason] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<BannedNumber | null>(null);
  const [toastVisible, setToastVisible] = useState(false);

  function showToast() {
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2000);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(number);
    if (!Number.isInteger(n) || n < 0) {
      setError("請輸入正確的號碼");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/purification/banned-numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: n, reason: reason || null, operatorName: operatorName || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "新增失敗");
        return;
      }
      setItems((prev) => [...prev, { id: data.id, number: n, reason: reason || null, createdAt: new Date().toISOString() }].sort((a, b) => a.number - b.number));
      setNumber("");
      setReason("");
      showToast();
      router.refresh();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(item: BannedNumber) {
    try {
      const res = await fetch(`/api/purification/banned-numbers/${item.number}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorName: operatorName || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "移除失敗");
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      showToast();
      router.refresh();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setRemoveTarget(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form className="flex flex-wrap items-end gap-3 rounded-2xl bg-white/70 p-5 shadow-soft" onSubmit={handleAdd}>
        <div>
          <label className="mb-1.5 block text-xs text-ink-soft">禁用號碼</label>
          <input className={inputClass + " w-32"} type="number" value={number} onChange={(e) => setNumber(e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs text-ink-soft">原因（選填）</label>
          <input className={inputClass + " w-48"} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs text-ink-soft">操作人姓名（選填）</label>
          <input className={inputClass + " w-40"} value={operatorName} onChange={(e) => setOperatorName(e.target.value)} />
        </div>
        <button type="submit" className={primaryButtonClass} disabled={submitting}>
          {submitting ? "新增中…" : "新增"}
        </button>
      </form>

      {error && <p className={errorTextClass}>{error}</p>}

      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between rounded-xl bg-white/70 px-4 py-3 shadow-soft">
            <div>
              <span className="font-medium text-ink">{item.number}</span>
              {item.reason && <span className="ml-3 text-xs text-ink-soft">{item.reason}</span>}
            </div>
            <button
              type="button"
              className="text-xs text-blossom-300 underline-offset-4 hover:underline"
              onClick={() => setRemoveTarget(item)}
            >
              移除
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="text-sm text-ink-faint">目前沒有額外禁用的號碼</li>}
      </ul>

      {removeTarget && (
        <ConfirmDialog
          title="移除禁用號碼"
          message={`確定要移除號碼 ${removeTarget.number} 的禁用設定嗎？移除後，這個號碼未來可能會被系統分配給新報名者。`}
          confirmLabel="確定移除"
          danger
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() => handleRemove(removeTarget)}
        />
      )}

      <Toast visible={toastVisible} />
    </div>
  );
}
