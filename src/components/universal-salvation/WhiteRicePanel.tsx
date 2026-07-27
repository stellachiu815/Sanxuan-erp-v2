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
  /** V16：是否允許超量認購（false＝所有角色一律不得超過剩餘量）。 */
  allowOverbook: boolean;
  /** V16：有效認購筆數。 */
  count: number;
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
  // V16：年度設定（含允許超量開關）＝活動設定管理權限（僅 ADMIN／SUPER_ADMIN）。
  const canManageSettings = role === "SUPER_ADMIN" || role === "ADMIN";

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
      {templeEventId && <RiceSettings summary={summary} templeEventId={templeEventId} canEdit={canManageSettings} onSaved={refresh} />}
      <RiceQuotaSummaryCard summary={summary} />
      {ritualRecordId && canEdit && (
        <RiceRegisterForm
          year={year}
          ritualRecordId={ritualRecordId}
          summary={summary}
          members={members}
          onRegistered={refresh}
        />
      )}
      {/* V16 白米管理：名單＋搜尋／篩選／排序＋列印入口（僅在年度管理頁出現）。 */}
      {templeEventId && <RiceRegistrationList templeEventId={templeEventId} year={year} reloadTick={reloadTick} />}
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
  const [allowOverbook, setAllowOverbook] = useState(summary.allowOverbook);
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
        body: JSON.stringify({ totalKg: t, unitPrice: u, open, allowOverbook, note }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "儲存失敗");
      setMsg("已儲存白米年度配額。修改單價不影響既有報名（既有報名金額為建立當下鎖定價）。");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "儲存失敗");
    } finally { setSaving(false); }
  }

  return (
    <div className="rounded-3xl bg-white/70 p-4 shadow-card">
      <h3 className="text-sm font-medium text-ink">白米年度配額設定（民國 {summary.year} 年）</h3>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs text-ink-soft">年度總量（斤）
          <input value={totalKg} onChange={(e) => setTotalKg(e.target.value)} disabled={!canEdit} inputMode="decimal"
            className="mt-1 w-full rounded-xl border border-cream-200 bg-cream-50 px-3 py-2 text-sm min-h-[44px]" />
        </label>
        <label className="text-xs text-ink-soft">每斤金額（元）
          <input value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} disabled={!canEdit} inputMode="decimal"
            className="mt-1 w-full rounded-xl border border-cream-200 bg-cream-50 px-3 py-2 text-sm min-h-[44px]" />
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <input type="checkbox" className="h-5 w-5" checked={open} onChange={(e) => setOpen(e.target.checked)} disabled={!canEdit} />
          開放認購
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <input type="checkbox" className="h-5 w-5" checked={allowOverbook} onChange={(e) => setAllowOverbook(e.target.checked)} disabled={!canEdit} />
          允許超量認購（關閉時，所有人員都不得超過剩餘量）
        </label>
        <label className="text-xs text-ink-soft sm:col-span-2">備註
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
      {!canEdit && <p className="mt-2 text-xs text-ink-faint">白米年度設定僅限管理員調整，您目前僅能查看。</p>}
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
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cell("年度總量", summary.totalKg !== null ? `${summary.totalKg} 斤` : "未設定")}
        {cell("已認購", `${summary.registeredKg} 斤（${summary.count} 筆）`)}
        {cell("剩餘可認購", `${summary.remainingKg} 斤`, summary.isOverbooked)}
        {cell("每斤金額", summary.unitPrice !== null ? `${summary.unitPrice} 元` : "未設定")}
        {cell("認購總金額", `${summary.totalAmountDue} 元`)}
        {cell("已收金額", `${summary.totalAmountPaid} 元`)}
        {cell("未收金額", `${summary.totalAmountUnpaid} 元`)}
        {cell("狀態", summary.open ? (summary.allowOverbook ? "開放（允許超量）" : "開放中") : "未開放")}
      </div>
      {summary.isOverbooked && (
        <div className="rounded-2xl bg-blossom-100 px-3 py-2 text-xs text-blossom-500">
          ⚠️ 目前已超量認購 {Math.abs(summary.remainingKg)} 斤{summary.allowOverbook ? "（本年度已開放超量）" : "（本年度未開放超量，請檢查資料）"}。
        </div>
      )}
    </div>
  );
}

