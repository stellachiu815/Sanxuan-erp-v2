"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";

/**
 * V13.4：年度燈報名內容編輯器（光明燈／太歲燈／全家燈共用）。
 *
 * ⚠️ 列印資料一律讀 **RitualParticipant 的快照**（農曆生日、活動年度虛歲、
 * 生肖、太歲），每位成員各自一份——全家燈列印全戶名單時，
 * 每個人的資料都不同，不會用代表人的資料代替。
 *
 * 快照在「確認報名」時產生。草稿階段顯示「尚未產生」，提醒使用者
 * 確認後才可正式列印。
 */

type LanternRow = {
  participantId: string;
  memberId: string;
  name: string;
  addressText: string;
  lunarBirthText: string;
  nominalAgeText: string;
  zodiac: string | null;
  taisui: string | null;
  snapshotMissing: boolean;
};

type LanternBatch = {
  ritualRecordId: string;
  activityType: string;
  year: number;
  activityName: string;
  householdName: string;
  isConfirmed: boolean;
  amountDue: number;
  amountPaid: number;
  amountUnpaid: number;
  rows: LanternRow[];
  missingSnapshotCount: number;
};

type Props = {
  ritualRecordId: string;
  readOnly?: boolean;
  onChanged?: () => void;
};

export default function LanternRegistrationEditor({
  ritualRecordId,
  readOnly = false,
  onChanged,
}: Props) {
  const [batch, setBatch] = useState<LanternBatch | null>(null);
  const [unitPrice, setUnitPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetchRegistration(`/api/registrations/${ritualRecordId}/lantern`);
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setBatch(data.batch);
      setError(null);
    } catch {
      setError("網路連線問題，請稍後再試一次。");
    }
  }, [ritualRecordId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function saveAmount() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetchRegistration(`/api/registrations/${ritualRecordId}/lantern`, {
        method: "PATCH",
        body: JSON.stringify({ unitPrice: unitPrice.trim() === "" ? null : Number(unitPrice) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setSaved(true);
      await reload();
      onChanged?.();
    } catch {
      setError("網路連線問題，請稍後再試一次。");
    } finally {
      setBusy(false);
    }
  }

  if (!batch) {
    return (
      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <p className="text-sm text-ink-faint">{error ?? "讀取中…"}</p>
      </section>
    );
  }

  const isFamilyLantern = batch.activityType === "FAMILY_LANTERN";

  return (
    <section className="rounded-3xl bg-white/70 p-6 shadow-card">
      <h2 className="text-sm text-ink">年度燈報名內容</h2>
      <p className="mt-1 text-xs text-ink-faint">
        {batch.activityName}・民國 {batch.year} 年度
        {isFamilyLantern && "（全家燈：整戶一筆應收，與納入人數無關）"}
      </p>

      {error && <p className={`mt-3 ${errorTextClass}`}>{error}</p>}

      {/* ── 金額 ── */}
      <div className="mt-4 rounded-2xl bg-cream-50 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              {isFamilyLantern ? "整戶金額（元）" : "每位單價（元）"}
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={unitPrice}
              onChange={(e) => {
                setUnitPrice(e.target.value);
                setSaved(false);
              }}
              placeholder="留空使用預設"
              disabled={readOnly}
              className={`${inputClass} w-36`}
            />
          </label>
          {!readOnly && (
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => void saveAmount()}
              disabled={busy}
            >
              {busy ? "儲存中…" : "儲存金額"}
            </button>
          )}
          {saved && <span className="pb-2 text-xs text-sage-300">已儲存</span>}
        </div>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
          <span>
            應收：<span className="text-ink">{batch.amountDue} 元</span>
          </span>
          {batch.amountPaid > 0 && <span>已收：{batch.amountPaid} 元</span>}
          {batch.amountUnpaid > 0 && <span>未收：{batch.amountUnpaid} 元</span>}
          {!batch.isConfirmed && (
            <span className="rounded-full bg-yolk-100 px-2 py-0.5 text-ink">
              草稿階段，尚未進入待收款
            </span>
          )}
        </div>
      </div>

      {/* ── 列印資料（讀快照） ── */}
      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-ink-soft">列印資料</h3>
          {batch.missingSnapshotCount > 0 && (
            <span className="rounded-full bg-yolk-100 px-2 py-0.5 text-xs text-ink">
              {batch.missingSnapshotCount} 位尚未產生（確認報名後產生）
            </span>
          )}
        </div>

        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead>
              <tr className="border-b border-cream-200 text-ink-faint">
                <th className="py-2 pr-3">姓名</th>
                <th className="py-2 pr-3">農曆生日</th>
                <th className="py-2 pr-3">虛歲</th>
                <th className="py-2 pr-3">生肖</th>
                <th className="py-2">太歲</th>
              </tr>
            </thead>
            <tbody>
              {batch.rows.map((r) => (
                <tr key={r.participantId} className="border-b border-cream-100">
                  <td className="py-2 pr-3 text-ink">{r.name}</td>
                  <td className="py-2 pr-3">{r.lunarBirthText || "—"}</td>
                  <td className="py-2 pr-3">{r.nominalAgeText || "—"}</td>
                  <td className="py-2 pr-3">{r.zodiac ?? "—"}</td>
                  <td className="py-2">{r.taisui ?? "不犯"}</td>
                </tr>
              ))}
              {batch.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-ink-faint">
                    尚未選擇報名成員
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-xs text-ink-faint">
          列印一律使用農曆生日與活動年度虛歲。這些資料在確認報名時固定下來，
          日後修改信眾基本資料不會改變已確認年度的列印內容。
        </p>
      </div>
    </section>
  );
}
