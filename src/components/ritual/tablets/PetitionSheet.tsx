import { TABLET_FONT_FAMILY, A4_PAGE } from "./shared";
import type { PetitionData } from "@/lib/lanternPrint";

/**
 * V38 疏文列印（直書欄位版，依三玄宮實際格式重寫）。
 *
 * 版面（照片3）：一「欄」＝一位信眾，由上到下＝ 稱謂（信士／信女）→ 姓名 → 歲數 → 生日 → 吉時生 → 地址。
 * 排版通則（Stella 定案）：稱謂／姓名／歲數／生日／吉時生 **統一字級、整齊對齊**；
 *   **只有地址依字數在範圍內自動放到最大**（字少放大、字多縮小）。欄數不強求，整齊為主（每頁 15 欄）。
 * ⚠️ 這支只排版、不轉換；所有數字已在 lanternPrint.ts 轉成國字。
 */

const PER_PAGE = 15; // 每頁 15 欄（整齊為主，可再調）
const INFO_PX = 20; // 稱謂/姓名/歲數/生日/吉時生 統一字級
// 地址自動字級：單直行、依字數在範圍內最大化（同普渡牌位地址精神）。
const ADDR_AREA_PX = 480; // 地址可用高度（約 127mm）
function addrFontPx(len: number): number {
  if (len <= 0) return INFO_PX;
  const fit = Math.floor(ADDR_AREA_PX / (len * 1.06));
  return Math.max(11, Math.min(22, fit));
}

const V: React.CSSProperties = { writingMode: "vertical-rl", textOrientation: "upright" };

export default function PetitionSheet({ data }: { data: PetitionData }) {
  const entries = data.entries;
  const pages: (typeof entries)[] = [];
  for (let i = 0; i < entries.length; i += PER_PAGE) pages.push(entries.slice(i, i + PER_PAGE));
  if (pages.length === 0) pages.push([]);

  // 封面（照片4）：直書「台北三玄宮　歲次◯◯年　安【燈別】善信芳名」。干支由 sexagenaryText 自動帶入。
  const coverText = `台北三玄宮　${data.sexagenaryText}年　安${data.activityTypeLabel}善信芳名`;

  return (
    <div style={{ fontFamily: TABLET_FONT_FAMILY }}>
      {/* 封面頁 */}
      <div
        className="print-sheet mx-auto flex items-center justify-center bg-white text-ink"
        style={{ width: `${A4_PAGE.widthMm}mm`, minHeight: `${A4_PAGE.heightMm}mm`, padding: `${A4_PAGE.marginMm}mm`, breakAfter: "page" }}
      >
        <span style={{ ...V, fontSize: 56, lineHeight: 1.25, letterSpacing: "0.1em", fontWeight: 600 }}>{coverText}</span>
      </div>

      {pages.map((page, pi) => (
        <div
          key={pi}
          className="print-sheet mx-auto bg-white text-ink"
          style={{
            width: `${A4_PAGE.widthMm}mm`,
            minHeight: `${A4_PAGE.heightMm}mm`,
            padding: `${A4_PAGE.marginMm}mm`,
            breakAfter: "page",
          }}
        >
          <header className="mb-4 text-center">
            <h1 className="text-xl tracking-widest">台北三玄宮　{data.activityTypeLabel}　疏文</h1>
            <p className="mt-1 text-sm text-ink-soft">{data.yearText}　{data.sexagenaryText}{data.lunarDateText && `　農曆${data.lunarDateText}`}</p>
          </header>

          {/* 一列多欄，右到左（傳統直書）。每欄一人、由上到下堆疊各欄位。 */}
          <div className="flex flex-row-reverse flex-wrap justify-center gap-x-2" style={{ alignItems: "flex-start" }}>
            {page.map((e, i) => (
              <div key={`${e.name}-${i}`} className="flex flex-col items-center" style={{ width: "12mm" }}>
                <span style={{ ...V, fontSize: INFO_PX, lineHeight: 1.05 }}>{e.titleText}</span>
                <span style={{ ...V, fontSize: INFO_PX, lineHeight: 1.05, marginTop: "2mm", fontWeight: 600 }}>{e.name}</span>
                {e.nominalAgeText && <span style={{ ...V, fontSize: INFO_PX, lineHeight: 1.05, marginTop: "2mm" }}>{e.nominalAgeText}</span>}
                {e.birthText && <span style={{ ...V, fontSize: INFO_PX, lineHeight: 1.05, marginTop: "1mm" }}>{e.birthText}</span>}
                <span style={{ ...V, fontSize: INFO_PX, lineHeight: 1.05, marginTop: "1mm" }}>吉時生</span>
                {e.addressText && (
                  <span style={{ ...V, fontSize: addrFontPx(e.addressText.length), lineHeight: 1.02, marginTop: "2mm" }}>{e.addressText}</span>
                )}
              </div>
            ))}
          </div>

          {/* 資料不完整未列入者（僅第一頁末尾提示；正式張貼前撕除）。 */}
          {pi === pages.length - 1 && data.excluded.length > 0 && (
            <section className="mt-8 border-t border-dashed border-ink-faint pt-3 print:break-before-page">
              <h2 className="mb-1 text-sm text-ink-soft">以下 {data.excluded.length} 位資料不完整，未列入本份疏文，補齊後重印</h2>
              <ul className="text-xs text-ink-faint">
                {data.excluded.map((x, i) => <li key={`${x.name}-${i}`}>{x.name}：{x.issues.join("、")}</li>)}
              </ul>
            </section>
          )}
        </div>
      ))}
    </div>
  );
}
