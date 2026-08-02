"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { errorTextClass, primaryButtonClass, secondaryButtonClass } from "@/components/household/formStyles";
import {
  UniversalSalvationTabletSheet,
  SLOTS_PER_PAGE,
  isOffsetWithinBounds,
  type PrintTabletEntry,
  type TabletDocumentType,
  type TabletA4Offset,
  type TabletSheetMode,
} from "./tablets";
import { exportSheetsToPdf } from "./pdfExport";

import { fetchUniversalSalvation } from "@/lib/universalSalvationFetch";
type PrintEntry = PrintTabletEntry;

// V30.3：家戶牌位列印中心只含四種牌位（不含寶袋 POCKET，寶袋走跨家戶 print-center 的寶袋批次）。
type PrintCategoryKey = Exclude<TabletDocumentType, "POCKET">;

type PrintCategory = {
  category: PrintCategoryKey;
  categoryLabel: string;
  entries: PrintEntry[];
};

type PrintData = {
  household: { id: string; name: string };
  year: number;
  categories: PrintCategory[];
};

type Props = {
  householdId: string;
  householdName: string;
  year: number;
};

/**
 * 牌位列印中心。V27.7：四種牌位（歷代祖先／乙位正魂／無緣子女／累世冤親債主）全部改由
 * **單一** UNIVERSAL_SALVATION_TABLET_A4_V1 引擎（`UniversalSalvationTabletSheet`）渲染——
 * 固定 5／11 筆、3mm 邊界、X/Y Offset、同一份 Layout 供 Preview／PDF／正式列印。移除舊
 * 8／12／16 等比格線。**本元件不寫入 printCount/printedAt**（正式列印完成的紀錄由列印物件
 * 中心的「確認完成列印」另行處理），故一般 Preview 與校正頁皆不影響列印紀錄。
 */
