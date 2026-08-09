import { Fragment } from "react";
import { TABLET_FONT_FAMILY, A4_PAGE } from "./shared";
import { fitVerticalFont, type FontFitConfig } from "./fontFit";
import type { PetitionData } from "@/lib/lanternPrint";

/**
 * 疏文列印（直書格線表格版，依三玄宮實體樣張重做）。
 *
 * ── 版面（對照實體折扇疏文）───────────────────────────────
 * 一份連續的直書格線表格，由右到左：
 *   **最右邊一整欄＝封面**（「台北三玄宮」大字 ＋ 事由「歲次◯年安◯燈善信芳名」），整份只出現一次、
 *   不獨立成頁、不需裁切；接著每位信眾一欄（稱謂→姓名→歲數/生日/吉時生→地址），格線分隔、等高對齊。
 * 印出後由人工摺成折扇（直向折線）；折格對不準是正常的（手工＋墊厚紙板），**程式不設折格**，
 * 只負責把內文格式統一乾淨。
 *
 * ── 自動縮放（與中元普渡牌位同一支 fitVerticalFont）─────────
 * 每欄位固定框（公分）、字體依字數在框內自動縮放；四帶＋邊界穩穩塞進一張 A4 可印範圍，表格不跨頁。
 *
 * ⚠️ 只排版、不轉換；數字已在 lanternPrint.ts 轉成國字。
 */

const PER_PAGE = 13; // 每頁 13 人（欄）＋封面欄，排滿 A4 直式寬（欄較寬、字更大）
const COL_W_MM = 13; // 每欄寬（加寬 → 姓名/稱謂可更大）
const COVER_W_MM = 20; // 封面欄較寬（醒目）
const PAD_MM = 1.5; // 文字與格線之間留白

// 各橫帶固定框（高度 mm）＋字級上下限（框固定、字依字數縮放）。
// ⚠️ 已強制去掉瀏覽器邊界（margin:0），這裡把邊界縮到最窄、各帶拉到接近滿版，字級最大化（老花友善）；
//    四帶總高 280mm ＋ 紙張 padding 12mm ＝ 292mm < 297mm，仍穩穩一張 A4、不跨頁。
const BANDS = {
  title: { hMm: 20, cfg: { maxPx: 36, minPx: 16, stepPx: 2 } as FontFitConfig },
  name: { hMm: 36, cfg: { maxPx: 44, minPx: 18, stepPx: 2 } as FontFitConfig },
  age: { hMm: 98, cfg: { maxPx: 34, minPx: 14, stepPx: 1 } as FontFitConfig },
  addr: { hMm: 126, cfg: { maxPx: 32, minPx: 12, stepPx: 1 } as FontFitConfig },
};
const TABLE_H_MM = BANDS.title.hMm + BANDS.name.hMm + BANDS.age.hMm + BANDS.addr.hMm; // 194

/** 某欄位在其固定框內的字級（依字數自動縮放）。 */
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

  // 封面（整份最右一欄）：台北三玄宮（大）＋事由（歲次◯年安◯燈善信芳名）。
  const coverTitle = "台北三玄宮";
  const coverDesc = `${data.sexagenaryText}年安${data.activityTypeLabel}善信芳名`;
  // 封面欄字級：填滿整份表格高度（台北三玄宮約佔上 1/3、事由佔下 2/3）。
  const coverTitleFont = Math.max(28, Math.min(56, Math.floor((TABLE_H_MM * 0.34 * 3.78) / (coverTitle.length * 1.12))));
  const coverDescFont = Math.max(18, Math.min(36, Math.floor((TABLE_H_MM * 0.62 * 3.78) / (coverDesc.length * 1.12))));

  return (
    <div style={{ fontFamily: TABLET_FONT_FAMILY }}>
      {pages.map((page, pi) => {
        const cols = [...page].reverse(); // 由右到左（傳統直書：第一位在最右）
        return (
          <Fragment key={pi}>
            <div
              className="print-sheet mx-auto bg-white text-ink"
              style={{
                width: `${A4_PAGE.widthMm}mm`,
                padding: "6mm",
                boxSizing: "border-box",
                overflow: "hidden",
                breakInside: "avoid",
                breakAfter: pi === pages.length - 1 ? "auto" : "page",
              }}
            >
              {/* 格線表格：4 橫帶 × N 欄（人），由右到左；第一頁最右加一欄封面。等高對齊、字級自動縮放。 */}
              <table style={{ borderCollapse: "collapse", margin: "0 auto", tableLayout: "fixed", breakInside: "avoid" }}>
                <tbody>
                  <tr>
                    {cols.map((e, i) => (
                      <td key={`t-${i}`} style={{ ...cellBase, height: `${BANDS.title.hMm}mm` }}>
                        <span style={{ ...V, fontSize: fieldFontPx(e.titleText, BANDS.title), lineHeight: 1.05 }}>{e.titleText}</span>
                      </td>
                    ))}
                    {/* 封面欄：整份最右、跨滿四帶，只在第一頁出現 */}
                    {pi === 0 && (
                      <td rowSpan={4} style={{ ...cellBase, width: `${COVER_W_MM}mm`, verticalAlign: "top" }}>
                        <div className="flex h-full flex-col items-center" style={{ paddingTop: "2mm" }}>
                          <span style={{ ...V, fontSize: coverTitleFont, lineHeight: 1.06, fontWeight: 700 }}>{coverTitle}</span>
                          <span style={{ ...V, fontSize: coverDescFont, lineHeight: 1.12, marginTop: "3mm" }}>{coverDesc}</span>
                        </div>
                      </td>
                    )}
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
                <section className="mt-4 border-t border-dashed border-ink-faint pt-2 print:hidden">
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
