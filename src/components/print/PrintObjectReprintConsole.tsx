"use client";

/**
 * V36.2：列印物件查詢／補印準備（只讀）。
 * 列表主體＝每一筆實體列印物件（依 quantity 展開），不合併家戶、不以數量單列。
 * 「查看預覽」導向既有唯讀正式列印頁；「準備補印」只顯示補印摘要，不寫入任何資料。
 * 響應式：桌機表格、手機卡片。
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  filterAndSortPrintObjectRows,
  type PrintObjectRow,
  type PrintObjectFilters,
} from "@/lib/printObjectRosterFilter";

function statusLabel(s: string) {
  return s === "CONFIRMED" ? "已確認" : s === "DRAFT" ? "草稿" : s === "CANCELLED" ? "已取消" : s;
}
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

export default function PrintObjectReprintConsole({ rows, year }: { rows: PrintObjectRow[]; year: number }) {
  const [f, setF] = useState<PrintObjectFilters>({ printed: "all", firstReprint: "all", dateField: "created", sort: "workNoAsc" });
  const [reprintKey, setReprintKey] = useState<string | null>(null);

  const activityOptions = useMemo(() => [...new Set(rows.map((r) => r.activityName))].sort(), [rows]);
  const typeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.typeKey, r.typeLabel);
    return [...m.entries()].map(([key, label]) => ({ key, label }));
  }, [rows]);
  const statusOptions = useMemo(() => [...new Set(rows.map((r) => r.reportStatus))], [rows]);

  const view = useMemo(() => filterAndSortPrintObjectRows(rows, f), [rows, f]);
  const set = (patch: Partial<PrintObjectFilters>) => setF((p) => ({ ...p, ...patch }));

  const printedCount = view.filter((r) => r.copyPrinted).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg text-ink">列印物件查詢／補印準備（民國 {year} 年）</h1>
        <p className="text-xs text-ink-faint">共 {view.length} 筆列印物件（已列印 {printedCount}）・每一份獨立一列</p>
      </div>

      {/* 篩選 */}
      <div className="grid grid-cols-1 gap-2 rounded-2xl bg-white/70 p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4">
        <Field label="活動">
          <select className="ipt" value={f.activityName ?? ""} onChange={(e) => set({ activityName: e.target.value || undefined })}>
            <option value="">全部活動</option>
            {activityOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="列印品類型">
          <select className="ipt" value={f.typeKey ?? ""} onChange={(e) => set({ typeKey: e.target.value || undefined })}>
            <option value="">全部類型</option>
            {typeOptions.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="作業編號 No."><input className="ipt" value={f.workNo ?? ""} onChange={(e) => set({ workNo: e.target.value || undefined })} placeholder="例如 12" /></Field>
        <Field label="家戶編號"><input className="ipt" value={f.householdCode ?? ""} onChange={(e) => set({ householdCode: e.target.value || undefined })} placeholder="F00001" /></Field>
        <Field label="戶名"><input className="ipt" value={f.householdName ?? ""} onChange={(e) => set({ householdName: e.target.value || undefined })} placeholder="周家" /></Field>
        <Field label="姓名／主文／陽上人"><input className="ipt" value={f.keyword ?? ""} onChange={(e) => set({ keyword: e.target.value || undefined })} placeholder="關鍵字" /></Field>
        <Field label="列印狀態">
          <select className="ipt" value={f.printed} onChange={(e) => set({ printed: e.target.value as PrintObjectFilters["printed"] })}>
            <option value="all">全部</option>
            <option value="printed">已列印</option>
            <option value="unprinted">未列印</option>
          </select>
        </Field>
        <Field label="首印／補印">
          <select className="ipt" value={f.firstReprint} onChange={(e) => set({ firstReprint: e.target.value as PrintObjectFilters["firstReprint"] })}>
            <option value="all">全部</option>
            <option value="first">首印（未曾列印）</option>
            <option value="reprint">補印（已列印過）</option>
          </select>
        </Field>
        <Field label="報名狀態">
          <select className="ipt" value={f.reportStatus ?? ""} onChange={(e) => set({ reportStatus: e.target.value || undefined })}>
            <option value="">全部</option>
            {statusOptions.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        </Field>
        <Field label="日期欄位">
          <select className="ipt" value={f.dateField} onChange={(e) => set({ dateField: e.target.value as PrintObjectFilters["dateField"] })}>
            <option value="created">建立日期</option>
            <option value="printed">最後列印日期</option>
          </select>
        </Field>
        <Field label="起"><input type="date" className="ipt" value={f.dateFrom ?? ""} onChange={(e) => set({ dateFrom: e.target.value || undefined })} /></Field>
        <Field label="迄"><input type="date" className="ipt" value={f.dateTo ?? ""} onChange={(e) => set({ dateTo: e.target.value || undefined })} /></Field>
        <Field label="No. 排序">
          <select className="ipt" value={f.sort} onChange={(e) => set({ sort: e.target.value as PrintObjectFilters["sort"] })}>
            <option value="workNoAsc">升冪（小→大）</option>
            <option value="workNoDesc">降冪（大→小）</option>
          </select>
        </Field>
        <div className="flex items-end">
          <button type="button" onClick={() => setF({ printed: "all", firstReprint: "all", dateField: "created", sort: "workNoAsc" })} className="min-h-10 w-full rounded-full bg-cream-200 px-3 text-sm text-ink-soft hover:bg-cream-300">清除篩選</button>
        </div>
      </div>

      {view.length === 0 ? (
        <p className="rounded-2xl bg-white/70 p-6 text-center text-sm text-ink-faint">沒有符合條件的列印物件。</p>
      ) : (
        <>
          {/* 桌機表格 */}
          <div className="hidden overflow-x-auto rounded-2xl bg-white/70 shadow-card lg:block">
            <table className="w-full min-w-[1200px] text-left text-xs">
              <thead>
                <tr className="border-b border-cream-200 text-ink-faint">
                  {["No.", "份", "活動", "類型", "家戶", "報名人", "主文", "陽上人", "地址", "首印", "最後列印", "次數", "列印", "報名狀態", "操作"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.map((r) => (
                  <tr key={r.rowKey} className="border-b border-cream-100 align-top">
                    <td className="px-2 py-2 font-medium text-ink">{r.workNo ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-ink-faint">{r.copyIndex}/{r.copyCount}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-ink-soft">{r.activityName}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-ink-soft">{r.typeLabel}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-ink-soft">{r.householdCode}｜{r.householdName}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-ink-soft">{r.registrantName}</td>
                    <td className="px-2 py-2 text-ink">{r.mainText}</td>
                    <td className="px-2 py-2 text-ink-soft">{r.yangshang.join("、") || "—"}</td>
                    <td className="px-2 py-2 text-ink-faint">{r.address || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-ink-faint">{day(r.firstPrintedAt)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-ink-faint">{day(r.lastPrintedAt)}</td>
                    <td className="px-2 py-2 text-ink-soft">{r.printCount}</td>
                    <td className="whitespace-nowrap px-2 py-2">{r.copyPrinted ? <span className="text-ink-soft">已列印</span> : <span className="text-blossom-500">未列印</span>}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-ink-soft">{statusLabel(r.reportStatus)}</td>
                    <td className="whitespace-nowrap px-2 py-2">
                      <div className="flex gap-1">
                        <Link href={r.previewHref} className="rounded-full bg-mist-100 px-2 py-1 text-ink-soft hover:bg-mist-200">預覽</Link>
                        <button type="button" onClick={() => setReprintKey(reprintKey === r.rowKey ? null : r.rowKey)} className="rounded-full bg-yolk-100 px-2 py-1 text-ink hover:bg-yolk-200">補印</button>
                      </div>
                      {reprintKey === r.rowKey && <ReprintSummary r={r} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 手機／平板卡片 */}
          <div className="flex flex-col gap-2 lg:hidden">
            {view.map((r) => (
              <div key={r.rowKey} className="rounded-2xl bg-white/70 p-4 shadow-soft">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-cream-200 px-2 py-0.5 text-xs text-ink">No. {r.workNo ?? "—"}・第 {r.copyIndex}/{r.copyCount} 份</span>
                  <span className="text-xs">{r.copyPrinted ? <span className="text-ink-soft">已列印</span> : <span className="text-blossom-500">未列印</span>}</span>
                </div>
                <p className="mt-2 text-sm text-ink">{r.mainText}<span className="ml-2 text-xs text-ink-faint">{r.typeLabel}</span></p>
                <p className="mt-0.5 text-xs text-ink-soft">{r.activityName}・{statusLabel(r.reportStatus)}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div><span className="text-ink-faint">家戶：</span><span className="text-ink-soft">{r.householdCode}｜{r.householdName}</span></div>
                  <div><span className="text-ink-faint">報名人：</span><span className="text-ink-soft">{r.registrantName}</span></div>
                  <div><span className="text-ink-faint">陽上人：</span><span className="text-ink-soft">{r.yangshang.join("、") || "—"}</span></div>
                  <div><span className="text-ink-faint">次數：</span><span className="text-ink-soft">{r.printCount}（首印 {day(r.firstPrintedAt)}／最後 {day(r.lastPrintedAt)}）</span></div>
                  <div className="col-span-2"><span className="text-ink-faint">地址：</span><span className="text-ink-soft">{r.address || "—"}</span></div>
                </dl>
                <div className="mt-2 flex gap-2">
                  <Link href={r.previewHref} className="flex-1 rounded-full bg-mist-100 px-3 py-1.5 text-center text-xs text-ink-soft hover:bg-mist-200">查看預覽</Link>
                  <button type="button" onClick={() => setReprintKey(reprintKey === r.rowKey ? null : r.rowKey)} className="flex-1 rounded-full bg-yolk-100 px-3 py-1.5 text-xs text-ink hover:bg-yolk-200">準備補印</button>
                </div>
                {reprintKey === r.rowKey && <ReprintSummary r={r} />}
              </div>
            ))}
          </div>
        </>
      )}

      <p className="text-xs text-ink-faint">此為只讀介面：不會寫入首印／最後列印時間、不增加列印次數、不改作業編號、不建立列印批次，也不改任何報名／財務資料。</p>
      <style jsx>{`
        .ipt { min-height: 2.5rem; border-radius: 9999px; border: 1px solid var(--cream-200, #e6ddc9); background: #faf7f0; padding: 0 0.75rem; font-size: 0.875rem; color: #2c2a27; width: 100%; }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-ink-faint">
      {label}
      {children}
    </label>
  );
}

/** 補印摘要（只讀）：只顯示這一份若補印會用到的內容，不執行任何寫入。 */
function ReprintSummary({ r }: { r: PrintObjectRow }) {
  return (
    <div className="mt-2 rounded-xl bg-yolk-50 px-3 py-2 text-xs leading-relaxed text-ink-soft">
      <p className="font-medium text-ink">補印摘要（只讀，未執行）</p>
      <p>No. {r.workNo ?? "—"}・{r.typeLabel}・第 {r.copyIndex}/{r.copyCount} 份</p>
      <p>主文：{r.mainText}</p>
      <p>陽上人：{r.yangshang.join("、") || "—"}</p>
      <p>地址：{r.address || "—"}</p>
      <p>家戶：{r.householdCode}｜{r.householdName}・報名人：{r.registrantName}</p>
      <p>目前列印次數：{r.printCount}（{r.firstVsReprint === "reprint" ? "已列印過，屬補印" : "尚未列印，屬首印"}）</p>
      <p className="mt-1 text-ink-faint">＊本輪不寫入 printedAt／lastPrintedAt／printCount，也不建立列印批次。實際補印請走既有列印流程。</p>
    </div>
  );
}
