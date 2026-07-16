"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import Toast from "@/components/ritual/Toast";
import { errorTextClass, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/household/formStyles";
import StickerSheet from "./StickerSheet";
import StickerCell from "./StickerCell";
import { exportStickerSheetsToPdf } from "./stickerPdfExport";
import { STICKER_SHEET_CLASS } from "./stickerSheet";
import type { PurificationPrintFieldsJson } from "./types";

type FilterKind = "ALL" | "UNPRINTED" | "NUMBER_RANGE" | "NAME";

type PrintBatch = {
  id: string;
  registrationCount: number;
  printedByName: string | null;
  note: string | null;
  createdAt: string;
};

type Props = {
  purificationYearId: string;
  yearName: string;
  initialBatches: PrintBatch[];
};

/**
 * A4 小人頭貼紙列印中心（需求「十一、十二、十三」）。
 *
 * 流程：選篩選條件 →【產生預覽】（純查詢，不會標記已列印）→ 看完整
 * A4 預覽、確認沒有問題 →【最佳化版面】看調整摘要 →【產生列印批次並下載
 * PDF】（這一步才會真的標記已列印、可能鎖定年度）。
 */
export default function PurificationPrintCenter({ purificationYearId, yearName, initialBatches }: Props) {
  const router = useRouter();
  const sheetsContainerRef = useRef<HTMLDivElement>(null);

  const [filterKind, setFilterKind] = useState<FilterKind>("UNPRINTED");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [nameQuery, setNameQuery] = useState("");

  const [previewPages, setPreviewPages] = useState<PurificationPrintFieldsJson[][] | null>(null);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [previewBlocking, setPreviewBlocking] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [committed, setCommitted] = useState(false); // 是否已經真的產生過批次（可以下載 PDF）
  const [batches, setBatches] = useState(initialBatches);

  const [optimizeSummary, setOptimizeSummary] = useState<{
    adjustedCount: number;
    adjustedNames: string[];
    needsReviewNames: string[];
  } | null>(null);

  const [zoomCell, setZoomCell] = useState<PurificationPrintFieldsJson | null>(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState("已完成");
  const [operatorName, setOperatorName] = useState("");

  function showToast(message: string) {
    setToastMessage(message);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2000);
  }

  function buildFilter(): Record<string, unknown> | null {
    if (filterKind === "ALL") return { kind: "ALL" };
    if (filterKind === "UNPRINTED") return { kind: "UNPRINTED" };
    if (filterKind === "NUMBER_RANGE") {
      const from = Number(rangeFrom);
      const to = Number(rangeTo);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) {
        setError("請輸入正確的編號範圍");
        return null;
      }
      return { kind: "NUMBER_RANGE", from, to };
    }
    if (filterKind === "NAME") {
      if (!nameQuery.trim()) {
        setError("請輸入姓名");
        return null;
      }
      return { kind: "NAME", query: nameQuery.trim() };
    }
    return null;
  }

  async function handlePreview() {
    setError(null);
    const filter = buildFilter();
    if (!filter) return;

    setPreviewLoading(true);
    setCommitted(false);
    setOptimizeSummary(null);
    try {
      const res = await fetch(`/api/purification/years/${purificationYearId}/print-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filter }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "產生預覽失敗");
        setPreviewPages(null);
        return;
      }
      setPreviewPages(data.pages);
      setPreviewTotal(data.totalCount);
      setPreviewBlocking(data.blockingCount);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setPreviewLoading(false);
    }
  }

  function handleOptimizeLayout() {
    if (!previewPages) return;
    const allCells = previewPages.flat();
    const adjusted = allCells.filter(
      (c) => c.layout.name.chosenTier.level > 0 || c.layout.middle.chosenTier.level > 0 || c.layout.address.chosenTier.level > 0
    );
    const needsReview = allCells.filter((c) => c.layout.needsManualReview);
    setOptimizeSummary({
      adjustedCount: adjusted.length,
      adjustedNames: adjusted.map((c) => `${c.view.number ?? "—"}．${c.view.displayName}`),
      needsReviewNames: needsReview.map((c) => `${c.view.number ?? "—"}．${c.view.displayName}`),
    });
  }

  async function handleGenerateBatch() {
    setError(null);
    const filter = buildFilter();
    if (!filter) return;
    if (previewBlocking > 0) {
      setError("目前預覽有尚未通過列印前檢查的資料，請先處理待確認清單再產生列印批次。");
      return;
    }

    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/purification/years/${purificationYearId}/print-batches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filter, operatorName: operatorName || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "產生列印批次失敗");
        return;
      }
      setPreviewPages(data.pages);
      setPreviewTotal(data.totalCount);
      setPreviewBlocking(0);
      setCommitted(true);
      setBatches((prev) => [
        { id: data.batchId, registrationCount: data.totalCount, printedByName: operatorName || null, note: null, createdAt: new Date().toISOString() },
        ...prev,
      ]);
      showToast("已產生列印批次，可以下載 PDF");
      router.refresh();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleDownloadPdf() {
    if (!sheetsContainerRef.current) return;
    setPdfGenerating(true);
    setError(null);
    try {
      await exportStickerSheetsToPdf(sheetsContainerRef.current, `${yearName}_小人頭貼紙.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF 產生失敗");
    } finally {
      setPdfGenerating(false);
    }
  }

  const canGenerate = previewPages !== null && previewBlocking === 0 && !committed;
  const canDownload = previewPages !== null;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4 rounded-2xl bg-white/70 p-6 shadow-soft print:hidden">
        <h2 className="text-lg font-medium text-ink">列印篩選條件</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1.5 block text-xs text-ink-soft">篩選方式</label>
            <select className={inputClass + " w-auto"} value={filterKind} onChange={(e) => setFilterKind(e.target.value as FilterKind)}>
              <option value="ALL">全部列印</option>
              <option value="UNPRINTED">尚未列印</option>
              <option value="NUMBER_RANGE">指定編號範圍</option>
              <option value="NAME">指定姓名</option>
            </select>
          </div>
          {filterKind === "NUMBER_RANGE" && (
            <>
              <div>
                <label className="mb-1.5 block text-xs text-ink-soft">從編號</label>
                <input className={inputClass + " w-24"} type="number" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-ink-soft">到編號</label>
                <input className={inputClass + " w-24"} type="number" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
              </div>
            </>
          )}
          {filterKind === "NAME" && (
            <div>
              <label className="mb-1.5 block text-xs text-ink-soft">姓名</label>
              <input className={inputClass + " w-40"} value={nameQuery} onChange={(e) => setNameQuery(e.target.value)} />
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs text-ink-soft">操作人姓名（選填）</label>
            <input className={inputClass + " w-40"} value={operatorName} onChange={(e) => setOperatorName(e.target.value)} />
          </div>
          <button type="button" className={secondaryButtonClass + " border border-cream-300"} onClick={handlePreview} disabled={previewLoading}>
            {previewLoading ? "產生中…" : "產生預覽"}
          </button>
        </div>

        {error && <p className={errorTextClass}>{error}</p>}

        {previewPages && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-ink-soft">
            <span>共 {previewTotal} 筆，{previewPages.length} 張 A4</span>
            {previewBlocking > 0 ? (
              <span className="rounded-full bg-blossom-100 px-3 py-1 text-xs text-ink-soft">
                ⚠ {previewBlocking} 筆尚未通過列印前檢查，不能列印
              </span>
            ) : (
              <span className="rounded-full bg-sage-100 px-3 py-1 text-xs text-ink-soft">全部通過列印前檢查</span>
            )}
          </div>
        )}

        {previewPages && (
          <div className="flex flex-wrap gap-3">
            <button type="button" className={secondaryButtonClass + " border border-cream-300"} onClick={handleOptimizeLayout}>
              最佳化版面
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              onClick={handleGenerateBatch}
              disabled={!canGenerate || previewLoading}
            >
              產生列印批次
            </button>
            <button
              type="button"
              className={secondaryButtonClass + " border border-cream-300"}
              onClick={handleDownloadPdf}
              disabled={!canDownload || pdfGenerating}
            >
              {pdfGenerating ? "PDF 產生中…" : committed ? "下載 PDF" : "重新產生 PDF（預覽版）"}
            </button>
          </div>
        )}

        {optimizeSummary && (
          <div className="rounded-xl bg-cream-100 px-4 py-3 text-sm text-ink-soft">
            <p>已自動調整 {optimizeSummary.adjustedCount} 筆字級／字距。</p>
            {optimizeSummary.adjustedNames.length > 0 && (
              <p className="mt-1 text-xs">縮小字體：{optimizeSummary.adjustedNames.join("、")}</p>
            )}
            {optimizeSummary.needsReviewNames.length > 0 && (
              <p className="mt-1 text-xs text-blossom-300">
                仍需人工確認：{optimizeSummary.needsReviewNames.join("、")}
              </p>
            )}
          </div>
        )}
      </section>

      {previewPages && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium text-ink print:hidden">A4 實際預覽（點一格可放大查看）</h2>
          <div ref={sheetsContainerRef} className="flex flex-col gap-6">
            {previewPages.map((pageCells, i) => (
              <div key={i} onClick={(e) => handleCellClick(e, pageCells, setZoomCell)}>
                <StickerSheet cells={pageCells} pageIndex={i} pageCount={previewPages.length} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-2xl bg-white/70 p-6 shadow-soft print:hidden">
        <h2 className="text-lg font-medium text-ink">列印批次歷史</h2>
        {batches.length === 0 ? (
          <p className="text-sm text-ink-faint">尚未產生過任何列印批次</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {batches.map((b) => (
              <li key={b.id} className="flex items-center justify-between rounded-xl bg-cream-100 px-4 py-2.5">
                <span>
                  {new Date(b.createdAt).toLocaleString("zh-TW")}・共 {b.registrationCount} 筆
                  {b.printedByName && `・操作人：${b.printedByName}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {zoomCell && (
        <Modal title={`小人頭放大預覽（編號 ${zoomCell.view.number ?? "—"}）`} onClose={() => setZoomCell(null)}>
          <div className="flex justify-center">
            <div style={{ width: "70mm", height: "90mm" }}>
              <StickerCell fields={zoomCell} />
            </div>
          </div>
          {!zoomCell.readiness.canPrint && (
            <ul className="mt-4 list-inside list-disc text-sm text-blossom-300">
              {zoomCell.readiness.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      <Toast visible={toastVisible} message={toastMessage} />
    </div>
  );
}

/** 點擊 A4 版面裡的某一格，找出對應的資料開啟放大預覽（用座標估算格子索引，避免要求 StickerSheet/StickerCell 額外接收 onClick）。 */
function handleCellClick(
  e: React.MouseEvent<HTMLDivElement>,
  pageCells: PurificationPrintFieldsJson[],
  setZoomCell: (c: PurificationPrintFieldsJson | null) => void
) {
  const target = e.target as HTMLElement;
  const cellEl = target.closest(".sticker-cell");
  if (!cellEl) return;
  const sheetEl = cellEl.closest(`.${STICKER_SHEET_CLASS}`);
  if (!sheetEl) return;
  const allCells = Array.from(sheetEl.querySelectorAll(".sticker-cell"));
  const index = allCells.indexOf(cellEl);
  if (index < 0 || index >= pageCells.length) return;
  setZoomCell(pageCells[index]);
}
