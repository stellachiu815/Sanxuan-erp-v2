import { TABLET_FONT_FAMILY } from "./shared";

/**
 * V38 全家燈牌（一戶一張，固定 12cm × 10cm，名框依人數 6～15 動態）。
 *
 * 版面（照片2）：最上橫幅「闔家平安　家運昌隆」；下面一「欄」＝一位家人（直書），
 *   由上到下：稱謂（信士／信女）→ 姓名 → 歲數 → 生日 → 吉時生。最右一整欄＝地址
 *   （取「最靠近地址欄那位」＝最右邊那位家人的個人地址；全家不一定同址）。
 * 排版通則：稱謂/姓名/歲數/生日/吉時生 統一字級；地址依字數在範圍內自動放大。欄數＝人數，自動分欄。
 */

export type FamilyMember = {
  titleText: string; // 信士／信女
  name: string;
  nominalAgeText: string;
  birthText: string;
  addressText: string;
};

const CARD_W_MM = 120;
const CARD_H_MM = 100;
const V: React.CSSProperties = { writingMode: "vertical-rl", textOrientation: "upright" };

/** 名框字級依人數調整：人少字大、人多字小（在範圍內）。 */
function infoFontPx(count: number): number {
  if (count <= 6) return 20;
  if (count <= 9) return 17;
  if (count <= 12) return 14;
  return 12;
}
function addrFontPx(len: number, count: number): number {
  const base = infoFontPx(count) + 2;
  if (len <= 0) return base;
  const fit = Math.floor((CARD_H_MM * 3.6) / (len * 1.06)); // 地址欄約滿卡高
  return Math.max(9, Math.min(base, fit));
}

export default function FamilyLanternCard({ members }: { members: FamilyMember[] }) {
  // 地址＝最右邊那位（最靠近地址欄）的個人地址；空的話往左找第一個非空。
  const rightMost = [...members].reverse();
  const addr = (rightMost.find((m) => m.addressText.trim())?.addressText) ?? "";
  const n = members.length;
  const info = infoFontPx(n);

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
      <div className="text-center" style={{ fontSize: 18, fontWeight: 700, letterSpacing: "0.15em", marginBottom: "2mm" }}>
        闔家平安　家運昌隆
      </div>
      {/* 一列多欄，右到左；最右先放地址欄，再放家人（由右到左）。 */}
      <div className="flex flex-row-reverse justify-center" style={{ flex: 1, alignItems: "stretch", gap: "0.5mm", overflow: "hidden" }}>
        {/* 地址欄（最右） */}
        {addr && (
          <div className="flex items-start justify-center" style={{ minWidth: "8mm", borderRight: "1px solid #ccc", paddingRight: "1mm" }}>
            <span style={{ ...V, fontSize: addrFontPx(addr.length, n), lineHeight: 1.02 }}>{addr}</span>
          </div>
        )}
        {/* 家人欄（由右到左） */}
        {members.map((m, i) => (
          <div key={`${m.name}-${i}`} className="flex flex-col items-center" style={{ flex: 1, minWidth: 0 }}>
            <span style={{ ...V, fontSize: info, lineHeight: 1.05 }}>{m.titleText}</span>
            <span style={{ ...V, fontSize: info, lineHeight: 1.05, marginTop: "1mm", fontWeight: 600 }}>{m.name}</span>
            {m.nominalAgeText && <span style={{ ...V, fontSize: info, lineHeight: 1.05, marginTop: "1mm" }}>{m.nominalAgeText}</span>}
            {m.birthText && <span style={{ ...V, fontSize: info, lineHeight: 1.05, marginTop: "1mm" }}>{m.birthText}</span>}
            <span style={{ ...V, fontSize: info, lineHeight: 1.05, marginTop: "1mm" }}>吉時生</span>
          </div>
        ))}
      </div>
    </div>
  );
}
