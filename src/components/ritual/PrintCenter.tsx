"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { errorTextClass, primaryButtonClass, secondaryButtonClass } from "@/components/household/formStyles";
import {
  TABLET_TEMPLATES,
  TABLET_PAGE_LAYOUTS,
  TABLET_PAGE_LAYOUT_ORDER,
  DEFAULT_TABLET_PAGE_LAYOUT,
  PrintSheet,
  type PrintTabletEntry,
  type TabletPageLayoutKey,
} from "./tablets";
import { exportSheetsToPdf } from "./pdfExport";

import { fetchUniversalSalvation } from "@/lib/universalSalvationFetch";
type PrintEntry = PrintTabletEntry;

type PrintCategoryKey = "ANCESTOR_LINE" | "INDIVIDUAL_SOUL" | "DEBT_CREDITOR" | "UNBORN_CHILD";

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
 * 牌位列印中心（V4.0 建立，V4.1「正式牌位列印」擴充：可套版模板、
 * A4 8/12/16 張版型、PDF 下載）。
 *
 * 完全使用既有的 Print API（GET .../universal-salvation/[year]/print）取得
 * 資料，這支畫面本身不查資料庫，也沒有新增任何 API。行政人員可以勾選要
 * 列印哪幾類牌位、選擇每頁要排幾張（8／12／16 張），畫面上看到的排版
 * 就是實際會印出來、或匯出 PDF 的樣子。
 *
 * 每一類牌位實際長怎樣，由 ./tablets 資料夾裡對應的模板元件決定——之後
 * 三玄宮提供正式牌位設計時，只需要替換模板檔案本身，這支畫面完全不用改。
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
  const [layoutKey, setLayoutKey] = useState<TabletPageLayoutKey>(DEFAULT_TABLET_PAGE_LAYOUT);

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

  function toggleCategory(category: PrintCategoryKey) {
    setSelected((prev) => ({ ...prev, [category]: !prev[category] }));
  }

  function toggleAll() {
    const next = !allSelected;
    setSelected({
      ANCESTOR_LINE: next,
      INDIVIDUAL_SOUL: next,
      DEBT_CREDITOR: next,
      UNBORN_CHILD: next,
    });
  }

  const printableCategories = useMemo(() => {
    if (!printData) return [];
    return printData.categories.filter((c) => selected[c.category] && c.entries.length > 0);
  }, [printData, selected]);

  // 把每一類選取的牌位依目前版型（8/12/16 張）切成一張張 A4 版面。
  const sheets = useMemo(() => {
    const layout = TABLET_PAGE_LAYOUTS[layoutKey];
    const result: {
      key: string;
      category: PrintCategoryKey;
      categoryLabel: string;
      entries: PrintEntry[];
      sheetIndexInCategory: number;
      sheetCountInCategory: number;
    }[] = [];

    for (const c of printableCategories) {
      const chunks: PrintEntry[][] = [];
      for (let i = 0; i < c.entries.length; i += layout.perPage) {
        chunks.push(c.entries.slice(i, i + layout.perPage));
      }
      chunks.forEach((chunk, index) => {
        result.push({
          key: `${c.category}-${index}`,
          category: c.category,
          categoryLabel: c.categoryLabel,
          entries: chunk,
          sheetIndexInCategory: index + 1,
          sheetCountInCategory: chunks.length,
        });
      });
    }
    return result;
  }, [printableCategories, layoutKey]);

  const totalTabletCount = printableCategories.reduce((sum, c) => sum + c.entries.length, 0);

  async function handleDownloadPdf() {
    if (!sheetsContainerRef.current || sheets.length === 0) return;
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

  if (loading) {
    return <p className="text-sm text-ink-faint">載入列印資料中…</p>;
  }

  if (loadError) {
    return (
      <div className="rounded-3xl bg-white/70 p-8 shadow-card">
        <p className={errorTextClass}>{loadError}</p>
        <p className="mt-3 text-sm text-ink-faint">
          請先到普渡登記畫面完成 {year} 年的登記資料，再回來使用列印中心。
        </p>
      </div>
    );
  }

  if (!printData) return null;

  return (
    <div className="flex flex-col gap-6">
      {/* @page 只能是全域規則；實際邊界由每張 PrintSheet 自己的留白決定，
          這樣列印跟 PDF 匯出（拍下同一份 DOM）才會完全一致。 */}
      <style>{`
        @page { size: A4; margin: 0; }
      `}</style>

      <div className="print:hidden">
        <p className="text-sm text-ink-faint">{householdName}</p>
        <h1 className="mt-1 text-2xl font-medium text-ink">🖨 {year} 年普渡牌位列印中心</h1>
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
            <label
              key={c.category}
              className="flex items-center justify-between gap-3 rounded-2xl bg-cream-100/60 px-4 py-3 text-sm text-ink"
            >
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected[c.category]}
                  onChange={() => toggleCategory(c.category)}
                />
                {c.categoryLabel}
              </span>
              <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-ink-soft">
                {c.entries.length} 筆
              </span>
            </label>
          ))}
        </div>

        <div className="mt-6 border-t border-cream-200 pt-5">
          <h2 className="text-sm font-medium text-ink">每頁排版張數</h2>
          <div className="mt-3 flex flex-wrap gap-3">
            {TABLET_PAGE_LAYOUT_ORDER.map((key) => {
              const layout = TABLET_PAGE_LAYOUTS[key];
              const active = layoutKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setLayoutKey(key)}
                  className={
                    "rounded-full px-4 py-2 text-sm transition " +
                    (active
                      ? "bg-ink-soft text-cream-50"
                      : "bg-cream-100/60 text-ink-soft hover:bg-cream-200")
                  }
                >
                  {layout.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-faint">
            {totalTabletCount === 0
              ? "目前選擇的類別沒有可列印的牌位。"
              : `會列印 ${totalTabletCount} 張牌位，共 ${sheets.length} 頁 A4。下方就是實際會印出來的版型。`}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => window.print()}
              disabled={sheets.length === 0}
            >
              列印
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              onClick={handleDownloadPdf}
              disabled={sheets.length === 0 || pdfGenerating}
            >
              {pdfGenerating ? "PDF 產生中…" : "📄 下載 PDF"}
            </button>
          </div>
        </div>

        {pdfError && <p className={`mt-3 ${errorTextClass}`}>{pdfError}</p>}
      </section>

      {/* 列印預覽：畫面上看到的就是實際會印出來（或匯出 PDF）的內容，
          print:hidden 的部分（上面的選單）在真正列印時會被隱藏。 */}
      <section className="print:m-0 print:p-0">
        <p className="mb-4 text-xs text-ink-faint print:hidden">
          列印預覽（實際尺寸 A4，可左右／上下捲動）
        </p>
        <div
          ref={sheetsContainerRef}
          className="flex flex-col items-center gap-8 overflow-x-auto rounded-3xl bg-white/40 p-6 shadow-card print:gap-0 print:rounded-none print:bg-transparent print:p-0 print:shadow-none"
        >
          {sheets.length === 0 && (
            <p className="text-center text-sm text-ink-faint print:hidden">
              尚未選擇任何有資料的類別。
            </p>
          )}
          {sheets.map((sheet) => {
            const Tablet = TABLET_TEMPLATES[sheet.category];
            return (
              <PrintSheet
                key={sheet.key}
                layoutKey={layoutKey}
                entries={sheet.entries}
                Tablet={Tablet}
                categoryLabel={sheet.categoryLabel}
                sheetIndexInCategory={sheet.sheetIndexInCategory}
                sheetCountInCategory={sheet.sheetCountInCategory}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}
