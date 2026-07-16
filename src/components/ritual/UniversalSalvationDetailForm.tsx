"use client";

import { useState, type FormEvent } from "react";
import {
  inputClass,
  labelClass,
  checkboxRowClass,
  primaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";
import { ritualRecordStatusLabel } from "@/lib/labels";
import type { DetailJSON, RecordJSON } from "./types";

type Props = {
  householdId: string;
  year: number;
  status: string;
  detail: DetailJSON;
  onSaved: (record: RecordJSON) => void;
};

/**
 * 普渡登記明細表單。
 *
 * V3.1「行政流程優化」調整欄位順序，符合實際填寫流程：
 * 陽上姓名 → 安奉位置 → 贊普 → 普渡桌 → 備註。
 * 「已報名普渡」不在這個排序清單裡，改放到標題列（跟狀態標籤放一起），
 * 不影響其餘欄位的填寫順序。
 * V3.2「大量登記優化」：整個表單包在 <form> 裡，在任何一般輸入欄位按 Enter
 * 就會直接儲存（瀏覽器原生行為，備註是多行 textarea，Enter 維持換行、不會
 * 誤觸儲存）；完成後的提示改成畫面右上角的提示（見 UniversalSalvationScreen）。
 */
export default function UniversalSalvationDetailForm({
  householdId,
  year,
  status,
  detail,
  onSaved,
}: Props) {
  const [isRegistered, setIsRegistered] = useState(detail.isRegistered);
  const [yangshangName, setYangshangName] = useState(detail.yangshangName ?? "");
  const [enshrinementLocation, setEnshrinementLocation] = useState(
    detail.enshrinementLocation ?? ""
  );
  const [isSponsor, setIsSponsor] = useState(detail.isSponsor);
  const [sponsorQuantity, setSponsorQuantity] = useState(
    detail.sponsorQuantity !== null ? String(detail.sponsorQuantity) : ""
  );
  const [sponsorUnitPrice, setSponsorUnitPrice] = useState(detail.sponsorUnitPrice ?? "");
  const [sponsorAmount, setSponsorAmount] = useState(detail.sponsorAmount ?? "");
  const [sponsorNotes, setSponsorNotes] = useState(detail.sponsorNotes ?? "");
  const [tableNumber, setTableNumber] = useState(detail.tableNumber ?? "");
  const [notes, setNotes] = useState(detail.notes ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    handleSave();
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/households/${householdId}/rituals/universal-salvation/${year}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isRegistered,
            yangshangName: yangshangName.trim() || null,
            enshrinementLocation: enshrinementLocation.trim() || null,
            isSponsor,
            sponsorQuantity: sponsorQuantity.trim() === "" ? null : Number(sponsorQuantity),
            sponsorUnitPrice: String(sponsorUnitPrice).trim() === "" ? null : Number(sponsorUnitPrice),
            sponsorAmount: String(sponsorAmount).trim() === "" ? null : Number(sponsorAmount),
            sponsorNotes: sponsorNotes.trim() || null,
            tableNumber: tableNumber.trim() || null,
            notes: notes.trim() || null,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "儲存失敗，請稍後再試一次。");
        return;
      }
      onSaved(data.record);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-3xl bg-white/70 p-8 shadow-card">
      <form onSubmit={handleSubmit}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-ink">{year} 年普渡登記資料</h2>
        <div className="flex items-center gap-3">
          <label className={checkboxRowClass}>
            <input
              type="checkbox"
              checked={isRegistered}
              onChange={(e) => setIsRegistered(e.target.checked)}
            />
            已報名普渡
          </label>
          <span className="rounded-full bg-cream-200/70 px-3 py-1 text-xs text-ink-soft">
            {ritualRecordStatusLabel[status] ?? status}
          </span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            value={enshrinementLocation}
            onChange={(e) => setEnshrinementLocation(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-6 rounded-2xl bg-cream-100/60 p-5">
        <label className={checkboxRowClass}>
          <input
            type="checkbox"
            checked={isSponsor}
            onChange={(e) => setIsSponsor(e.target.checked)}
          />
          贊普
        </label>

        {isSponsor && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>數量</label>
              <input
                className={inputClass}
                type="number"
                value={sponsorQuantity}
                onChange={(e) => setSponsorQuantity(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>單價</label>
              <input
                className={inputClass}
                type="number"
                value={sponsorUnitPrice}
                onChange={(e) => setSponsorUnitPrice(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>金額</label>
              <input
                className={inputClass}
                type="number"
                value={sponsorAmount}
                onChange={(e) => setSponsorAmount(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>贊普備註</label>
              <input
                className={inputClass}
                value={sponsorNotes}
                onChange={(e) => setSponsorNotes(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-6">
        <label className={labelClass}>普渡桌</label>
        <input
          className={inputClass}
          value={tableNumber}
          onChange={(e) => setTableNumber(e.target.value)}
        />
      </div>

      <div className="mt-6">
        <label className={labelClass}>備註</label>
        <textarea className={inputClass} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && <p className={`mt-4 ${errorTextClass}`}>{error}</p>}

      <div className="mt-6 flex items-center justify-end gap-3">
        <button type="submit" className={primaryButtonClass} disabled={saving}>
          {saving ? "儲存中…" : "儲存（Enter）"}
        </button>
      </div>
      </form>
    </section>
  );
}