export default function PrintCenter({ householdId, householdName, year }: Props) {
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [selected, setSelected] = useState<Record<PrintCategoryKey, boolean>>({
    ANCESTOR_LINE: true,
    INDIVIDUAL_SOUL: true,
    DEBT_CREDITOR: true,
    UNBORN_CHILD: true,
  });
  const [mode, setMode] = useState<TabletSheetMode>("print");
  const [offset, setOffset] = useState<TabletA4Offset>({ offsetXmm: 0, offsetYmm: 0 });

  const sheetsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetchUniversalSalvation(
          `/api/households/${householdId}/rituals/universal-salvation/${year}/print`
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data.error ?? "找不到列印資料。");
          return;
        }
        setPrintData(data);
      } catch {
        if (!cancelled) setLoadError("網路錯誤，請重新整理頁面再試一次。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [householdId, year]);

  const allSelected = Object.values(selected).every(Boolean);
  const toggleCategory = (category: PrintCategoryKey) => setSelected((prev) => ({ ...prev, [category]: !prev[category] }));
  const toggleAll = () => {
    const next = !allSelected;
    setSelected({ ANCESTOR_LINE: next, INDIVIDUAL_SOUL: next, DEBT_CREDITOR: next, UNBORN_CHILD: next });
  };

  const printableCategories = useMemo(() => {
    if (!printData) return [];
    return printData.categories.filter((c) => selected[c.category] && c.entries.length > 0);
  }, [printData, selected]);

  const totalTabletCount = printableCategories.reduce((sum, c) => sum + c.entries.length, 0);
  const totalPages = printableCategories.reduce(
    (sum, c) => sum + Math.ceil(c.entries.length / SLOTS_PER_PAGE[c.category]),
    0
  );

  // Offset 超出安全範圍 → 阻擋正式列印/PDF（任何一類超界即擋）。
  const offsetOutOfBounds = printableCategories.some((c) => !isOffsetWithinBounds(c.category, offset));
  const canOutput = printableCategories.length > 0 && !offsetOutOfBounds;

  async function handleDownloadPdf() {
    // 正式 PDF 一律用 print 模式（無校正輔助框線）；校正模式不提供 PDF。
    if (!sheetsContainerRef.current || !canOutput || mode !== "print") return;
    setPdfError(null);
    setPdfGenerating(true);
    try {
      await exportSheetsToPdf(sheetsContainerRef.current, `三玄宮_${year}年普渡牌位.pdf`);
    } catch {
      setPdfError("PDF 產生失敗，請重新整理頁面再試一次。");
    } finally {
      setPdfGenerating(false);
    }
  }

  if (loading) return <p className="text-sm text-ink-faint">載入列印資料中…</p>;
  if (loadError) {
    return (
      <div className="rounded-3xl bg-white/70 p-8 shadow-card">
        <p className={errorTextClass}>{loadError}</p>
        <p className="mt-3 text-sm text-ink-faint">請先到普渡登記畫面完成 {year} 年的登記資料，再回來使用列印中心。</p>
      </div>
    );
  }
  if (!printData) return null;

  return (
    <div className="flex flex-col gap-6">
      <style>{`@page { size: A4; margin: 0; }`}</style>

      <div className="print:hidden">
        <p className="text-sm text-ink-faint">{householdName}</p>
        <h1 className="mt-1 text-2xl font-medium text-ink">🖨 {year} 年普渡牌位列印管理</h1>
        <p className="mt-1 text-xs text-ink-faint">版型：UNIVERSAL_SALVATION_TABLET_A4_V1（歷代祖先／乙位正魂／無緣子女 每頁 5 筆；累世冤親債主 每頁 11 筆）</p>
      </div>

      <section className="rounded-3xl bg-white/70 p-8 shadow-card print:hidden">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-ink">選擇要列印的牌位類別</h2>
          <button type="button" className={secondaryButtonClass} onClick={toggleAll}>
            {allSelected ? "取消全選" : "☑ 全部列印"}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {printData.categories.map((c) => (
            <label key={c.category} className="flex items-center justify-between gap-3 rounded-2xl bg-cream-100/60 px-4 py-3 text-sm text-ink">
              <span className="flex items-center gap-2">
                <input type="checkbox" checked={selected[c.category]} onChange={() => toggleCategory(c.category)} />
                {c.categoryLabel}
              </span>
              <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-ink-soft">{c.entries.length} 筆</span>
            </label>
          ))}
        </div>

        {/* 預覽模式 + X/Y Offset（校正） */}
        <div className="mt-6 border-t border-cream-200 pt-5 flex flex-wrap items-end gap-6">
          <div>
            <h2 className="text-sm font-medium text-ink">預覽模式</h2>
            <div className="mt-2 flex gap-2">
              {(["print", "calibration"] as TabletSheetMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={"rounded-full px-4 py-2 text-sm transition " + (mode === m ? "bg-ink-soft text-cream-50" : "bg-cream-100/60 text-ink-soft hover:bg-cream-200")}
                >
                  {m === "print" ? "一般預覽" : "校正預覽"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-sm font-medium text-ink">X／Y Offset（mm，整頁一致）</h2>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <label className="flex items-center gap-1">X
                <input type="number" step={0.5} value={offset.offsetXmm}
                  onChange={(e) => setOffset((o) => ({ ...o, offsetXmm: Number(e.target.value) || 0 }))}
                  className="w-20 rounded-lg border border-cream-300 px-2 py-1" />
              </label>
              <label className="flex items-center gap-1">Y
                <input type="number" step={0.5} value={offset.offsetYmm}
                  onChange={(e) => setOffset((o) => ({ ...o, offsetYmm: Number(e.target.value) || 0 }))}
                  className="w-20 rounded-lg border border-cream-300 px-2 py-1" />
              </label>
            </div>
          </div>
        </div>

        {offsetOutOfBounds && (
          <p className={`mt-4 ${errorTextClass}`}>⚠️ 目前 X／Y Offset 使區塊超出 3mm 安全範圍，已阻擋正式列印與 PDF。請調小 Offset。</p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-faint">
            {totalTabletCount === 0
              ? "目前選擇的類別沒有可列印的牌位。"
              : `會列印 ${totalTabletCount} 筆牌位，共 ${totalPages} 頁 A4。下方即實際版型（${mode === "print" ? "一般預覽" : "校正預覽"}）。`}
          </p>
          <div className="flex gap-3">
            {mode === "print" ? (
              <>
                <button type="button" className={secondaryButtonClass} onClick={() => window.print()} disabled={!canOutput}>
                  列印
                </button>
                <button type="button" className={primaryButtonClass} onClick={handleDownloadPdf} disabled={!canOutput || pdfGenerating}>
                  {pdfGenerating ? "PDF 產生中…" : "📄 下載 PDF"}
                </button>
              </>
            ) : (
              <button type="button" className={secondaryButtonClass} onClick={() => window.print()} disabled={printableCategories.length === 0}>
                🖨 列印校正頁（不計入列印紀錄）
              </button>
            )}
          </div>
        </div>

        {pdfError && <p className={`mt-3 ${errorTextClass}`}>{pdfError}</p>}
      </section>

      <section className="print:m-0 print:p-0">
        <p className="mb-4 text-xs text-ink-faint print:hidden">
          {mode === "print" ? "列印預覽（實際尺寸 A4）" : "校正預覽（顯示 A4 邊界／3mm 安全界／區塊外框／slot·record·尺寸）"}
        </p>
        <div
          ref={sheetsContainerRef}
          className="flex flex-col items-center gap-8 overflow-x-auto rounded-3xl bg-white/40 p-6 shadow-card print:gap-0 print:rounded-none print:bg-transparent print:p-0 print:shadow-none"
        >
          {printableCategories.length === 0 && (
            <p className="text-center text-sm text-ink-faint print:hidden">尚未選擇任何有資料的類別。</p>
          )}
          {printableCategories.map((c) => (
            <div key={c.category} className="w-full">
              <p className="mb-2 text-xs text-ink-faint print:hidden">{c.categoryLabel}（{c.entries.length} 筆）</p>
              <UniversalSalvationTabletSheet documentType={c.category} records={c.entries} offset={offset} mode={mode} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
