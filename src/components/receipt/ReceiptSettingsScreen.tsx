"use client";

import { useState } from "react";
import { receiptNumberYearModeLabel, receiptNumberResetPolicyLabel } from "@/lib/labels";
import { useOperator } from "@/lib/operatorClient";
import { canReceipt } from "@/lib/permissions";

type NumberingConfig = {
  prefix: string;
  yearMode: "ROC" | "WESTERN";
  digits: number;
  resetPolicy: "YEARLY" | "CONTINUOUS";
  startNumber: number;
};

/**
 * 需求「七、收據號碼管理」：只有最高管理權限（SUPER_ADMIN）可修改。
 *
 * V11.1.1 新增（對應指令「二」「四」）：伺服器端 PUT /numbering-config
 * 現在會真的查資料庫驗證 operatorUserId 對應的角色是不是 SUPER_ADMIN
 * （見 src/lib/receipt.ts updateReceiptNumberingConfig()），這裡的
 * disabled/隱藏只是體驗優化，不是安全機制本身——就算直接呼叫 API 略過
 * 畫面，非 SUPER_ADMIN 一樣會被伺服器拒絕（403）。
 */
export default function ReceiptSettingsScreen({
  initialConfig,
  initialPreview,
  initialNextNumber,
}: {
  initialConfig: NumberingConfig;
  initialPreview: string;
  initialNextNumber: string;
}) {
  const { operatorUserId, operatorUser } = useOperator();
  const [form, setForm] = useState(initialConfig);
  const [preview, setPreview] = useState(initialPreview);
  const [nextNumber, setNextNumber] = useState(initialNextNumber);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canManageNumbering = operatorUser?.role ? canReceipt(operatorUser.role, "manageNumbering") : false;

  async function save() {
    if (!operatorUserId) {
      setMessage("請先在上方選擇目前操作人員");
      return;
    }
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/receipt-center/numbering-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, operatorUserId }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setMessage(data.error ?? "儲存失敗");
      return;
    }
    setMessage("已儲存收據號碼規則");
    const refreshed = await fetch(`/api/receipt-center/numbering-config?operatorUserId=${operatorUserId}`);
    const refreshedData = await refreshed.json();
    setPreview(refreshedData.preview);
    setNextNumber(refreshedData.nextNumber);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl bg-white/70 p-6 shadow-card">
        <h2 className="text-sm text-ink">目前設定</h2>
        <p className="mt-2 text-sm text-ink-soft">格式預覽：{preview}</p>
        <p className="text-sm text-ink-soft">下一張實際會拿到的號碼：{nextNumber}</p>
      </div>

      <div className="flex flex-col gap-4 rounded-3xl bg-white/70 p-6 shadow-card">
        <label className="flex flex-col gap-1 text-sm text-ink">
          前綴
          <input
            className="min-h-10 rounded-full border border-cream-200 px-3"
            value={form.prefix}
            onChange={(e) => setForm((f) => ({ ...f, prefix: e.target.value }))}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-ink">
          年制
          <select
            className="min-h-10 rounded-full border border-cream-200 px-3"
            value={form.yearMode}
            onChange={(e) => setForm((f) => ({ ...f, yearMode: e.target.value as "ROC" | "WESTERN" }))}
          >
            {Object.entries(receiptNumberYearModeLabel).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-ink">
          流水號位數
          <input
            type="number"
            min={1}
            max={10}
            className="min-h-10 rounded-full border border-cream-200 px-3"
            value={form.digits}
            onChange={(e) => setForm((f) => ({ ...f, digits: Number(e.target.value) }))}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-ink">
          重編政策
          <select
            className="min-h-10 rounded-full border border-cream-200 px-3"
            value={form.resetPolicy}
            onChange={(e) => setForm((f) => ({ ...f, resetPolicy: e.target.value as "YEARLY" | "CONTINUOUS" }))}
          >
            {Object.entries(receiptNumberResetPolicyLabel).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-ink">
          起始號碼
          <input
            type="number"
            min={1}
            className="min-h-10 rounded-full border border-cream-200 px-3"
            value={form.startNumber}
            onChange={(e) => setForm((f) => ({ ...f, startNumber: Number(e.target.value) }))}
          />
        </label>

        {message && <p className="rounded-2xl bg-mist-100 px-4 py-3 text-sm text-ink">{message}</p>}
        {!canManageNumbering && (
          <p className="rounded-2xl bg-cream-100 px-4 py-3 text-xs text-ink-faint">
            只有最高管理員可以修改收據號碼規則，目前操作人員沒有這項權限（畫面仍可查看，儲存會被伺服器拒絕）。
          </p>
        )}

        <button
          disabled={saving || !canManageNumbering}
          onClick={save}
          className="min-h-10 rounded-full bg-sage-100 px-4 text-sm text-ink-soft hover:bg-sage-200 disabled:opacity-50"
        >
          儲存設定
        </button>

        <p className="text-xs text-ink-faint">
          ⚠️ 已經開立過收據之後修改重編政策/起始號碼，只會影響「下一張」收據拿到的號碼，不會回頭更動已經開立過的收據號碼；
          已作廢/已換開的收據號碼永久保留，不會被系統重新使用。
        </p>
      </div>
    </div>
  );
}
