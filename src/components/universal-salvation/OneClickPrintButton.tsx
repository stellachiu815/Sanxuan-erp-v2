"use client";

import { useMemo, useState } from "react";
import { primaryButtonClass, secondaryButtonClass, errorTextClass } from "@/components/household/formStyles";
import { fetchUniversalSalvation } from "@/lib/universalSalvationFetch";
import {
  PRINT_BATCH_META,
  filterBatchItems,
  summarizeBatchItems,
  isUnprinted,
  isComplete,
  type PrintBatchKey,
  type BatchItem,
} from "@/lib/TabletBatchService";

/**
 * V27.10：單一列印批次區塊（含一鍵列印）。三個批次各自一個，內容只含**該批次**項目，
 * 因此手動勾選在結構上不可能跨批次。牌位批次（ancestor-soul／creditor）的列印一律導向
 * 專用列印頁；寶袋批次沿用既有「牌位與寶袋列印」版型（本區塊僅顯示統計與導引）。
 *
 * 列印紀錄：開啟專用列印頁／Chrome 預覽都**不**更新 printCount；只有按「確認完成列印」
 * 才呼叫既有 confirm API（printCount++／printedAt／列印批次）。
 */
export default function OneClickPrintButton({
  year,
  batch,
  items,
  onChanged,
}: {
  year: number;
  batch: PrintBatchKey;
  items: BatchItem[];
  onChanged: () => void;
}) {
  const meta = PRINT_BATCH_META[batch];
  const inBatch = useMemo(() => filterBatchItems(items, batch), [items, batch]);
  const summary = useMemo(() => summarizeBatchItems(items, batch), [items, batch]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [printedIds, setPrintedIds] = useState<string[] | null>(null); // 已送去列印頁的 ids（供「確認完成列印」）
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectAllUnprinted() {
    setSelected(new Set(inBatch.filter((i) => isUnprinted(i) && isComplete(i)).map((i) => i.id)));
  }

  function openPrintRoute(ids: string[] | null) {
    const base = `/universal-salvation/${year}/print-center/print?batch=${batch}`;
    const url = ids && ids.length ? `${base}&ids=${ids.join(",")}` : `${base}&scope=unprinted`;
    setPrintedIds(ids && ids.length ? ids : summary.printableIds);
    setError(null);
    setToast(null);
    if (typeof window === "undefined") return;
    // 優先開新分頁（保留本管理頁與確認狀態）；若被彈出視窗封鎖 → 同分頁導向，確保一定進到專用列印頁，
    // 不會停在管理頁被誤按 ⌘P 印到管理介面。
    const win = window.open(url, "_blank", "noopener");
    if (!win) window.location.assign(url);
  }

  function handleOneClick() {
    if (summary.printableComplete === 0) return;
    setShowConfirm(true);
  }

  function handleManualPrint() {
    const chosen = inBatch.filter((i) => selected.has(i.id));
    const incomplete = chosen.filter((i) => !isComplete(i));
    if (chosen.length === 0) return;
    if (incomplete.length > 0) {
      setError(`所選 ${incomplete.length} 筆資料不完整，無法列印；請先補齊或取消勾選。`);
      return;
    }
    openPrintRoute(chosen.map((i) => i.id));
  }

  async function confirmPrinted() {
    if (!printedIds || printedIds.length === 0 || confirming) return;
    setConfirming(true);
    setError(null);
    setToast(null);
    const idempotencyKey =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${batch}-${year}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const res = await fetchUniversalSalvation(`/api/universal-salvation/${year}/print-items/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: printedIds, idempotencyKey }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const detail =
          data?.code === "INCOMPLETE_DATA"
            ? `${data.message ?? "部分項目資料尚未完整"}${Array.isArray(data.missingFields) && data.missingFields.length ? `（缺：${data.missingFields.join("、")}）` : ""}`
            : data?.error ?? `確認失敗（HTTP ${res.status}）`;
        setError(detail);
        return;
      }
      setToast(`已確認完成列印：${printedIds.length} 筆（已累計列印次數並建立列印批次）。`);
      setPrintedIds(null);
      setSelected(new Set());
      onChanged();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <section className="rounded-3xl bg-white/70 p-6 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-block h-4 w-4 rounded-full ${meta.paperDotClass}`} aria-hidden />
        <h2 className="text-base font-medium text-ink">{meta.label}</h2>
        <span className="rounded-full bg-cream-100 px-3 py-1 text-xs text-ink-soft">{meta.paperLabel}</span>
        {meta.usesTabletEngine && (
          <span className="text-xs text-ink-faint">版型 UNIVERSAL_SALVATION_TABLET_A4_V1</span>
        )}
      </div>

      {/* 統計 */}
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-yolk-100 px-3 py-1 text-ink-soft">未列印 {summary.unprintedTotal}</span>
        <span className="rounded-full bg-sage-100 px-3 py-1 text-ink-soft">可列印（完整）{summary.printableComplete}</span>
        <span className="rounded-full bg-blossom-100 px-3 py-1 text-ink-soft">資料不完整 {summary.incompleteCount}</span>
        <span className="rounded-full bg-mist-100 px-3 py-1 text-ink-soft">已列印 {summary.printedCount}</span>
      </div>

      {meta.usesTabletEngine ? (
        <>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className={primaryButtonClass} onClick={handleOneClick} disabled={summary.printableComplete === 0}>
              {meta.oneClickLabel}（{summary.printableComplete}）
            </button>
            {printedIds && printedIds.length > 0 && (
              <button type="button" className={secondaryButtonClass} onClick={confirmPrinted} disabled={confirming}>
                {confirming ? "確認中…" : `✅ 確認完成列印（${printedIds.length}）`}
              </button>
            )}
          </div>

          {/* 手動補印（僅本批次項目，結構上不可能跨批次） */}
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-ink-soft">手動勾選補印／少量列印（{inBatch.length} 筆）</summary>
            <div className="mt-2 flex items-center gap-3">
              <button type="button" className="text-xs text-ink-soft hover:underline" onClick={selectAllUnprinted}>
                全選本區塊未列印（完整）
              </button>
              <button type="button" className="text-xs text-ink-soft hover:underline" onClick={() => setSelected(new Set())}>
                清除
              </button>
              <button type="button" className={secondaryButtonClass + " ml-auto"} onClick={handleManualPrint} disabled={selected.size === 0}>
                列印勾選（{selected.size}）
              </button>
            </div>
            <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-cream-200">
              <table className="w-full text-left text-xs">
                <tbody>
                  {inBatch.map((i) => {
                    const incomplete = !isComplete(i);
                    return (
                      <tr key={i.id} className="border-t border-cream-100">
                        <td className="px-2 py-1">
                          <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                        </td>
                        <td className="px-2 py-1">{i.household.name}（{i.household.id}）</td>
                        <td className="px-2 py-1">{i.sourceCategoryLabel}／{i.sourceDisplayName}</td>
                        <td className="px-2 py-1">{isUnprinted(i) ? "未列印" : `已列印${i.printCount > 1 ? `／補印${i.printCount - 1}` : ""}`}</td>
                        <td className="px-2 py-1 text-red-700">{incomplete ? `缺${i.tabletMissingFields.join("、")}` : ""}</td>
                      </tr>
                    );
                  })}
                  {inBatch.length === 0 && (
                    <tr><td className="px-2 py-3 text-center text-ink-faint" colSpan={5}>本批次目前沒有項目。</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <div className="mt-4 rounded-2xl bg-cream-100/60 p-4 text-sm text-ink-soft">
          寶袋使用既有「牌位與寶袋列印」的紅色紙專用版型，與黃色牌位分開列印。請於本頁上方
          「牌位與寶袋列印」區塊選取寶袋並列印、確認完成列印。（本次不重建第二套寶袋版型。）
        </div>
      )}

      {error && <p className={`mt-3 ${errorTextClass}`}>{error}</p>}
      {toast && <p className="mt-3 text-sm text-sage-700">{toast}</p>}

      {/* 一鍵列印確認摘要 */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowConfirm(false)}>
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium text-ink">確認一鍵列印：{meta.label}</h3>
            <div className="mt-3 space-y-1 text-sm text-ink-soft">
              <p>紙張顏色：<b>{meta.paperLabel}</b></p>
              <p>可列印筆數（未列印且完整）：<b>{summary.printableComplete}</b></p>
              <p>排除筆數（資料不完整）：<b>{summary.incompleteCount}</b></p>
            </div>
            {summary.incompleteDetails.length > 0 && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-medium text-red-700">以下 {summary.incompleteDetails.length} 筆因資料不完整不會送印：</p>
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs text-red-700">
                  {summary.incompleteDetails.map((d) => (
                    <li key={d.id}>{d.household}｜{d.name}｜缺{d.missing.join("、")}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-3">
              <button type="button" className={secondaryButtonClass} onClick={() => setShowConfirm(false)}>取消</button>
              <button
                type="button"
                className={primaryButtonClass}
                disabled={summary.printableComplete === 0}
                onClick={() => { setShowConfirm(false); openPrintRoute(null); }}
              >
                開啟列印頁（{summary.printableComplete}）
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
