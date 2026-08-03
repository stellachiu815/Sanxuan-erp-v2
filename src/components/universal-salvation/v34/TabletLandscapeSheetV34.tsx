"use client";

/**
 * V34（平行開發）中元普渡「橫式 A4 正式列印版型」——**獨立、純呈現**元件。
 *
 * ⚠️ 只做 CSS / Print Layout / Grid / Header / Footer / Pagination / page-break / 紙張尺寸 / 字體定位。
 *    **不**修改任何資料流程、名稱正規化（ritualDisplayName）、報名/收款/Excel/DB/Migration。
 *    只讀既有已備妥的列印資料（PrintTabletEntry，名稱已由既有 formatter 解析），不觸碰資料層。
 *
 * 用途：與目前正式（直式/mm 引擎）版型**平行並存**，可由 query parameter（?layout=v34）或 feature flag 切換；
 *      不取代、也不影響目前版型。五種牌位（歷代祖先／乙位正魂／累世冤親債主／無緣子女／寶袋）皆 A4 橫式。
 *      Preview 與正式列印使用同一份 DOM/CSS，確保一致。
 */

import { toPrintableTablet, type PrintTabletEntry } from "@/components/ritual/tablets/shared";

export type V34Density = "standard" | "economy";

export type V34Group = {
  /** documentType 代表值（ANCESTOR_LINE / INDIVIDUAL_SOUL / DEBT_CREDITOR / UNBORN_CHILD / POCKET）。 */
  documentType: string;
  /** 中文標題（超拔祖先…）。 */
  categoryLabel: string;
  records: PrintTabletEntry[];
};

export const DENSITY_COLS: Record<V34Density, number> = { standard: 8, economy: 10 };

/** V34 分頁：把 N 筆依每頁欄數切成多頁（同一筆不跨頁）。純函式，供測試。 */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 作業號碼顯示（No.xxx；null 不顯示）。 */
function workNo(n: number | null | undefined): string | null {
  return n == null ? null : `No.${String(n).padStart(3, "0")}`;
}

/** 一戶（一筆）：直書群組——主文（大）｜陽上人＋叩薦｜地址；由右至左（row-reverse）。 */
function FamilyCell({ e, showWorkNumber }: { e: PrintTabletEntry; showWorkNumber: boolean }) {
  const p = toPrintableTablet(e);
  const no = workNo(e.workNumber);
  return (
    <div className="v34-cell">
      {showWorkNumber && no && <span className="v34-no">{no}</span>}
      <div className="v34-cell-cols">
        <div className="v34-main">{p.displayName}</div>
        <div className="v34-yang">{p.yangshangText}</div>
        <div className="v34-addr">{p.locationText}</div>
      </div>
    </div>
  );
}

