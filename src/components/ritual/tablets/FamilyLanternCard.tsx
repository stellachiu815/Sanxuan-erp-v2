import { TABLET_FONT_FAMILY } from "./shared";
import { fitVerticalFont, type FontFitConfig } from "./fontFit";

/**
 * 全家燈牌（一戶一張，固定 12cm × 10cm）。**內容一律塞進這張卡內、絕不溢出。**
 *
 * ── 版面（依 Stella 定案，對照實體樣張）───────────────────────
 * 最上橫幅「闔家平安　家運昌隆」（放大）。下面一個**乾淨格線表格**（不再表中表、無多餘外線）：
 *   每位家人一欄（由右到左），橫帶由上到下：稱謂（信士／信女）→ 姓名 → 歲數 → 生日＋吉時生，
 *   帶與帶之間、欄與欄之間都有格線、等高對齊。最右一整欄＝主要聯絡人（戶長）地址（全家共用一個）。
 * 字級用共用 fitVerticalFont() 依字數在各固定框內自動縮放，6～30 位含長外文名都塞得下。
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
const HEADER_MM = 16; // 標題「闔家平安　家運昌隆」放大用
const PAD_MM = 3;
const ADDR_W_MM = 13; // 地址欄寬（最右）

// 四橫帶固定高度（mm），總高 = 卡高 - 標題 - 上下 padding = 78mm。
const BAND = { title: 10, name: 18, age: 16, birth: 34 } as const;

const V: React.CSSProperties = { writingMode: "vertical-rl", textOrientation: "upright", whiteSpace: "nowrap" };

export default function FamilyLanternCard({ members }: { members: FamilyMember[] }) {
  const n = Math.max(1, members.length);
  const cols = [...members].reverse(); // 由右到左（第一位在最右、緊鄰地址欄）
  const addr = members.find((m) => m.addressText.trim())?.addressText ?? "";

  const bodyWmm = CARD_W_MM - PAD_MM * 2;
  const colWmm = (bodyWmm - (addr ? ADDR_W_MM : 0)) / n; // 每位家人欄寬
  const bodyHmm = CARD_H_MM - HEADER_MM - PAD_MM * 2;

  const cfg = (maxPx: number): FontFitConfig => ({ maxPx, minPx: 6, stepPx: 1 });
  const fit = (text: string, hMm: number, maxPx: number) =>
    fitVerticalFont(text.length, colWmm - 1, hMm - 1, cfg(maxPx), { lineHeight: 1.04, colSpacing: 1.04 }).px;
  const addrFont = addr
    ? fitVerticalFont(addr.length, ADDR_W_MM - 1, bodyHmm - 1, cfg(14), { lineHeight: 1.02, colSpacing: 1.04 }).px
    : 12;

  const cell: React.CSSProperties = {
    border: "1px solid #333",
    textAlign: "center",
    padding: 0,
    overflow: "hidden",
    boxSizing: "border-box",
  };

  return (
    <div
      className="bg-white text-ink"
      style={{
        width: `${CARD_W_MM}mm`,
        height: `${CARD_H_MM}mm`,
        border: "1px solid #333",
        padding: `${PAD_MM}mm`,
        display: "flex",
        flexDirection: "column",
        fontFamily: TABLET_FONT_FAMILY,
        boxSizing: "border-box",
        breakInside: "avoid",
        overflow: "hidden",
      }}
    >
      <div
        className="text-center"
        style={{ height: `${HEADER_MM}mm`, fontSize: 42, fontWeight: 700, letterSpacing: "0.12em", lineHeight: `${HEADER_MM}mm`, whiteSpace: "nowrap" }}
      >
        闔家平安　家運昌隆
      </div>

      {/* 乾淨格線表格：4 橫帶 × N 欄（人），右到左；最右一欄＝地址（rowSpan 跨滿四帶） */}
      <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: "100%", height: `${bodyHmm}mm` }}>
        <tbody>
          <tr>
            {cols.map((m, i) => (
              <td key={`t-${i}`} style={{ ...cell, width: `${colWmm}mm`, height: `${BAND.title}mm` }}>
                <span style={{ ...V, fontSize: fit(m.titleText, BAND.title, 16), lineHeight: 1.02 }}>{m.titleText}</span>
              </td>
            ))}
            {addr && (
              <td rowSpan={4} style={{ ...cell, width: `${ADDR_W_MM}mm`, verticalAlign: "top" }}>
                <span style={{ ...V, fontSize: addrFont, lineHeight: 1.02 }}>{addr}</span>
              </td>
            )}
          </tr>
          <tr>
            {cols.map((m, i) => (
              <td key={`n-${i}`} style={{ ...cell, height: `${BAND.name}mm` }}>
                <span style={{ ...V, fontSize: fit(m.name, BAND.name, 24), lineHeight: 1.02, fontWeight: 600 }}>{m.name}</span>
              </td>
            ))}
          </tr>
          <tr>
            {cols.map((m, i) => (
              <td key={`a-${i}`} style={{ ...cell, height: `${BAND.age}mm` }}>
                {m.nominalAgeText && <span style={{ ...V, fontSize: fit(m.nominalAgeText, BAND.age, 18), lineHeight: 1.02 }}>{m.nominalAgeText}</span>}
              </td>
            ))}
          </tr>
          <tr>
            {cols.map((m, i) => {
              const birth = `${m.birthText}吉時生`;
              return (
                <td key={`b-${i}`} style={{ ...cell, height: `${BAND.birth}mm`, verticalAlign: "top" }}>
                  <span style={{ ...V, fontSize: fit(birth, BAND.birth, 16), lineHeight: 1.02 }}>{birth}</span>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
