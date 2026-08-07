"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  UniversalSalvationTabletSheet,
  buildAutoTabletLayout,
  buildLandscapeTabletLayout,
  toPrintableTablet,
  type TabletDocumentType,
} from "@/components/ritual/tablets";
import { resolveYangshangNames } from "@/lib/yangshang";
import { useTabletPrint } from "@/hooks/useTabletPrint";
import type { TabletPrintGroup } from "@/lib/TabletBatchService";
import type { TabletTemplateSetting } from "@/lib/tabletTemplateSettingsShape";

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
  maximize = false,
  densityOverride,
  templates,
}: {
  year: number;
  batchLabel: string;
  paperLabel: string;
  count: number;
  groups: TabletPrintGroup[];
  debug?: boolean;
  /** V30.3：是否顯示裁切外作業號碼 No.<registrationOrder>（由 ?workno=0/1 控制，預設顯示）。 */
  showWorkNumber?: boolean;
  /** V32 §3：是否啟用最高密度排版（由 ?maximize=1／模板設定控制，預設 false＝既有版型）。 */
  maximize?: boolean;
  /** V38：一頁張數覆寫（?perpage=6→roomy 一頁6張；7→standard 一頁7張；未給＝用模板/預設）。 */
  densityOverride?: "standard" | "economy" | "roomy";
  /** V32 §4：各 documentType 的模板設定（來自列印模板管理；套用位移／字體／校正框／裁切線／預設主文等）。 */
  templates?: Record<string, TabletTemplateSetting>;
}) {
  // 取某 documentType 的模板設定（缺→undefined，sheet 用既有預設）。
  const tplOf = (dt: string): TabletTemplateSetting | undefined => templates?.[dt];
  // V33：五種牌位（含寶袋）皆＝橫式 A4 群組版型（單一引擎）→ 一律 landscape。
  const LANDSCAPE_DTS = ["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "DEBT_CREDITOR", "UNBORN_CHILD", "POCKET"];
  const landscape = groups.length === 0 ? true : groups.some((g) => LANDSCAPE_DTS.includes(g.documentType));
  const { print } = useTabletPrint(groups.length > 0);
  const sheetsRef = useRef<HTMLDivElement>(null);

  // V30.3：作業號碼開關 href——只翻轉 workno，保留 batch／ids／scope／category 等其餘 query string。
  const searchParams = useSearchParams();
  const toggleWorknoHref = (() => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.set("workno", showWorkNumber ? "0" : "1");
    return `?${next.toString()}`;
  })();

  // V38：一頁 6 張／7 張切換（6 張＝地址/陽上較大）。目前值：roomy→6，其餘→7。
  const currentPerPage = densityOverride === "roomy" ? 6 : 7;
  const togglePerpageHref = (() => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.set("perpage", currentPerPage === 6 ? "7" : "6");
    return `?${next.toString()}`;
  })();

  // 正式規格：一張 A4 放多筆牌位——每個 documentType 一個 Sheet，records 傳整組（由 buildTabletLayout 打包）。
  // 診斷用：對每組跑相同的 buildTabletLayout（USE，不改引擎），列出每頁每筆綁定的主文/地址/陽上與座標。
  const diag = useMemo(
    () =>
      groups.map((g) => {
        const records = g.records.map((e) => {
          const p = toPrintableTablet(e);
          return { entryId: null, registrationId: null, addressText: p.locationText, mainText: p.displayName, yangshangText: p.yangshangText, yangshangNames: resolveYangshangNames(e.yangshangNames ?? null, e.yangshangName) };
        });
        // V33/§3/§4：與正式 Sheet 完全相同的版面決策，確保預覽＝正式列印同配置。四種牌位＝橫式；寶袋＝直式。
        const tpl = tplOf(g.documentType);
        const offset = tpl ? { offsetXmm: tpl.offsetXmm, offsetYmm: tpl.offsetYmm } : undefined;
        const isLandscape = LANDSCAPE_DTS.includes(g.documentType);
        const density = densityOverride ?? (tpl?.density as "standard" | "economy" | "roomy" | undefined) ?? "standard";
        const layout = isLandscape
          ? buildLandscapeTabletLayout(g.documentType as TabletDocumentType, records, { density, offset })
          : buildAutoTabletLayout(g.documentType as TabletDocumentType, records, offset, { maximize: maximize || !!tpl?.maximize });
        return { documentType: g.documentType, layout };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, maximize, templates, densityOverride]
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
        <Link
          href={togglePerpageHref}
          style={{ borderRadius: 999, border: "1px solid #cfc8bb", background: currentPerPage === 6 ? "#e7efe4" : "#fff", padding: "6px 16px", fontSize: 14, textDecoration: "none", color: "#2c2a27" }}
        >
          {currentPerPage === 6 ? "一頁 6 張（地址/陽上較大）· 點此改 7 張" : "一頁 7 張 · 點此改 6 張（字較大）"}
        </Link>
        <button type="button" onClick={print} style={{ borderRadius: 999, border: "1px solid #cfc8bb", background: "#e7efe4", padding: "6px 16px", fontSize: 14 }}>
          🖨 列印
        </button>
        <Link href={`/universal-salvation/${year}/print-center`} style={{ borderRadius: 999, border: "1px solid #cfc8bb", background: "#fff", padding: "6px 16px", fontSize: 14, textDecoration: "none", color: "#2c2a27" }}>
          返回列印管理
        </Link>
      </div>

      {/* V33 §8：正式列印/預覽不得有任何 Debug/排版資訊。以下排版摘要僅在 ?debug=1 顯示、且列印隱藏。 */}
      {debug && (
        <div className="no-print" style={{ margin: "8px 16px", padding: "6px 12px", border: "1px solid #cfe0cf", borderRadius: 8, background: "#f3f8f1", fontSize: 12, color: "#3c5a3c", display: "flex", flexWrap: "wrap", gap: 12 }}>
          {diag.map(({ documentType, layout }) => (
            <span key={documentType}><b>{documentType}</b>：每頁 {layout.slotsPerPage} 筆｜最小字級 {Math.round(layout.packing?.minFontPx ?? 0)}px{layout.packing?.warnings.length ? `｜⚠️${layout.packing.warnings.join(",")}` : ""}</span>
          ))}
        </div>
      )}

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
          {groups.map((g) => {
            const tpl = tplOf(g.documentType);
            return (
              <div key={g.documentType} className="w-full">
                <UniversalSalvationTabletSheet
                  documentType={g.documentType as TabletDocumentType}
                  records={g.records}
                  mode="print"
                  offset={tpl ? { offsetXmm: tpl.offsetXmm, offsetYmm: tpl.offsetYmm } : undefined}
                  showWorkNumber={showWorkNumber && (tpl?.showWorkNumber ?? true)}
                  density={densityOverride ?? (tpl?.density as "standard" | "economy" | "roomy" | undefined) ?? "standard"}
                  maximize={maximize || !!tpl?.maximize}
                  template={tpl ? {
                    fontFamily: tpl.fontFamily, fontWeight: tpl.fontWeight, letterSpacingPx: tpl.letterSpacingPx,
                    lineHeight: tpl.lineHeight, showCalibrationBox: tpl.showCalibrationBox, showCropMarks: tpl.showCropMarks,
                    defaultMainText: tpl.defaultMainText,
                  } : undefined}
                />
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
        }
      `}</style>
    </div>
  );
}
