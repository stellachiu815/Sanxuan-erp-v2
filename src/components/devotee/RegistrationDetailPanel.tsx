"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchRegistration } from "@/lib/registrationFetch";
import { groupRowsForDisplay } from "@/lib/registrationDetailShape";

/**
 * V30.6 信眾「活動」分頁：某筆中元普渡報名的可展開「報名明細」作業區（唯讀顯示）。
 * 每一筆實際報名項目／列印物件逐列顯示（不合併）；操作一律導向既有正式編輯／列印入口（不建第二套）。
 */

type Row = {
  id: string; kind: string; registrationOrder: number | null; itemName: string; subject: string;
  quantity: number; quantityUnit: string | null; yangshang: string[]; address: string | null;
  amountDue: number; amountPaid: number; amountUnpaid: number; status: string; printStatus: string;
  printCount: number; lastPrintedAt: string | null; pocketKind: "BASIC" | "EXTRA" | null;
  chargeable: boolean | null; printName: string | null; section: "ACTIVE" | "DRAFT" | "CANCELLED"; missing: string[];
  parentEntryId: string | null;
  needsReprint: boolean;
};
const reprintBadge = (r: Row) => (r.needsReprint ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700">需補印</span> : null);
type Summary = { itemCount: number; printObjectCount: number; amountDue: number; amountPaid: number; amountUnpaid: number; hasUnprintable: boolean };
type CategorySummary = {
  tablets: { itemName: string; count: number }[];
  sponsors: { itemName: string; count: number }[];
  riceKg: number; basicPocket: number; extraPocket: number; draftCount: number; cancelledCount: number;
};
type Detail = { empty: boolean; editHref: string; year: number; summary: Summary; categorySummary: CategorySummary; rows: Row[] };

const money = (n: number) => `$${n.toLocaleString()}`;
const dateShort = (s: string | null) => (s ? s.slice(0, 10) : "—");

function subjectCell(r: Row): string {
  if (r.kind === "POCKET") {
    const tag = r.pocketKind === "EXTRA" ? "額外寶袋" : "基本寶袋";
    const fee = r.chargeable ? "收費" : "免費";
    return `${tag}（${fee}）${r.printName ? "｜" + r.printName : ""}`;
  }
  const qty = r.quantityUnit ? `${r.quantity}${r.quantityUnit}` : null;
  return `${r.subject}${qty ? "｜" + qty : ""}`;
}

export default function RegistrationDetailPanel({ ritualRecordId }: { ritualRecordId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetchRegistration(`/api/registrations/${ritualRecordId}/detail`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError(data?.error ?? "讀取報名明細失敗"); return; }
        setDetail(data.detail); setError(null);
      } catch {
        if (!cancelled) setError("讀取報名明細時發生連線問題");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ritualRecordId]);

  if (loading) return <p className="px-3 py-2 text-xs text-ink-faint">載入報名明細中…</p>;
  if (error) return <p className="px-3 py-2 text-xs text-rose-600">{error}</p>;
  if (!detail) return null;

  const printCenterHref = `/universal-salvation/${detail.year}/print-center`;
  const ops = (r: Row) => {
    const canPrint = r.kind === "TABLET" || r.kind === "POCKET";
    return (
      <span className="flex flex-wrap gap-1">
        <Link href={detail.editHref} className="text-yolk-700 underline">查看/編輯</Link>
        {canPrint && r.section === "ACTIVE" && (
          <Link href={printCenterHref} className="text-sage-700 underline">預覽/列印/補印</Link>
        )}
      </span>
    );
  };

  const section = (title: string, rows: Row[], note?: string) =>
    rows.length === 0 ? null : (
      <div className="mt-2">
        <p className="mb-1 text-xs font-medium text-ink-soft">{title}{note ? <span className="ml-2 text-ink-faint">{note}</span> : null}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-ink-faint">
                <th className="px-2 py-1">順序</th><th className="px-2 py-1">項目</th><th className="px-2 py-1">內容</th>
                <th className="px-2 py-1">陽上／報名者</th><th className="px-2 py-1">列印地址</th>
                <th className="px-2 py-1 text-right">應收</th><th className="px-2 py-1 text-right">已收</th><th className="px-2 py-1 text-right">未收</th>
                <th className="px-2 py-1">報名狀態</th><th className="px-2 py-1">列印狀態</th><th className="px-2 py-1">最後列印</th><th className="px-2 py-1">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-cream-200">
                  <td className="px-2 py-1 text-ink-soft">{r.registrationOrder ?? "—"}</td>
                  <td className="px-2 py-1 text-ink">{r.itemName}</td>
                  <td className="px-2 py-1 text-ink-soft">{subjectCell(r)}{r.missing.length > 0 && <span className="ml-1 text-rose-600">（{r.missing.join("、")}）</span>}</td>
                  <td className="px-2 py-1 text-ink-soft">{r.yangshang.join("、") || "—"}</td>
                  <td className="px-2 py-1 text-ink-faint">{r.address || "—"}</td>
                  <td className="px-2 py-1 text-right text-ink-soft">{money(r.amountDue)}</td>
                  <td className="px-2 py-1 text-right text-ink-soft">{money(r.amountPaid)}</td>
                  <td className="px-2 py-1 text-right text-ink-soft">{money(r.amountUnpaid)}</td>
                  <td className="px-2 py-1 text-ink-soft">{r.status}</td>
                  <td className="px-2 py-1 text-ink-soft">{r.printStatus}（{r.printCount}）</td>
                  <td className="px-2 py-1 text-ink-faint">{dateShort(r.lastPrintedAt)}</td>
                  <td className="px-2 py-1">{ops(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );

  // §10 有效報名分組：牌位為主列，基本/額外寶袋掛在其下（縮排子項）；白米/贊普為獨立列；
  // 無 sourceEntryId 或找不到牌位的寶袋放「未配對寶袋」區（不隱藏、標示需人工確認）。不改列印物件數。
  const pocketLine = (r: Row) => `${subjectCell(r)}｜No.${r.registrationOrder ?? "—"}｜${r.printStatus}（${r.printCount}）`;
  const groupedActive = (rows: Row[]) => {
    const { groups, unpairedPockets, others } = groupRowsForDisplay(rows);
    return (
      <div className="mt-2">
        <p className="mb-1 text-xs font-medium text-ink-soft">有效報名（正式名單／列印）</p>
        <div className="flex flex-col gap-1 text-xs">
          {groups.map((g) => (
            <div key={g.tablet.id} className="rounded-lg bg-white/60 px-2 py-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">No.{g.tablet.registrationOrder ?? "—"}</span>
                <span className="text-ink">{g.tablet.itemName}｜{subjectCell(g.tablet)}</span>
                <span className="text-ink-faint">{g.tablet.address || "—"}</span>
                <span className="text-ink-soft">{g.tablet.printStatus}（{g.tablet.printCount}）</span>
                {reprintBadge(g.tablet)}
                {ops(g.tablet)}
              </div>
              {g.pockets.map((p) => (
                <div key={p.id} className="ml-4 flex flex-wrap items-center gap-2 text-ink-soft">
                  <span>└ {pocketLine(p)}</span>
                  {reprintBadge(p)}
                  {ops(p)}
                </div>
              ))}
            </div>
          ))}
          {others.map((o) => (
            <div key={o.id} className="rounded-lg bg-white/60 px-2 py-1 flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink">No.{o.registrationOrder ?? "—"}</span>
              <span className="text-ink">{o.itemName}｜{subjectCell(o)}</span>
              <span className="text-ink-soft">{o.printStatus}（{o.printCount}）</span>
              {ops(o)}
            </div>
          ))}
        </div>
        {unpairedPockets.length > 0 && (
          <div className="mt-2">
            <p className="mb-1 text-xs font-medium text-rose-600">未配對寶袋（找不到依附牌位，需人工確認）</p>
            <div className="flex flex-col gap-1 text-xs">
              {unpairedPockets.map((p) => (
                <div key={p.id} className="rounded-lg bg-rose-50 px-2 py-1 flex flex-wrap items-center gap-2">
                  <span>{pocketLine(p)}</span>
                  {ops(p)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const s = detail.summary;
  return (
    <div className="rounded-2xl bg-cream-50/60 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-soft">
          報名項目 {s.itemCount}｜列印物件 {s.printObjectCount}｜應收 {money(s.amountDue)}／已收 {money(s.amountPaid)}／未收 {money(s.amountUnpaid)}
          {s.hasUnprintable && <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-rose-600">含無法正式列印/草稿資料</span>}
        </p>
        <Link href={detail.editHref} className="text-xs text-yolk-700 underline">前往正式編輯頁 →</Link>
      </div>
      {!detail.empty && (
        <div className="mb-2 rounded-xl bg-white/60 px-3 py-2 text-sm text-ink">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {detail.categorySummary.tablets.map((t) => (<span key={t.itemName}>✔ {t.itemName} × {t.count}</span>))}
            {detail.categorySummary.riceKg > 0 && <span>✔ 白米 {detail.categorySummary.riceKg} 斤</span>}
            {detail.categorySummary.basicPocket > 0 && <span>✔ 基本寶袋 × {detail.categorySummary.basicPocket}</span>}
            {detail.categorySummary.extraPocket > 0 && <span>✔ 額外寶袋 × {detail.categorySummary.extraPocket}</span>}
            {detail.categorySummary.sponsors.map((s2) => (<span key={s2.itemName}>✔ {s2.itemName} × {s2.count}</span>))}
          </div>
          {(detail.categorySummary.draftCount > 0 || detail.categorySummary.cancelledCount > 0) && (
            <div className="mt-1 flex gap-2 text-xs">
              {detail.categorySummary.draftCount > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">草稿 {detail.categorySummary.draftCount}（未計入有效摘要）</span>}
              {detail.categorySummary.cancelledCount > 0 && <span className="rounded-full bg-ink-faint/10 px-2 py-0.5 text-ink-faint">已取消 {detail.categorySummary.cancelledCount}</span>}
            </div>
          )}
        </div>
      )}
      {detail.empty ? (
        <p className="px-1 py-2 text-sm text-ink-faint">尚無報名項目（此報名尚未建立任何牌位／白米／寶袋等內容）。</p>
      ) : (
        <>
          {groupedActive(detail.rows.filter((r) => r.section === "ACTIVE"))}
          {section("草稿（不進正式名單／列印）", detail.rows.filter((r) => r.section === "DRAFT"), "完成缺漏並確認後才會進入正式名單")}
          {section("已取消（歷史）", detail.rows.filter((r) => r.section === "CANCELLED"))}
        </>
      )}
    </div>
  );
}
