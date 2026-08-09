import { Fragment } from "react";
import { TABLET_FONT_FAMILY, A4_PAGE } from "./shared";
import { fitVerticalFont, type FontFitConfig } from "./fontFit";
import type { PetitionData } from "@/lib/lanternPrint";

/**
 * 疏文列印（直書格線表格版）。
 *
 * ── 版面邏輯（與中元普渡牌位同一套自動縮放）───────────────────────
 * 每個欄位有**固定的框規格（公分）**，字體用共用的 fitVerticalFont() 依字數在框內
 * 自動縮放（字少維持基準、字多逐級縮小到最小、絕不裁字、絕不溢出）。四帶等高對齊、有格線。
 * **四帶＋標題總高必須 < 一張 A4**（A4 可用高約 273mm；此處四帶 230 ＋標題約 16 ＝ 246mm）。
 *
 * ── 封面 ─────────────────────────────────────────────────
 * 一整行直書、不換行「台北三玄宮歲次◯◯年安【燈別】善信芳名」，干支＋燈別自動帶入；
 * 字級依字數自動塞進一張 A4 高度，每 COVER_EVERY 頁前放一張，可裁下貼疏文最前。
 *
 * ⚠️ 只排版、不轉換；數字已在 lanternPrint.ts 轉成國字。
 */

const PER_PAGE = 15; // 每頁 15 人（欄）
const COL_W_MM = 12; // 每欄寬（15 欄剛好排滿 A4 寬）
const PAD_MM = 1.5; // 文字與格線之間留白

// 各橫帶固定框（高度 mm）＋字級上下限（跟普渡牌位一樣：框固定、字依字數縮放）。
const BANDS = {
  title: { hMm: 16, cfg: { maxPx: 30, minPx: 16, stepPx: 2 } as FontFitConfig },
  name: { hMm: 28, cfg: { maxPx: 34, minPx: 18, stepPx: 2 } as FontFitConfig },
  age: { hMm: 78, cfg: { maxPx: 28, minPx: 14, stepPx: 1 } as FontFitConfig },
  addr: { hMm: 108, cfg: { maxPx: 26, minPx: 11, stepPx: 1 } as FontFitConfig },
};

/** 某欄位在其固定框內的字級（依字數自動縮放，與普渡牌位同一支 fitVerticalFont）。 */
function fieldFontPx(text: string, band: { hMm: number; cfg: FontFitConfig }): number {
  return fitVerticalFont(text.length, COL_W_MM - PAD_MM * 2, band.hMm - PAD_MM * 2, band.cfg, {
    lineHeight: 1.08,
    colSpacing: 1.05,
  }).px;
}

const V: React.CSSProperties = { writingMode: "vertical-rl", textOrientation: "upright", whiteSpace: "nowrap" };
const cellBase: React.CSSProperties = {
  border: "1px solid #333",
  width: `${COL_W_MM}mm`,
  textAlign: "center",
  padding: `${PAD_MM}mm`,
  boxSizing: "border-box",
  overflow: "hidden",
};