export default function TabletLandscapeSheetV34({
  groups,
  density = "standard",
  showWorkNumber = true,
  title = "中元普渡",
  subtitle,
}: {
  groups: V34Group[];
  density?: V34Density;
  showWorkNumber?: boolean;
  title?: string;
  subtitle?: string;
}) {
  const cols = DENSITY_COLS[density];
  // 每一 documentType 各自分頁；每頁一列 cols 欄（直書滿高的家戶群組）。
  const pages: { documentType: string; categoryLabel: string; records: PrintTabletEntry[]; pageIndex: number; totalPages: number }[] = [];
  for (const g of groups) {
    const chunks = chunk(g.records, cols);
    chunks.forEach((records, i) =>
      pages.push({ documentType: g.documentType, categoryLabel: g.categoryLabel, records, pageIndex: i, totalPages: chunks.length })
    );
  }

  return (
    <div className="v34-sheets">
      {pages.length === 0 && <p className="v34-empty no-print">沒有可列印的資料。</p>}
      {pages.map((pg, idx) => (
        <section key={`${pg.documentType}-${pg.pageIndex}`} className="v34-page" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          <header className="v34-header">
            <span className="v34-header-title">{title}</span>
            <span className="v34-header-sub">{pg.categoryLabel}{subtitle ? `　${subtitle}` : ""}</span>
          </header>
          <div className="v34-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {pg.records.map((e, i) => (
              <FamilyCell key={i} e={e} showWorkNumber={showWorkNumber} />
            ))}
          </div>
          <footer className="v34-footer">
            <span>{pg.categoryLabel}</span>
            <span>第 {idx + 1} 頁（{pg.categoryLabel} {pg.pageIndex + 1}/{pg.totalPages}）</span>
          </footer>
        </section>
      ))}

      <style>{`
        /* V34 橫式 A4 列印樣式（獨立命名空間 v34-*，不影響既有版型）。
           所有可微調數值集中於 CSS 變數；全部使用 mm 實體單位 → Chrome 預覽＝PDF＝window.print 幾何一致。 */
        @page { size: A4 landscape; margin: 0; }
        .v34-sheets {
          /* ── 可微調變數（校正時只改這裡） ── */
          --v34-cut-margin: 8mm;     /* 裁切安全邊（四周內縮，內容不落在裁邊上） */
          --v34-header-h: 9mm;       /* Header 固定高 */
          --v34-footer-h: 6mm;       /* Footer 固定高 */
          --v34-col-gap: 3mm;        /* 家戶（欄）間距 */
          --v34-no-top: 1mm;         /* No.xxx 距格頂 */
          --v34-content-top: 5.5mm;  /* 內容距格頂（留給 No.xxx，不相壓） */
          --v34-main-size: 9mm;      /* 主文字級 */
          --v34-yang-size: 3.6mm;    /* 陽上人字級 */
          --v34-addr-size: 3.2mm;    /* 地址字級 */
          --v34-header-title: 5mm;
          --v34-header-sub: 3.5mm;
          --v34-footer-size: 2.8mm;
          --v34-no-size: 2.6mm;
          --v34-inner-gap: 1mm;      /* 主文/陽上/地址 欄間距 */
          --v34-serif: "BiauKai", "DFKai-SB", "標楷體", serif;

          display: flex; flex-direction: column; align-items: center; gap: 16px;
        }
        .v34-page {
          position: relative; box-sizing: border-box;
          width: 297mm; height: 210mm; background: #fff; color: #000;
          padding: var(--v34-cut-margin); display: flex; flex-direction: column;
          overflow: hidden;
          break-after: page; page-break-after: always;
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
        .v34-page:last-child { break-after: auto; page-break-after: auto; }
        .v34-header {
          flex: 0 0 var(--v34-header-h); height: var(--v34-header-h);
          display: flex; justify-content: space-between; align-items: baseline;
          border-bottom: 0.3mm solid #ccc; font-family: var(--v34-serif);
        }
        .v34-header-title { font-size: var(--v34-header-title); font-weight: 600; }
        .v34-header-sub { font-size: var(--v34-header-sub); color: #555; }
        .v34-grid {
          flex: 1 1 auto; min-height: 0;
          display: grid; gap: var(--v34-col-gap);
          padding: 3mm 0; /* Header/Footer 與格線之間的呼吸 */
        }
        .v34-cell {
          position: relative; height: 100%; min-width: 0; min-height: 0;
          overflow: hidden; display: flex; align-items: stretch; justify-content: center;
        }
        .v34-no {
          position: absolute; top: var(--v34-no-top); left: 0;
          font-size: var(--v34-no-size); color: #000; font-family: sans-serif;
          line-height: 1; white-space: nowrap; pointer-events: none;
        }
        .v34-cell-cols {
          display: flex; flex-direction: row-reverse; align-items: stretch; justify-content: center;
          gap: var(--v34-inner-gap); height: 100%; width: 100%;
          padding-top: var(--v34-content-top); font-family: var(--v34-serif);
        }
        .v34-main {
          writing-mode: vertical-rl; text-orientation: upright;
          font-size: var(--v34-main-size); font-weight: 500; line-height: 1.05;
          display: flex; align-items: flex-start; justify-content: center; flex: 0 0 auto;
          white-space: nowrap; overflow: hidden;
        }
        .v34-yang {
          writing-mode: vertical-rl; text-orientation: upright;
          font-size: var(--v34-yang-size); line-height: 1.12; color: #111;
          display: flex; align-items: flex-start; flex: 0 1 auto; max-width: 8mm; overflow: hidden;
        }
        .v34-addr {
          writing-mode: vertical-rl; text-orientation: upright;
          font-size: var(--v34-addr-size); line-height: 1.12; color: #222;
          display: flex; align-items: flex-start; flex: 1 1 auto; max-width: 12mm; overflow: hidden;
        }
        .v34-footer {
          flex: 0 0 var(--v34-footer-h); height: var(--v34-footer-h);
          display: flex; justify-content: space-between; align-items: center;
          border-top: 0.3mm solid #ddd; font-size: var(--v34-footer-size); color: #777; font-family: sans-serif;
        }
        .v34-empty { padding: 24px; color: #7a7367; }
        @media print {
          .no-print { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          .v34-sheets { gap: 0; }
          .v34-page { box-shadow: none; }
        }
        @media screen {
          .v34-page { box-shadow: 0 1px 6px rgba(0,0,0,.15); }
        }
      `}</style>
    </div>
  );
}
