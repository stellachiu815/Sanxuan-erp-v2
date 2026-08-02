"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  UniversalSalvationTabletSheet,
  buildTabletLayout,
  toPrintableTablet,
  type TabletDocumentType,
} from "@/components/ritual/tablets";
import { useTabletPrint } from "@/hooks/useTabletPrint";
import type { TabletPrintGroup } from "@/lib/TabletBatchService";

/**
 * V27.11：跨家戶牌位**專用列印頁**。正式版型維持「一張 A4 多筆」——每個 documentType 一個
 * UniversalSalvationTabletSheet，records 傳整組，完全由 buildTabletLayout 打包定位（5 筆／頁；
 * 冤親 11 筆／頁）。DOM 階層比照已驗收的家戶列印頁 PrintCenter（flex 容器 + w-full + overflow-x-auto）。
 *
 * ⚠️ 不修改 buildTabletLayout／UniversalSalvationTabletSheet／UNIVERSAL_SALVATION_TABLET_A4_V1／模板。
 *
 * ?debug=1：畫面上方顯示「版面診斷」（列印隱藏），列出每頁 record 數／每筆主文·地址·陽上綁定／
 * 每張 .print-sheet 實際 boundingRect，用來定位實機縮放或分組問題。
 */
export default function TabletPrintPage({
  year,
  batchLabel,
  paperLabel,
  count,
  groups,
  debug = false,
  showWorkNumber = true,
}: {
  year: number;
  batchLabel: string;
  paperLabel: string;
  count: number;
  groups: TabletPrintGroup[];
  debug?: boolean;
  /** V30.3：是否顯示裁切外作業號碼 No.<registrationOrder>（由 ?workno=0/1 控制，預設顯示）。 */
  showWorkNumber?: boolean;
}) {
  const { print } = useTabletPrint(groups.length > 0);
  const sheetsRef = useRef<HTMLDivElement>(null);

  // V30.3：作業號碼開關 href——只翻轉 workno，保留 batch／ids／scope／category 等其餘 query string。
  const searchParams = useSearchParams();
  const toggleWorknoHref = (() => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.set("workno", showWorkNumber ? "0" : "1");
    return `?${next.toString()}`;
  })();

  // 正式規格：一張 A4 放多筆牌位——每個 documentType 一個 Sheet，records 傳整組（由 buildTabletLayout 打包）。
  // 診斷用：對每組跑相同的 buildTabletLayout（USE，不改引擎），列出每頁每筆綁定的主文/地址/陽上與座標。
  const diag = useMemo(
    () =>
      groups.map((g) => {
        const records = g.records.map((e) => {
          const p = toPrintableTablet(e);
          return { entryId: null, registrationId: null, addressText: p.locationText, mainText: p.displayName, yangshangText: p.yangshangText };
        });
        const layout = buildTabletLayout(g.documentType as TabletDocumentType, records);
        return { documentType: g.documentType, layout };
      }),
    [groups]
  );

  const [measured, setMeasured] = useState<{ i: number; w: number; h: number; mains: number; transform: string }[]>([]);
  useEffect(() => {
    if (!debug) return;
    // 分頁邏輯 debug（console）：records / pages / 每頁筆數。scope 與 ids 應得到相同結果。
    const totalRecords = groups.reduce((s, g) => s + g.records.length, 0);
    // eslint-disable-next-line no-console
    console.log(
      "[TabletPrintPage] 分頁 debug",
      "| count(標示)=", count,
      "| records=", totalRecords,
      "| groups=", diag.map((d) => ({
        documentType: d.documentType,
        records: d.layout.pages.reduce((s, p) => s + new Set(p.blocks.map((b) => b.recordIndex)).size, 0),
        pages: d.layout.pages.length,
        perPage: d.layout.pages.map((p) => new Set(p.blocks.map((b) => b.recordIndex)).size),
      }))
    );
    const t = window.setTimeout(() => {
      const root = sheetsRef.current;
      if (!root) return;
      const sheets = Array.from(root.querySelectorAll<HTMLElement>(".print-sheet"));
      setMeasured(
        sheets.map((s, i) => {
          const r = s.getBoundingClientRect();
          return { i, w: Math.round(r.width), h: Math.round(r.height), mains: s.querySelectorAll('[data-block-type="main"]').length, transform: getComputedStyle(s).transform };
        })
      );
    }, 500);
    return () => window.clearTimeout(t);
  }, [debug, groups]);

  return (
    <div className="tablet-print-page">
      <div className="no-print" style={{ position: "sticky", top: 0, zIndex: 10, display: "flex", gap: 12, alignItems: "center", padding: "10px 16px", background: "#faf6ee", borderBottom: "1px solid #e6ddc9" }}>
        <strong>{batchLabel}</strong>
        <span style={{ fontSize: 13, color: "#7a7367" }}>{paperLabel}｜{count} 筆牌位（正式版型：一張 A4 多筆）</span>
        <Link
          href={toggleWorknoHref}
          style={{ marginLeft: "auto", borderRadius: 999, border: "1px solid #cfc8bb", background: showWorkNumber ? "#e7efe4" : "#fff", padding: "6px 16px", fontSize: 14, textDecoration: "none", color: "#2c2a27" }}
        >
          {showWorkNumber ? "作業號碼：顯示中（點此隱藏）" : "作業號碼：已隱藏（點此顯示）"}
        </Link>
        <button type="button" onClick={print} style={{ borderRadius: 999, border: "1px solid #cfc8bb", background: "#e7efe4", padding: "6px 16px", fontSize: 14 }}>
          🖨 列印
        </button>
        <Link href={`/universal-salvation/${year}/print-center`} style={{ borderRadius: 999, border: "1px solid #cfc8bb", background: "#fff", padding: "6px 16px", fontSize: 14, textDecoration: "none", color: "#2c2a27" }}>
          返回列印管理
        </Link>
      </div>

      {debug && (
        <div className="no-print" style={{ margin: 16, padding: 12, border: "2px solid #c0392b", borderRadius: 8, background: "#fff8f7", fontSize: 12, fontFamily: "monospace" }}>
          <div style={{ fontWeight: 700, color: "#c0392b" }}>版面診斷（?debug=1，列印隱藏；修好後移除）</div>
          <div>參考：每張 .print-sheet 應 ≈ 793×1122px、transform:none；每頁 main 數＝該頁 record 數（正式版型多筆／頁）。</div>
          <div style={{ marginTop: 6 }}>
            <b>實測 .print-sheet：</b>
            {measured.length === 0 ? " 量測中…" : measured.map((m) => (
              <span key={m.i} style={{ display: "inline-block", marginRight: 12 }}>#{m.i}: {m.w}×{m.h}px · main={m.mains} · transform={m.transform === "none" ? "none" : "⚠" + m.transform}</span>
            ))}
          </div>
          {diag.map(({ documentType, layout }) => (
            <div key={documentType} style={{ marginTop: 8 }}>
              <b>{documentType}</b>：共 {layout.pages.length} 頁，每頁 {layout.slotsPerPage} 格
              {layout.pages.map((page) => {
                const byRec = new Map<number, { slot: number; main: string; addr: string; yang: string }>();
                for (const b of page.blocks) {
                  const r = byRec.get(b.recordIndex) ?? { slot: b.slotIndex, main: "", addr: "", yang: "" };
                  if (b.blockType === "main") r.main = b.text;
                  else if (b.blockType === "address") r.addr = b.text;
                  else r.yang = b.text;
                  r.slot = b.slotIndex;
                  byRec.set(b.recordIndex, r);
                }
                return (
                  <div key={page.pageIndex} style={{ marginLeft: 12 }}>
                    第 {page.pageIndex + 1} 頁：{byRec.size} 筆
                    <ul style={{ margin: "2px 0 2px 16px" }}>
                      {[...byRec.entries()].map(([ri, r]) => (
                        <li key={ri}>slot{r.slot}｜主文「{r.main}」｜地址「{r.addr}」｜陽上「{r.yang}」</li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {groups.length === 0 ? (
        <p className="no-print" style={{ padding: 24, color: "#7a7367" }}>沒有可列印的牌位（可能都已列印或資料不完整）。</p>
      ) : (
        // 正式版型：一張 A4 多筆。DOM 階層比照已驗收的 PrintCenter（flex 容器 + w-full + overflow-x-auto）。
        <div ref={sheetsRef} className="flex flex-col items-center gap-8 overflow-x-auto print:gap-0 print:overflow-visible">
          {groups.map((g) => (
            <div key={g.documentType} className="w-full">
              <UniversalSalvationTabletSheet documentType={g.documentType as TabletDocumentType} records={g.records} mode="print" showWorkNumber={showWorkNumber} />
            </div>
          ))}
        </div>
      )}

      <style>{`
        @page { size: A4; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
        }
      `}</style>
    </div>
  );
}
