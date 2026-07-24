"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/permissionClient";
import { computeRiceAmountDue } from "@/lib/whiteRice";

/**
 * V14.4 白米 UI：年度設定 + 即時配額摘要 + 白米報名。整合進既有普渡年度／報名
 * 流程，不建立第二套活動設定頁或第二套白米報名頁。白米無貼紙、無列印品。
 *
 * 數值一律取自既有 rice-config API；前端即時計算僅供顯示，正式結果以後端鎖定的
 * lockedUnitPrice 與 amountDue 為準。READONLY 不可編輯、不可報名。
 */

type Summary = {
  year: number;
  totalKg: number | null;
  unitPrice: number | null;
  open: boolean;
  note: string | null;
  registeredKg: number;
  remainingKg: number;
  isOverbooked: boolean;
  totalAmountDue: number;
  totalAmountPaid: number;
  totalAmountUnpaid: number;
};

export default function WhiteRicePanel({
  templeEventId,
  year,
  ritualRecordId,
  members = [],
}: {
  /** 年度設定頁提供 templeEventId → 顯示可編輯設定；報名編輯器只有 year → 隱藏設定、只顯示摘要＋報名。 */
  templeEventId?: string;
  year: number;
  ritualRecordId?: string | null;
  members?: { id: string; name: string }[];
}) {
  const { role } = useCurrentUser();
  const canEdit = !!role && role !== "READONLY";
  const canOverride = role === "SUPER_ADMIN" || role === "ADMIN";

  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const refresh = useCallback(() => setReloadTick((t) => t + 1), []);

  // 有 templeEventId → 用 temple-event 設定端點（可 PATCH 設定）；
  // 只有 year（報名編輯器）→ 用年度端點（只讀摘要）。同一個 getRiceQuotaSummary。
  const configUrl = templeEventId
    ? `/api/temple-events/${templeEventId}/rice-config`
    : `/api/universal-salvation/${year}/rice-config`;

  useEffect(() => {
    let cancelled = false;
    fetch(configUrl)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "載入失敗");
        return r.json();
      })
      .then((d) => { if (!cancelled) { setSummary(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [configUrl, reloadTick]);

  if (error) return <div className="rounded-3xl bg-blossom-100 p-4 text-sm text-ink">{error}</div>;
  if (!summary) return <p className="p-4 text-sm text-ink-faint">載入白米配額中…</p>;

  return (
    <div className="flex flex-col gap-4">
      {/* 設定僅在年度設定頁（有 templeEventId）出現，報名編輯器不重複顯示設定表單。 */}
      {templeEventId && <RiceSettings summary={summary} templeEventId={templeEventId} canEdit={canEdit} onSaved={refresh} />}
      <RiceQuotaSummaryCard summary={summary} />
      {ritualRecordId && canEdit && (
        <RiceRegisterForm
          year={year}
          ritualRecordId={ritualRecordId}
          summary={summary}
          members={members}
          canOverride={canOverride}
          onRegistered={refresh}
        />
      )}
    </div>
  );
}

function num(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function RiceSettings({ summary, templeEventId, canEdit, onSaved }: { summary: Summary; templeEventId: string; canEdit: boolean; onSaved: () => void }) {
  const [totalKg, setTotalKg] = useState(summary.totalKg?.toString() ?? "");
  const [unitPrice, setUnitPrice] = useState(summary.unitPrice?.toString() ?? "");
  const [open, setOpen] = useState(summary.open);
  const [note, setNote] = useState(summary.note ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const t = num(totalKg);
    const u = num(unitPrice);
    if (t !== null && (Number.isNaN(t) || t < 0)) { setErr("總斤數必須是 0 以上的數字，或清空"); return; }
    if (u !== null && (Number.isNaN(u) || u < 0)) { setErr("每斤金額必須是 0 以上的數字，或清空"); return; }
    setSaving(true); setErr(null); setMsg(null);
    try {
      const res = await fetch(`/api/temple-events/${templeEventId}/rice-config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totalKg: t, unitPrice: u, open, note }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "儲存失敗");
      setMsg("已儲存白米年度配額。");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "儲存失敗");
    } finally { setSaving(false); }
  }

  return (
    <div className="rounded-3xl bg-white/70 p-4 shadow-card">
      <h3 className="text-sm font-medium text-ink">白米年度配額設定（民國 {summary.year} 年）</h3>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs text-ink-soft">總斤數（riceTotalKg）
          <input value={totalKg} onChange={(e) => setTotalKg(e.target.value)} disabled={!canEdit} inputMode="decimal"
            className="mt-1 w-full rounded-xl border border-cream-200 bg-cream-50 px-3 py-2 text-sm min-h-[44px]" />
        </label>
        <label className="text-xs text-ink-soft">每斤金額（riceUnitPrice）
          <input value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} disabled={!canEdit} inputMode="decimal"
            className="mt-1 w-full rounded-xl border border-cream-200 bg-cream-50 px-3 py-2 text-sm min-h-[44px]" />
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <input type="checkbox" className="h-5 w-5" checked={open} onChange={(e) => setOpen(e.target.checked)} disabled={!canEdit} />
          開放認購（riceOpen）
        </label>
        <label className="text-xs text-ink-soft sm:col-span-2">備註（riceNote）
          <input value={note} onChange={(e) => setNote(e.target.value)} disabled={!canEdit}
            className="mt-1 w-full rounded-xl border border-cream-200 bg-cream-50 px-3 py-2 text-sm min-h-[44px]" />
        </label>
      </div>
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={save} disabled={saving} className="rounded-full bg-sage-200 px-5 py-2 text-sm text-ink min-h-[44px] disabled:opacity-40">
            {saving ? "儲存中…" : "儲存設定"}
          </button>
          {msg && <span className="text-xs text-sage-500">{msg}</span>}
          {err && <span className="text-xs text-blossom-500">{err}</span>}
        </div>
      )}
      {!canEdit && <p className="mt-2 text-xs text-ink-faint">您目前為唯讀權限，僅能查看白米配額。</p>}
    </div>
  );
}

function RiceQuotaSummaryCard({ summary }: { summary: Summary }) {
  const cell = (label: string, value: string, warn = false) => (
    <div className={`rounded-2xl p-3 ${warn ? "bg-blossom-100" : "bg-cream-50"}`}>
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="text-base font-medium text-ink">{value}</p>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cell("總斤數", summary.totalKg !== null ? `${summary.totalKg} 斤` : "未設定")}
      {cell("已認購", `${summary.registeredKg} 斤`)}
      {cell("剩餘可認購", `${summary.remainingKg} 斤`, summary.isOverbooked)}
      {cell("每斤金額", summary.unitPrice !== null ? `${summary.unitPrice} 元` : "未設定")}
      {cell("認購總金額", `${summary.totalAmountDue} 元`)}
      {cell("已收金額", `${summary.totalAmountPaid} 元`)}
      {cell("未收金額", `${summary.totalAmountUnpaid} 元`)}
      {cell("是否開放", summary.open ? "開放中" : "未開放")}
    </div>
  );
}

function RiceRegisterForm({ year, ritualRecordId, summary, members, canOverride, onRegistered }: {
  year: number; ritualRecordId: string; summary: Summary; members: { id: string; name: string }[]; canOverride: boolean; onRegistered: () => void;
}) {
  const [memberId, setMemberId] = useState<string>("");
  const [kg, setKg] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const kgNum = Number(kg);
  const previewDue = Number.isFinite(kgNum) && kgNum > 0 ? computeRiceAmountDue(kgNum, summary.unitPrice) : null;
  const willOverbook = Number.isFinite(kgNum) && kgNum > summary.remainingKg;

  async function register() {
    if (!summary.open) { setErr("白米尚未開放認購"); return; }
    if (!Number.isFinite(kgNum) || kgNum <= 0) { setErr("請輸入大於 0 的認購斤數"); return; }
    if (willOverbook && !canOverride) { setErr(`剩餘斤數不足（剩 ${summary.remainingKg} 斤），一般人員不得超額認購`); return; }
    if (willOverbook && canOverride && !reason.trim()) { setErr("超額認購必須填寫原因"); return; }
    setSaving(true); setErr(null); setMsg(null);
    try {
      const res = await fetch(`/api/universal-salvation/${year}/rice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ritualRecordId, memberId: memberId || null, kg: kgNum, overageReason: reason || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "認購建立失敗");
      setMsg(`已建立白米認購：應收 ${data?.amountDue ?? 0} 元${data?.overage ? "（超額，已記錄）" : ""}。`);
      setKg(""); setReason("");
      onRegistered();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "認購建立失敗");
    } finally { setSaving(false); }
  }

  return (
    <div className="rounded-3xl bg-white/70 p-4 shadow-card">
      <h3 className="text-sm font-medium text-ink">白米認購</h3>
      {!summary.open && <p className="mt-1 text-xs text-blossom-500">目前尚未開放認購。</p>}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {members.length > 0 && (
          <label className="text-xs text-ink-soft">認購人
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-cream-200 bg-cream-50 px-3 py-2 text-sm min-h-[44px]">
              <option value="">（整戶／未指定）</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        )}
        <label className="text-xs text-ink-soft">認購斤數
          <input value={kg} onChange={(e) => setKg(e.target.value)} inputMode="decimal"
            className="mt-1 w-full rounded-xl border border-cream-200 bg-cream-50 px-3 py-2 text-sm min-h-[44px]" />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink-soft">
        <span>每斤金額：{summary.unitPrice !== null ? `${summary.unitPrice} 元` : "未設定"}</span>
        <span>應收（試算）：{previewDue !== null ? `${previewDue} 元` : "—"}</span>
        <span className={willOverbook ? "text-blossom-500" : ""}>剩餘可認購：{summary.remainingKg} 斤</span>
      </div>
      {willOverbook && canOverride && (
        <label className="mt-2 block text-xs text-ink-soft">超額原因（必填）
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full rounded-xl border border-blossom-200 bg-cream-50 px-3 py-2 text-sm min-h-[44px]" />
        </label>
      )}
      {willOverbook && !canOverride && <p className="mt-2 text-xs text-blossom-500">剩餘斤數不足，一般人員不得超額認購。</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={register} disabled={saving || !summary.open} className="rounded-full bg-sage-200 px-5 py-2 text-sm text-ink min-h-[44px] disabled:opacity-40">
          {saving ? "建立中…" : "建立認購"}
        </button>
        {msg && <span className="text-xs text-sage-500">{msg}</span>}
        {err && <span className="text-xs text-blossom-500">{err}</span>}
      </div>
    </div>
  );
}