type RiceRow = {
  registrationItemId: string;
  householdName: string;
  memberName: string | null;
  quantity: number;
  amountDue: number;
  amountPaid: number;
  amountUnpaid: number;
  status: string;
};

function statusLabel(s: string): string {
  if (s === "CONFIRMED") return "已確認";
  if (s === "DRAFT") return "草稿";
  if (s === "CANCELLED") return "已取消";
  return s;
}

/** V16 白米管理清單：搜尋（姓名／家戶）＋狀態篩選＋排序（斤數／姓名／狀態）＋列印入口。 */
function RiceRegistrationList({ templeEventId, year, reloadTick }: { templeEventId: string; year: number; reloadTick: number }) {
  const [rows, setRows] = useState<RiceRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "CONFIRMED" | "DRAFT">("ALL");
  const [sortKey, setSortKey] = useState<"kgDesc" | "kgAsc" | "name" | "status">("kgDesc");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/temple-events/${templeEventId}/rice-registrations`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "載入失敗");
        return r.json();
      })
      .then((d) => { if (!cancelled) { setRows(d.rows ?? []); setErr(null); } })
      .catch((e) => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [templeEventId, reloadTick]);

  const filtered = (rows ?? [])
    .filter((r) => statusFilter === "ALL" || r.status === statusFilter)
    .filter((r) => {
      const s = q.trim();
      if (!s) return true;
      return (r.memberName ?? "").includes(s) || r.householdName.includes(s);
    })
    .sort((a, b) => {
      if (sortKey === "kgDesc") return b.quantity - a.quantity;
      if (sortKey === "kgAsc") return a.quantity - b.quantity;
      if (sortKey === "name") return (a.memberName ?? a.householdName).localeCompare(b.memberName ?? b.householdName, "zh-Hant");
      return statusLabel(a.status).localeCompare(statusLabel(b.status), "zh-Hant");
    });

  const totalKg = filtered.reduce((s, r) => s + r.quantity, 0);

  return (
    <div className="rounded-3xl bg-white/70 p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">白米認購名單</h3>
        <a
          href={`/print-center/rosters/US_RICE/${year}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-full bg-yolk-200 px-4 py-2 text-xs text-ink hover:bg-yolk-300"
        >
          🖨 列印名單（姓名＋斤數）
        </a>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋姓名／家戶"
          className="min-h-[40px] flex-1 rounded-xl border border-cream-200 bg-cream-50 px-3 py-2 text-sm" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "ALL" | "CONFIRMED" | "DRAFT")}
          className="min-h-[40px] rounded-xl border border-cream-200 bg-cream-50 px-3 py-2 text-sm">
          <option value="ALL">全部狀態</option>
          <option value="CONFIRMED">已確認</option>
          <option value="DRAFT">草稿</option>
        </select>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as "kgDesc" | "kgAsc" | "name" | "status")}
          className="min-h-[40px] rounded-xl border border-cream-200 bg-cream-50 px-3 py-2 text-sm">
          <option value="kgDesc">斤數（多→少）</option>
          <option value="kgAsc">斤數（少→多）</option>
          <option value="name">姓名</option>
          <option value="status">狀態</option>
        </select>
      </div>
      {err && <p className="mt-2 text-xs text-blossom-500">{err}</p>}
      {rows === null && !err && <p className="mt-3 text-xs text-ink-faint">載入名單中…</p>}
      {rows !== null && (
        <div className="mt-3 max-h-[420px] overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-ink/20 text-xs text-ink-faint">
                <th className="px-2 py-1.5">姓名</th>
                <th className="px-2 py-1.5">家戶</th>
                <th className="px-2 py-1.5">斤數</th>
                <th className="px-2 py-1.5">應收</th>
                <th className="px-2 py-1.5">未收</th>
                <th className="px-2 py-1.5">狀態</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.registrationItemId} className="border-b border-ink/10">
                  <td className="px-2 py-1.5 text-ink">{r.memberName ?? "—"}</td>
                  <td className="px-2 py-1.5 text-ink-soft">{r.householdName}</td>
                  <td className="px-2 py-1.5 text-ink-soft">{r.quantity} 斤</td>
                  <td className="px-2 py-1.5 text-ink-soft">{r.amountDue} 元</td>
                  <td className="px-2 py-1.5 text-ink-soft">{r.amountUnpaid} 元</td>
                  <td className="px-2 py-1.5 text-ink-soft">{statusLabel(r.status)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-ink/20 text-sm text-ink">
                <td className="px-2 py-1.5" colSpan={2}>合計（{filtered.length} 筆）</td>
                <td className="px-2 py-1.5">{totalKg} 斤</td>
                <td className="px-2 py-1.5" colSpan={3} />
              </tr>
            </tfoot>
          </table>
          {filtered.length === 0 && <p className="mt-3 text-xs text-ink-faint">沒有符合條件的白米認購。</p>}
        </div>
      )}
    </div>
  );
}

