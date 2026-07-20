import { TABLET_FONT_FAMILY } from "./shared";

/**
 * V13.1 指令十一／十二：年度燈燈牌模板（光明燈／太歲燈／全家燈共用）。
 *
 * ⚠️ 這支元件**只負責排版，不做任何轉換**。
 * 所有文字（年度、歲數、生肖、太歲、建生瑞生、地址）都已經在
 * src/lib/lanternPrint.ts 由共用的 printChinese 轉成國字後才傳進來——
 * 這是指令十二「不得在每個模板各寫一套轉換邏輯」的實作方式。
 *
 * 套版約定（與四種牌位模板一致）：
 * - 外層容器維持 h-full w-full，尺寸由外面的 A4 版型格線決定
 * - 字體透過 TABLET_FONT_FAMILY 套用，要換標楷體只改 shared.ts
 * - 之後三玄宮提供正式燈牌設計時，只需替換這支檔案的 JSX／CSS
 */

export type LanternTabletProps = {
  /** 「光明燈」／「太歲燈」／「全家燈」 */
  lanternTypeText: string;
  /** 「民國一百一十六年」——**活動使用年度**，不是今年 */
  activityYearText: string;
  /** 「歲次丁未」 */
  sexagenaryText: string;
  /** 信眾姓名（不轉換） */
  name: string;
  /** 已國字化的地址 */
  addressText: string;
  /** 「三十八歲」 */
  nominalAgeText: string;
  /** 生肖「馬」 */
  zodiacText: string;
  /** 「建生」／「瑞生」 */
  jishiText: string;
  /** 「沖太歲」等；不犯太歲為空字串 */
  taisuiText: string;
};

export default function LanternTablet({ entry }: { entry: LanternTabletProps }) {
  return (
    <div
      className="tablet-card flex h-full w-full items-stretch justify-center gap-3 border-2 border-double border-ink bg-white px-4 py-6"
      style={{ breakInside: "avoid", fontFamily: TABLET_FONT_FAMILY }}
    >
      {/* 右側：年度與活動別 */}
      <div
        className="flex flex-col items-center justify-start text-xs leading-relaxed text-ink-soft"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        <span>{entry.activityYearText}</span>
        <span>{entry.sexagenaryText}</span>
        <span>{entry.lanternTypeText}</span>
      </div>

      {/* 中央：信眾姓名（主體） */}
      <div
        className="flex items-center justify-center text-center text-2xl leading-relaxed text-ink"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        {entry.name}
      </div>

      {/* 左側：歲數、生肖、建生瑞生、太歲、地址 */}
      <div
        className="flex flex-col items-center justify-start text-xs leading-relaxed text-ink-soft"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        {entry.nominalAgeText && <span>{entry.nominalAgeText}</span>}
        {entry.zodiacText && <span>{`${entry.zodiacText}相`}</span>}
        {entry.jishiText && <span>{entry.jishiText}</span>}
        {/* 不犯太歲時整個欄位不顯示，不印「無」 */}
        {entry.taisuiText && <span>{entry.taisuiText}</span>}
        {entry.addressText && <span>{entry.addressText}</span>}
      </div>
    </div>
  );
}
