import { TABLET_FONT_FAMILY, toPrintableTablet, type PrintTabletEntry } from "./shared";

/**
 * 無緣子女牌位模板（V4.0 建立暫時版型，V4.1 改為可套版）。
 *
 * ⚠️ 這是暫時版型，之後三玄宮提供正式牌位設計後，只需要替換這支檔案裡的
 * JSX／CSS 外觀即可，不用更動其他程式，請維持以下約定：
 * - props 一律維持 { entry: PrintTabletEntry }。
 * - 外層容器請維持 h-full w-full（實際大小由外面 A4 8/12/16 張版型的
 *   格線決定，不要在這裡寫死尺寸）。
 * - 字體請透過 TABLET_FONT_FAMILY（見 ./shared.ts）套用，不要在這裡寫死
 *   字體，之後要換成標楷體時只需要改 shared.ts 一個地方。
 * - **文字一律取自 toPrintableTablet() 的結果**，不要在這裡自行轉換數字、
 *   也不要自行附加「叩薦」（V13.1 指令六、十二：轉換只能有一套）。
 */
export default function UnbornChildTablet({ entry }: { entry: PrintTabletEntry }) {
  const p = toPrintableTablet(entry);

  return (
    <div
      className="tablet-card flex h-full w-full items-center justify-center gap-2 border-2 border-dashed border-ink bg-white px-4 py-6"
      style={{ breakInside: "avoid", fontFamily: TABLET_FONT_FAMILY }}
    >
      <div
        className="text-center text-2xl leading-relaxed text-ink"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        {p.displayName}
      </div>

      {p.locationText && (
        <div
          className="text-center text-xs leading-relaxed text-ink-soft"
          style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
        >
          {p.locationText}
        </div>
      )}

      {/* 陽上人：yangshangText 已含「叩薦」，這裡不再加任何字 */}
      {p.yangshangText && (
        <div
          className="text-center text-sm leading-relaxed text-ink-soft"
          style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
        >
          {p.yangshangText}
        </div>
      )}
    </div>
  );
}