function RiceRegisterForm({ year, ritualRecordId, summary, members, onRegistered }: {
  year: number; ritualRecordId: string; summary: Summary; members: { id: string; name: string }[]; onRegistered: () => void;
}) {
  const [memberId, setMemberId] = useState<string>("");
  const [kg, setKg] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const kgNum = Number(kg);
  const kgValid = Number.isFinite(kgNum) && Number.isInteger(kgNum) && kgNum > 0;
  const previewDue = kgValid ? computeRiceAmountDue(kgNum, summary.unitPrice) : null;
  const willOverbook = kgValid && kgNum > summary.remainingKg;
  // V16：未開放超量時，任何角色都不得超過剩餘量（無填理由覆寫）。
  const blockedByQuota = willOverbook && !summary.allowOverbook;

  async function register() {
    if (!summary.open) { setErr("白米尚未開放認購"); return; }
    if (!Number.isFinite(kgNum) || kgNum <= 0) { setErr("請輸入大於 0 的認購斤數"); return; }
    if (!Number.isInteger(kgNum)) { setErr("認購斤數必須是正整數（不接受小數）"); return; }
    if (summary.unitPrice === null) { setErr("尚未設定白米年度單價，無法認購"); return; }
    if (blockedByQuota) {
      setErr(`白米可認購量不足：年度總量 ${summary.totalKg ?? 0} 斤、已認購 ${summary.registeredKg} 斤、本次增加 ${kgNum} 斤、剩餘 ${summary.remainingKg} 斤、將超出 ${kgNum - summary.remainingKg} 斤（本年度未開放超量認購）。`);
      return;
    }
    setSaving(true); setErr(null); setMsg(null);
    try {
      const res = await fetch(`/api/universal-salvation/${year}/rice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ritualRecordId, memberId: memberId || null, kg: kgNum }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "認購建立失敗");
      setMsg(`已建立白米認購：應收 ${data?.amountDue ?? 0} 元${data?.overage ? "（本年度已開放超量）" : ""}。`);
      setKg("");
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
        <label className="text-xs text-ink-soft">認購斤數（正整數）
          <input value={kg} onChange={(e) => setKg(e.target.value)} inputMode="numeric"
            className="mt-1 w-full rounded-xl border border-cream-200 bg-cream-50 px-3 py-2 text-sm min-h-[44px]" />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink-soft">
        <span>每斤金額：{summary.unitPrice !== null ? `${summary.unitPrice} 元` : "未設定"}</span>
        <span>應收（試算）：{previewDue !== null ? `${previewDue} 元` : "—"}</span>
        <span className={willOverbook ? "text-blossom-500" : ""}>剩餘可認購：{summary.remainingKg} 斤</span>
      </div>
      {blockedByQuota && (
        <p className="mt-2 text-xs text-blossom-500">
          剩餘不足：本次 {kgNum} 斤將超出剩餘 {summary.remainingKg} 斤（超出 {kgNum - summary.remainingKg} 斤）。本年度未開放超量認購，無法建立。
        </p>
      )}
      {willOverbook && summary.allowOverbook && (
        <p className="mt-2 text-xs text-honey-500">本次將超量認購（超出 {kgNum - summary.remainingKg} 斤）；本年度已開放超量，將記錄操作人。</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={register} disabled={saving || !summary.open || blockedByQuota || !kgValid} className="rounded-full bg-sage-200 px-5 py-2 text-sm text-ink min-h-[44px] disabled:opacity-40">
          {saving ? "建立中…" : "建立認購"}
        </button>
        {msg && <span className="text-xs text-sage-500">{msg}</span>}
        {err && <span className="text-xs text-blossom-500">{err}</span>}
      </div>
    </div>
  );
}
