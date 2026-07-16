import { TABLET_FONT_FAMILY, type PrintTabletEntry } from "./shared";

/**
 * 冤親債主牌位模板（V4.0 建立暫時版型，V4.1 改為可套版）。
 *
 * ⚠️ 這是暫時版型，之後三玄宮提供正式牌位設計後，只需要替換這支檔案裡的
 * JSX／CSS 外觀即可，不用更動其他程式，請維持以下約定：
 * - props 一律維持 { entry: PrintTabletEntry }。
 * - 外層容器請維持 h-full w-full（實際大小由外面 A4 8/12/16 張版型的
 *   格線決定，不要在這裡寫死尺寸）。
 * - 字體請透過 TABLET_FONT_FAMILY（見 ./shared.ts）套用，不要在這裡寫死
 *   字體，之後要換成標楷體時只需要改 shared.ts 一個地方。
 */
export default function DebtCreditorTablet({ entry }: { entry: PrintTabletEntry }) {
  return (
    <div
      className="tablet-card flex h-full w-full items-center justify-center border-2 border-solid border-ink bg-white px-4 py-6"
      style={{ breakInside: "avoid", fontFamily: TABLET_FONT_FAMILY }}
    >
      <div
        className="text-center text-2xl leading-relaxed text-ink"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        {entry.displayName}
      </div>
    </div>
  );
}