export default function PetitionSheet({ data }: { data: PetitionData }) {
  const entries = data.entries;
  const pages: (typeof entries)[] = [];
  for (let i = 0; i < entries.length; i += PER_PAGE) pages.push(entries.slice(i, i + PER_PAGE));
  if (pages.length === 0) pages.push([]);

  const coverText = `台北三玄宮${data.sexagenaryText}年安${data.activityTypeLabel}善信芳名`;
  const COVER_EVERY = 4;
  // 封面字級：一整行直書、依字數自動塞進一張 A4 高度（留餘裕），絕不溢出到第二頁。
  const coverFont = Math.max(
    18,
    Math.min(36, Math.floor(((A4_PAGE.heightMm - A4_PAGE.marginMm * 2 - 16) * 3.78) / (coverText.length * 1.18)))
  );

  return (
    <div style={{ fontFamily: TABLET_FONT_FAMILY }}>
      {pages.map((page, pi) => {
        const cols = [...page].reverse(); // 由右到左（傳統直書：第一位在最右）
        return (
          <Fragment key={pi}>
            {pi % COVER_EVERY === 0 && (
              <div
                className="print-sheet mx-auto flex items-center justify-center bg-white text-ink"
                style={{ width: `${A4_PAGE.widthMm}mm`, height: `${A4_PAGE.heightMm}mm`, padding: `${A4_PAGE.marginMm}mm`, boxSizing: "border-box", overflow: "hidden", breakAfter: "page" }}
              >
                <span style={{ ...V, fontSize: coverFont, lineHeight: 1.12, fontWeight: 700 }}>{coverText}</span>
              </div>
            )}
            <div
              className="print-sheet mx-auto bg-white text-ink"
              style={{
                width: `${A4_PAGE.widthMm}mm`,
                height: `${A4_PAGE.heightMm}mm`,
                padding: `${A4_PAGE.marginMm}mm`,
                boxSizing: "border-box",
                overflow: "hidden",
                breakAfter: "page",
              }}
            >
              <header className="mb-3 text-center">
                <p className="text-sm tracking-widest text-ink">
                  台北三玄宮　{data.activityTypeLabel}疏文　{data.yearText}　{data.sexagenaryText}
                  {data.lunarDateText && `　農曆${data.lunarDateText}`}
                </p>
              </header>

              {/* 格線表格：4 橫帶 × N 欄（人），由右到左，等高對齊；各欄位字級依字數在固定框內自動縮放 */}
              <table style={{ borderCollapse: "collapse", margin: "0 auto", tableLayout: "fixed" }}>
                <tbody>
                  <tr>
                    {cols.map((e, i) => (
                      <td key={`t-${i}`} style={{ ...cellBase, height: `${BANDS.title.hMm}mm` }}>
                        <span style={{ ...V, fontSize: fieldFontPx(e.titleText, BANDS.title), lineHeight: 1.05 }}>{e.titleText}</span>
                      </td>
                    ))}
                  </tr>
                  <tr>
                    {cols.map((e, i) => (
                      <td key={`n-${i}`} style={{ ...cellBase, height: `${BANDS.name.hMm}mm` }}>
                        <span style={{ ...V, fontSize: fieldFontPx(e.name, BANDS.name), lineHeight: 1.05, fontWeight: 600 }}>{e.name}</span>
                      </td>
                    ))}
                  </tr>
                  <tr>
                    {cols.map((e, i) => {
                      const ageText = `${e.nominalAgeText}${e.birthText}吉時生`;
                      return (
                        <td key={`a-${i}`} style={{ ...cellBase, height: `${BANDS.age.hMm}mm` }}>
                          <span style={{ ...V, fontSize: fieldFontPx(ageText, BANDS.age), lineHeight: 1.08 }}>{ageText}</span>
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    {cols.map((e, i) => (
                      <td key={`d-${i}`} style={{ ...cellBase, height: `${BANDS.addr.hMm}mm`, verticalAlign: "top" }}>
                        <span style={{ ...V, fontSize: fieldFontPx(e.addressText, BANDS.addr), lineHeight: 1.04 }}>{e.addressText}</span>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>

              {/* 資料不完整未列入者（最後一頁提示；正式張貼前撕除） */}
              {pi === pages.length - 1 && data.excluded.length > 0 && (
                <section className="mt-4 border-t border-dashed border-ink-faint pt-2">
                  <h2 className="mb-1 text-xs text-ink-soft">以下 {data.excluded.length} 位資料不完整，未列入本份疏文，補齊後重印</h2>
                  <ul className="text-xs text-ink-faint">
                    {data.excluded.map((x, i) => <li key={`${x.name}-${i}`}>{x.name}：{x.issues.join("、")}</li>)}
                  </ul>
                </section>
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
