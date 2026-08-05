"use client";

/**
 * V36.1：活動參加名單（只讀）——**每一筆報名項目**為一列，不再以家戶摘要合併。
 * 只呈現既有資料，不新增/修改/刪除；篩選、搜尋、排序皆為前端記憶體操作。
 * 響應式：桌機為表格、手機為卡片。
 */
import { useMemo, useState } from "react";
import {
  filterAndSortParticipantRows,
  type ParticipantItemRow,
  type ParticipantFilters,
} from "@/lib/activityParticipantRosterFilter";

function money(n: number) {
  return n.toLocaleString("zh-Hant");
}
function printLabel(r: ParticipantItemRow) {
  if (r.printCount <= 0) return "未列印";
  return r.printCount > 1 ? `已列印（補印 ${r.printCount - 1} 次）` : "已列印";
}
function statusLabel(s: string) {
  return s === "CONFIRMED" ? "已確認" : s === "DRAFT" ? "草稿" : s === "CANCELLED" ? "已取消" : s;
}

export default function ActivityParticipantRosterScreen({
  items,
  year,
}: {
  items: ParticipantItemRow[];
  year: number;
}) {
  const [f, setF] = useState<ParticipantFilters>({ payment: "all", print: "all", sort: "workNoAsc" });

  const activityOptions = useMemo(() => [...new Set(items.map((i) => i.activityName))].sort(), [items]);
  const itemTypeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items) if (i.itemTypeKey) m.set(i.itemTypeKey, i.itemTypeName);
    return [...m.entries()].map(([key, name]) => ({ key, name }));
  }, [items]);

  const rows = useMemo(() => filterAndSortParticipantRows(items, f), [items, f]);
  const set = (patch: Partial<ParticipantFilters>) => setF((prev) => ({ ...prev, ...patch }));

  const totalDue = rows.reduce((s, r) => s + r.amountDue, 0);
  const totalPaid = rows.reduce((s, r) => s + r.amountPaid, 0);
  const totalUnpaid = rows.reduce((s, r) => s + r.amountUnpaid, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg text-ink">活動參加名單（民國 {year} 年）</h1>
        <p className="text-xs text-ink-faint">共 {rows.length} 筆報名項目・每一筆獨立顯示，不合併家戶</p>
      </div>

      {/* 篩選與搜尋 */}
      <div className="grid grid-cols-1 gap-2 rounded-2xl bg-white/70 p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          活動
          <select className="min-h-10 rounded-full border border-cream-200 bg-cream-50 px-3 text-sm text-ink" value={f.activityName ?? ""} onChange={(e) => set({ activityName: e.target.value || undefined })}>
            <option value="">全部活動</option>
            {activityOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          報名項目
          <select className="min-h-10 rounded-full border border-cream-200 bg-cream-50 px-3 text-sm text-ink" value={f.itemTypeKey ?? ""} onChange={(e) => set({ itemTypeKey: e.target.value || undefined })}>
            <option value="">全部項目</option>
            {itemTypeOptions.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          家戶編號
          <input className="min-h-10 rounded-full border border-cream-200 bg-cream-50 px-3 text-sm text-ink" value={f.householdCode ?? ""} onChange={(e) => set({ householdCode: e.target.value || undefined })} placeholder="例如 F00001" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          家戶名稱
          <input className="min-h-10 rounded-full border border-cream-200 bg-cream-50 px-3 text-sm text-ink" value={f.householdName ?? ""} onChange={(e) => set({ householdName: e.target.value || undefined })} placeholder="例如 周家" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint sm:col-span-2">
          信眾／陽上人／主文
          <input className="min-h-10 rounded-full border border-cream-200 bg-cream-50 px-3 text-sm text-ink" value={f.keyword ?? ""} onChange={(e) => set({ keyword: e.target.value || undefined })} placeholder="輸入姓名或牌位主文關鍵字" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          收款
          <select className="min-h-10 rounded-full border border-cream-200 bg-cream-50 px-3 text-sm text-ink" value={f.payment} onChange={(e) => set({ payment: e.target.value as ParticipantFilters["payment"] })}>
            <option value="all">全部</option>
            <option value="paid">已收（已收 &gt; 0）</option>
            <option value="unpaid">未收（未收 &gt; 0）</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          列印
          <select className="min-h-10 rounded-full border border-cream-200 bg-cream-50 px-3 text-sm text-ink" value={f.print} onChange={(e) => set({ print: e.target.value as ParticipantFilters["print"] })}>
            <option value="all">全部</option>
            <option value="printed">已列印</option>
            <option value="unprinted">未列印</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          作業編號排序
          <select className="min-h-10 rounded-full border border-cream-200 bg-cream-50 px-3 text-sm text-ink" value={f.sort} onChange={(e) => set({ sort: e.target.value as ParticipantFilters["sort"] })}>
            <option value="workNoAsc">作業編號小 → 大</option>
            <option value="workNoDesc">作業編號大 → 小</option>
          </select>
        </label>
        <div className="flex items-end">
          <button type="button" onClick={() => setF({ payment: "all", print: "all", sort: "workNoAsc" })} className="min-h-10 w-full rounded-full bg-cream-200 px-3 text-sm text-ink-soft hover:bg-cream-300">清除篩選</button>
        </div>
      </div>

      {/* 小計（依目前篩選） */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-sage-100 p-3"><p className="text-xs text-ink-faint">應收合計</p><p className="text-sm text-ink">NT$ {money(totalDue)}</p></div>
        <div className="rounded-2xl bg-yolk-100 p-3"><p className="text-xs text-ink-faint">已收合計</p><p className="text-sm text-ink">NT$ {money(totalPaid)}</p></div>
        <div className="rounded-2xl bg-blossom-100 p-3"><p className="text-xs text-ink-faint">未收合計</p><p className="text-sm text-ink">NT$ {money(totalUnpaid)}</p></div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-white/70 p-6 text-center text-sm text-ink-faint">沒有符合條件的報名項目。</p>
      ) : (
        <>
          {/* 桌機：表格 */}
          <div className="hidden overflow-x-auto rounded-2xl bg-white/70 shadow-card sm:block">
            <table className="w-full min-w-[1100px] text-left text-xs">
              <thead>
                <tr className="border-b border-cream-200 text-ink-faint">
                  {["作業編號", "活動", "報名項目", "家戶編號", "家戶名稱", "報名人", "內容", "陽上人", "地址", "數量", "應收", "已收", "未收", "報名狀態", "列印", "建立時間"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.itemId} className="border-b border-cream-100 align-top">
                    <td className="px-2 py-2 font-medium text-ink">{r.workNo ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-ink-soft">{r.activityName}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-ink-soft">{r.itemTypeName}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-ink-soft">{r.householdCode || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-ink-soft">{r.householdName || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-ink-soft">{r.registrantName}</td>
                    <td className="px-2 py-2 text-ink">{r.content}</td>
                    <td className="px-2 py-2 text-ink-soft">{r.yangshang.join("、") || "—"}</td>
                    <td className="px-2 py-2 text-ink-faint">{r.address ? `${r.address}（${r.addressSource}）` : "—"}</td>
                    <td className="px-2 py-2 text-ink-soft">{r.quantity}</td>
                    <td className="px-2 py-2 text-ink-soft">{money(r.amountDue)}</td>
                    <td className="px-2 py-2 text-ink-soft">{money(r.amountPaid)}</td>
                    <td className={`px-2 py-2 ${r.amountUnpaid > 0 ? "text-blossom-500" : "text-ink-faint"}`}>{money(r.amountUnpaid)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-ink-soft">{statusLabel(r.status)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-ink-soft">{printLabel(r)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-ink-faint">{r.createdAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 手機：卡片 */}
          <div className="flex flex-col gap-2 sm:hidden">
            {rows.map((r) => (
              <div key={r.itemId} className="rounded-2xl bg-white/70 p-4 shadow-soft">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-cream-200 px-2 py-0.5 text-xs text-ink">No. {r.workNo ?? "—"}</span>
                  <span className="text-xs text-ink-faint">{statusLabel(r.status)}・{printLabel(r)}</span>
                </div>
                <p className="mt-2 text-sm text-ink">{r.content}<span className="ml-2 text-xs text-ink-faint">{r.itemTypeName} × {r.quantity}</span></p>
                <p className="mt-1 text-xs text-ink-soft">{r.activityName}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div><span className="text-ink-faint">家戶：</span><span className="text-ink-soft">{r.householdCode || "—"}｜{r.householdName || "—"}</span></div>
                  <div><span className="text-ink-faint">報名人：</span><span className="text-ink-soft">{r.registrantName}</span></div>
                  <div><span className="text-ink-faint">陽上人：</span><span className="text-ink-soft">{r.yangshang.join("、") || "—"}</span></div>
                  <div><span className="text-ink-faint">建立：</span><span className="text-ink-soft">{r.createdAt.slice(0, 10)}</span></div>
                  <div className="col-span-2"><span className="text-ink-faint">地址：</span><span className="text-ink-soft">{r.address ? `${r.address}（${r.addressSource}）` : "—"}</span></div>
                </dl>
                <div className="mt-2 flex items-center justify-between rounded-xl bg-cream-50 px-3 py-2 text-xs">
                  <span className="text-ink-faint">應收 <span className="text-ink-soft">{money(r.amountDue)}</span></span>
                  <span className="text-ink-faint">已收 <span className="text-ink-soft">{money(r.amountPaid)}</span></span>
                  <span className="text-ink-faint">未收 <span className={r.amountUnpaid > 0 ? "text-blossom-500" : "text-ink-soft"}>{money(r.amountUnpaid)}</span></span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="text-xs text-ink-faint">此名單為只讀檢視：資料沿用既有報名項目、牌位、寶袋與 workOrder／registrationOrder，未修改任何資料。</p>
    </div>
  );
}
