import { Fragment } from "react";
import { TABLET_FONT_FAMILY, A4_PAGE } from "./shared";
import type { PetitionData } from "@/lib/lanternPrint";

/**
 * 疏文列印（直書格線表格版，依三玄宮實際樣張＋Stella 定案重寫）。
 *
 * ── 封面 ─────────────────────────────────────────────────
 * **一整行直書、不換行**：「台北三玄宮歲次◯◯年安【燈別】善信芳名」。
 * 干支由 sexagenaryText 自動帶入、燈別跟著正在列印的燈別（光明／太歲／全家）自動帶。
 * 整條可裁下貼在疏文最前面，所以務必單一直行不折行。
 *
 * ── 內頁（照片5 樣式）────────────────────────────────────
 * 有**格線**的表格，每人一欄、由右到左；各屬性**對齊成等高橫帶**：
 *   第1帶 稱謂（信士／信女）→ 第2帶 姓名 → 第3帶 幾歲幾月幾日＋吉時生 → 第4帶 地址。
 * 每帶等高、有框線，方便閱讀、人多也整齊。每頁 15 人。
 * ⚠️ 只排版、不轉換；數字已在 lanternPrint.ts 轉成國字。
 */

const PER_PAGE = 15; // 每頁 15 人（欄）

// 各橫帶固定高度（mm）——等高對齊的關鍵。用滿 A4 直式高度、字級盡量放大
// （誦經師姐多老花，好讀優先）。四帶總高約 258mm，貼近 A4 可用高度上限。
const H_TITLE = 18; // 稱謂
const H_NAME = 34; // 姓名
const H_AGE = 88; // 幾歲幾月幾日＋吉時生
const H_ADDR = 118; // 地址

const TITLE_PX = 28; // 稱謂
const NAME_PX = 32; // 姓名（最大、最重要）
const AGE_PX = 26; // 幾歲幾月幾日＋吉時生

// 地址依字數在該帶高度內自動放到最大（字少放大、字多縮小），確保完整不截斷。
function addrFontPx(len: number): number {
  if (len <= 0) return AGE_PX;
  const fit = Math.floor(((H_ADDR - 5) * 3.78) / (len * 1.04)); // 1mm≈3.78px，扣掉上下 padding
  return Math.max(12, Math.min(30, fit));
}

const V: React.CSSProperties = { writingMode: "vertical-rl", textOrientation: "upright", whiteSpace: "nowrap" };
// 欄寬 12mm（15 人/頁剛好排滿 A4 寬），文字與格線之間留 padding（原本太貼、看起來不舒服）。
// box-sizing 讓 padding 不撐破固定高度。
const cellBase: React.CSSProperties = {
  border: "1px solid #333",
  width: "12mm",
  textAlign: "center",
  padding: "2.5mm 1mm",
  boxSizing: "border-box",
};

export default function PetitionSheet({ data }: { data: PetitionData }) {
  const entries = data.entries;
  const pages: (typeof entries)[] = [];
  for (let i = 0; i < entries.length; i += PER_PAGE) pages.push(entries.slice(i, i + PER_PAGE));
  if (pages.length === 0) pages.push([]);

  // 封面：每 COVER_EVERY 頁內頁前放一張（省紙、又能分段）。一整行直書、不換行；
  // 干支＋燈別自動帶入。宮方若改用 Word 封面樣張，把 COVER_EVERY 這段拿掉即可。
  const coverText = `台北三玄宮${data.sexagenaryText}年安${data.activityTypeLabel}善信芳名`;
  const COVER_EVERY = 4;

  return (
    <div style={{ fontFamily: TABLET_FONT_FAMILY }}>
      {pages.map((page, pi) => {
        const cols = [...page].reverse(); // 由右到左（傳統直書：第一位在最右）
        return (
          <Fragment key={pi}>
            {pi % COVER_EVERY === 0 && (
              <div
                className="print-sheet mx-auto flex items-center justify-center bg-white text-ink"
                style={{ width: `${A4_PAGE.widthMm}mm`, minHeight: `${A4_PAGE.heightMm}mm`, padding: `${A4_PAGE.marginMm}mm`, breakAfter: "page" }}
              >
                <span style={{ ...V, fontSize: 46, lineHeight: 1.1, letterSpacing: "0.05em", fontWeight: 700 }}>{coverText}</span>
              </div>
            )}
            <div
              className="print-sheet mx-auto bg-white text-ink"
              style={{
                width: `${A4_PAGE.widthMm}mm`,
                minHeight: `${A4_PAGE.heightMm}mm`,
                padding: `${A4_PAGE.marginMm}mm`,
                breakAfter: "page",
              }}
            >
            <header className="mb-3 text-center">
              <p className="text-sm tracking-widest text-ink">
                台北三玄宮　{data.activityTypeLabel}疏文　{data.yearText}　{data.sexagenaryText}
                {data.lunarDateText && `　農曆${data.lunarDateText}`}
              </p>
            </header>

            {/* 格線表格：4 橫帶 × N 欄（人），由右到左，等高對齊 */}
            <table style={{ borderCollapse: "collapse", margin: "0 auto", tableLayout: "fixed" }}>
              <tbody>
                <tr>
                  {cols.map((e, i) => (
                    <td key={`t-${i}`} style={{ ...cellBase, height: `${H_TITLE}mm` }}>
                      <span style={{ ...V, fontSize: TITLE_PX, lineHeight: 1.05 }}>{e.titleText}</span>
                    </td>
                  ))}
                </tr>
                <tr>
                  {cols.map((e, i) => (
                    <td key={`n-${i}`} style={{ ...cellBase, height: `${H_NAME}mm` }}>
                      <span style={{ ...V, fontSize: NAME_PX, lineHeight: 1.05, fontWeight: 600 }}>{e.name}</span>
                    </td>
                  ))}
                </tr>
                <tr>
                  {cols.map((e, i) => (
                    <td key={`a-${i}`} style={{ ...cellBase, height: `${H_AGE}mm` }}>
                      <span style={{ ...V, fontSize: AGE_PX, lineHeight: 1.08 }}>
                        {`${e.nominalAgeText}${e.birthText}吉時生`}
                      </span>
                    </td>
                  ))}
                </tr>
                <tr>
                  {cols.map((e, i) => (
                    <td key={`d-${i}`} style={{ ...cellBase, height: `${H_ADDR}mm`, verticalAlign: "top" }}>
                      <span style={{ ...V, fontSize: addrFontPx(e.addressText.length), lineHeight: 1.02 }}>{e.addressText}</span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>

            {/* 資料不完整未列入者（最後一頁提示；正式張貼前撕除） */}
            {pi === pages.length - 1 && data.excluded.length > 0 && (
              <section className="mt-6 border-t border-dashed border-ink-faint pt-3">
                <h2 className="mb-1 text-sm text-ink-soft">以下 {data.excluded.length} 位資料不完整，未列入本份疏文，補齊後重印</h2>
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
