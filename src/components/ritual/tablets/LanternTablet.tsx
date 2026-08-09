import { TABLET_FONT_FAMILY } from "./shared";

/**
 * 年度燈燈牌模板（光明燈／太歲燈／全家燈共用）。
 *
 * ── V39 版面（依 Stella 定案）─────────────────────────────
 * **橫式、文字由左到右，就三行**：
 *   第一行：姓名
 *   第二行：幾歲幾月幾日（虛歲 + 農曆生月生日）
 *   第三行：吉時建生（男）／吉時瑞生（女）
 *
 * 不再是直書、不放年度／歲次／生肖／太歲／地址（那些是核對用，不上燈牌）。
 * 這支只負責排版，文字都已在 lanternPrint.ts 由共用 printChinese 轉成國字後傳入。
 */

export type LanternTabletProps = {
  /** 信眾姓名（不轉換） */
  name: string;
  /** 「五十六歲」——依活動年度的虛歲 */
  nominalAgeText: string;
  /** 農曆生月生日「七月十八日」（不含年） */
  lunarBirthText: string;
  /** 「建生」（男）／「瑞生」（女） */
  jishiText: string;

  // ↓ 舊欄位保留為可選，維持既有呼叫相容；橫式三行版面不使用。
  lanternTypeText?: string;
  activityYearText?: string;
  sexagenaryText?: string;
  addressText?: string;
  zodiacText?: string;
  taisuiText?: string;
};

export default function LanternTablet({ entry }: { entry: LanternTabletProps }) {
  // 第二行：幾歲幾月幾日（虛歲 + 農曆生月生日）。
  const line2 = `${entry.nominalAgeText}${entry.lunarBirthText}`;
  // 第三行：吉時 + 建生／瑞生（依性別，男建生女瑞生；jishiText 已依性別帶好）。
  const line3 = entry.jishiText ? `吉時${entry.jishiText}` : "";

  return (
    <div
      className="tablet-card flex h-full w-full flex-col items-center justify-center border border-ink bg-white"
      style={{
        breakInside: "avoid",
        fontFamily: TABLET_FONT_FAMILY,
        padding: "1mm",
        gap: "0.6mm",
        textAlign: "center",
        lineHeight: 1.12,
        color: "#1a1a1a",
      }}
    >
      <span style={{ fontSize: 26, fontWeight: 700 }}>{entry.name}</span>
      {line2 && <span style={{ fontSize: 16 }}>{line2}</span>}
      {line3 && <span style={{ fontSize: 16 }}>{line3}</span>}
    </div>
  );
}
