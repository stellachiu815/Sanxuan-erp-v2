"use client";

import { useMemo, useState } from "react";
import { primaryButtonClass, secondaryButtonClass, errorTextClass } from "@/components/household/formStyles";
import { fetchUniversalSalvation } from "@/lib/universalSalvationFetch";
import {
  PRINT_BATCH_META,
  summarizeBatchItems,
  type PrintBatchKey,
  type BatchItem,
} from "@/lib/TabletBatchService";

/**
 * V27.13：單一列印批次區塊。**只提供「一鍵列印全部未列印」＋統計＋確認完成列印**。
 *
 * 手動勾選／少量補印一律改到本頁下方「牌位與寶袋列印」（PrintObjectCenter）——
 * 那裡是唯一的手動勾選區，勾選後按「產生列印頁／預覽」會導向同一個牌位專用列印頁。
 * 避免兩個互不同步的勾選清單造成「這裡勾了、那裡顯示 0」的混淆。
 *
 * 列印紀錄：開啟專用列印頁／Chrome 預覽都**不**更新 printCount；只有「確認完成列印」
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
  const summary = useMemo(() => summarizeBatchItems(items, batch), [items, batch]);

  const [showConfirm, setShowConfirm] = useState(false);
  const [printedIds, setPrintedIds] = useState<string[] | null>(null); // 已送去列印頁的 ids（供「確認完成列印」）
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function openOneClickRoute() {
    const ids = summary.printableIds;
    setPrintedIds(ids);
    setError(null);
    setToast(null);
    if (typeof window === "undefined") return;
    const url = `/universal-salvation/${year}/print-center/print?batch=${batch}&scope=unprinted`;
    // 優先新分頁（保留本管理頁與確認狀態）；被彈窗封鎖 → 同分頁導向專用列印頁，絕不停在管理頁列印。
    const win = window.open(url, "_blank", "noopener");
    if (!win) window.location.assign(url);
    // V40 修正：**不再自動標記**。之前「按一鍵列印就自動標記完成」會讓「只是想看資料」也被標記成
    //   已列印（Stella 實測回報：查寶袋沒按列印卻全變已列印）。改回：開了列印頁後，真的印完再按下方
    //   綠色「確認完成列印」才登記——開頁本身不寫任何列印紀錄。
  }

  async function confirmPrinted(idsArg?: string[]) {
    const printed = idsArg ?? printedIds;
    if (!printed || printed.length === 0 || confirming) return;
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
        body: JSON.stringify({ ids: printed, idempotencyKey }),
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
      setToast(`已自動標記完成列印：${printed.length} 筆（已累計列印次數並建立列印批次）。`);
      setPrintedIds(null);
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
        {meta.usesTabletEngine && <span className="text-xs text-ink-faint">版型 UNIVERSAL_SALVATION_TABLET_A4_V1</span>}
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
            <button type="button" className={primaryButtonClass} onClick={() => setShowConfirm(true)} disabled={summary.printableComplete === 0}>
              {meta.oneClickLabel}（{summary.printableComplete}）
            </button>
            {printedIds && printedIds.length > 0 && (
              <button type="button" className={secondaryButtonClass} onClick={() => confirmPrinted()} disabled={confirming}>
                {confirming ? "確認中…" : `✅ 確認完成列印（${printedIds.length}）`}
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-ink-faint">按「{meta.oneClickLabel.replace(/（.*$/, "")}」只會開列印頁，<b>不會標記</b>；真的印完後，再按上面綠色「確認完成列印」才會登記。</p>
          <p className="mt-2 text-xs text-ink-faint">
            少量／補印：請至下方「牌位與寶袋列印」勾選該筆後按「產生列印頁／預覽」，會進入同一個牌位專用列印頁。
          </p>
        </>
      ) : (
        <div className="mt-4 rounded-2xl bg-cream-100/60 p-4 text-sm text-ink-soft">
          寶袋使用既有「牌位與寶袋列印」的紅色紙專用版型，與黃色牌位分開列印。請於本頁下方
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
                onClick={() => { setShowConfirm(false); openOneClickRoute(); }}
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
