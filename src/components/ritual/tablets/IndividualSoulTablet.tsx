import { TABLET_FONT_FAMILY, toPrintableTablet, type PrintTabletEntry } from "./shared";

/**
 * 個人乙位正魂牌位模板（V4.0 建立暫時版型，V4.1 可套版，V13.1 加入
 * 牌位地址並全面國字化）。
 *
 * 套版約定與其他三個模板相同，見 AncestorLineTablet.tsx 的說明。
 * 特別注意：**不要**在這裡自行附加「叩薦」或轉換數字——
 * 那些一律由 toPrintableTablet()（./shared.ts）處理。
 */
export default function IndividualSoulTablet({ entry }: { entry: PrintTabletEntry }) {
  const p = toPrintableTablet(entry);

  return (
    <div
      className="tablet-card flex h-full w-full items-center justify-center gap-2 border-2 border-double border-ink bg-white px-4 py-6"
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
