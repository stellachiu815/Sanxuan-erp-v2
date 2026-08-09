import { TABLET_FONT_FAMILY } from "./shared";

/**
 * 全家燈牌（一戶一張，固定 12cm × 10cm）。
 *
 * ── 版面（依 Stella 定案，對照實體樣張照片）─────────────────
 * 最上橫幅「闔家平安　家運昌隆」。下面每一位家人＝一「欄」（直書，由右到左），
 * 由上到下：稱謂（信士／信女）→ 姓名（最重要、最大）→ 歲數 → 生日（月日）→ 吉時生。
 * 最右側一整欄＝**主要聯絡人（戶長）的地址**（全家一個地址，非各自地址），直書、字體
 * 依長度自動縮放，務必完整顯示不截斷。欄數＝家人數，人多字小、人少字大（範圍內）。
 */

export type FamilyMember = {
  titleText: string; // 信士／信女
  name: string;
  nominalAgeText: string;
  birthText: string; // 農曆生月生日「七月十八日」
  addressText: string; // 家戶（主要聯絡人）地址，全家共用
};

const CARD_W_MM = 120;
const CARD_H_MM = 100;
const HEADER_MM = 10;
const V: React.CSSProperties = { writingMode: "vertical-rl", textOrientation: "upright", whiteSpace: "nowrap" };

/** 名框字級依人數調整：人少字大、人多字小（範圍內）。 */
function nameFontPx(count: number): number {
  if (count <= 4) return 22;
  if (count <= 7) return 18;
  if (count <= 10) return 15;
  if (count <= 13) return 13;
  return 11;
}
function infoFontPx(count: number): number {
  return Math.max(9, nameFontPx(count) - 5);
}
/** 地址依字數在卡高範圍內自動縮放，確保完整顯示不截斷。 */
function addrFontPx(len: number): number {
  if (len <= 0) return 14;
  const usableMm = CARD_H_MM - HEADER_MM - 6; // 扣掉標題與上下留白
  const fitPx = Math.floor((usableMm * 3.78) / (len * 1.02)); // 1mm≈3.78px、行距約 1.02
  return Math.max(8, Math.min(16, fitPx));
}

export default function FamilyLanternCard({ members }: { members: FamilyMember[] }) {
  const n = members.length;
  const nameFont = nameFontPx(n);
  const infoFont = infoFontPx(n);
  // 地址＝主要聯絡人（戶長）地址：全家共用同一個，取第一個非空即可（各成員的 addressText 皆為家戶地址）。
  const addr = members.find((m) => m.addressText.trim())?.addressText ?? "";

  return (
    <div
      className="bg-white text-ink"
      style={{
        width: `${CARD_W_MM}mm`,
        height: `${CARD_H_MM}mm`,
        border: "1px solid #333",
        padding: "3mm",
        display: "flex",
        flexDirection: "column",
        fontFamily: TABLET_FONT_FAMILY,
        boxSizing: "border-box",
        breakInside: "avoid",
      }}
    >
      <div
        className="text-center"
        style={{ height: `${HEADER_MM}mm`, fontSize: 20, fontWeight: 700, letterSpacing: "0.2em", lineHeight: `${HEADER_MM}mm` }}
      >
        闔家平安　家運昌隆
      </div>

      {/* 一列多欄，由右到左；最右先放地址欄，再由右到左排家人。 */}
      <div
        className="flex flex-row-reverse justify-center"
        style={{ flex: 1, alignItems: "stretch", gap: "1mm", minHeight: 0 }}
      >
        {/* 地址欄（最右、全家共用主要聯絡人地址） */}
        {addr && (
          <div
            className="flex items-start justify-center"
            style={{ borderRight: "1px solid #ccc", paddingRight: "1.5mm", marginRight: "0.5mm" }}
          >
            <span style={{ ...V, fontSize: addrFontPx(addr.length), lineHeight: 1.02 }}>{addr}</span>
          </div>
        )}

        {/* 家人欄（由右到左，一人一欄：稱謂→姓名→歲數→生日→吉時生） */}
        {members.map((m, i) => (
          <div key={`${m.name}-${i}`} className="flex flex-col items-center" style={{ justifyContent: "flex-start", minWidth: 0 }}>
            <span style={{ ...V, fontSize: infoFont, lineHeight: 1.05 }}>{m.titleText}</span>
            <span style={{ ...V, fontSize: nameFont, lineHeight: 1.05, marginTop: "1mm", fontWeight: 600 }}>{m.name}</span>
            {m.nominalAgeText && <span style={{ ...V, fontSize: infoFont, lineHeight: 1.05, marginTop: "1mm" }}>{m.nominalAgeText}</span>}
            {m.birthText && <span style={{ ...V, fontSize: infoFont, lineHeight: 1.05, marginTop: "1mm" }}>{m.birthText}</span>}
            <span style={{ ...V, fontSize: infoFont, lineHeight: 1.05, marginTop: "1mm" }}>吉時生</span>
          </div>
        ))}
      </div>
    </div>
  );
}
