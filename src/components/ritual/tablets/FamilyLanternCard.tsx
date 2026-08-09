import { TABLET_FONT_FAMILY } from "./shared";

/**
 * 全家燈牌（一戶一張，固定 12cm × 10cm）。**內容一律塞進這張卡內、絕不溢出到第二頁。**
 *
 * 版面（依 Stella 定案）：最上橫幅「闔家平安　家運昌隆」；下面每位家人一欄（直書、由右到左），
 * 由上到下：稱謂（信士／信女）→ 姓名 → 歲數 → 生日 → 吉時生。最右一整欄＝主要聯絡人（戶長）地址。
 *
 * ⚠️ 自動縮放：字級同時受「卡片高度」（最長一欄的字數）與「卡片寬度」（人數）雙重限制，取最小者，
 *    確保 6～30 位、甚至含長外文名，都能完整塞進固定 120×100mm，overflow hidden 保證不爆頁。
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
const HEADER_MM = 9;
const PAD_MM = 3;
const MM = 3.78; // 1mm ≈ 3.78px

const V: React.CSSProperties = { writingMode: "vertical-rl", textOrientation: "upright", whiteSpace: "nowrap" };

export default function FamilyLanternCard({ members }: { members: FamilyMember[] }) {
  const n = Math.max(1, members.length);
  // 地址＝主要聯絡人（戶長）地址：全家共用，取第一個非空。
  const addr = members.find((m) => m.addressText.trim())?.addressText ?? "";

  // 可用區（扣掉 padding 與標題）。
  const bodyHmm = CARD_H_MM - HEADER_MM - PAD_MM * 2; // 名框可用高度
  const bodyWmm = CARD_W_MM - PAD_MM * 2; // 全部欄可用寬度
  const addrColWmm = addr ? Math.min(10, bodyWmm * 0.12) : 0; // 地址欄寬（最右）
  const membersWmm = bodyWmm - addrColWmm;

  // 每欄字級：受高度（最長一欄的堆疊字數）與寬度（人數）雙重限制，取最小。
  const maxColChars = Math.max(
    ...members.map((m) => m.titleText.length + m.name.length + m.nominalAgeText.length + m.birthText.length + 3)
  );
  const fontByHeight = Math.floor((bodyHmm * MM) / (Math.max(6, maxColChars) * 1.06));
  const fontByWidth = Math.floor((membersWmm / n) * MM * 0.82);
  const colFont = Math.max(6, Math.min(20, fontByHeight, fontByWidth));
  const nameFont = Math.min(colFont + 2, Math.floor((membersWmm / n) * MM * 0.9));

  // 地址欄字級：依字數塞滿卡高。
  const addrFont = addr
    ? Math.max(7, Math.min(14, Math.floor(((CARD_H_MM - PAD_MM * 2) * MM) / (addr.length * 1.04))))
    : 12;

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
        overflow: "hidden", // ⚠️ 絕不溢出：塞不下就縮字，不爆到第二頁
      }}
    >
      <div
        className="text-center"
        style={{ height: `${HEADER_MM}mm`, fontSize: 18, fontWeight: 700, letterSpacing: "0.15em", lineHeight: `${HEADER_MM}mm` }}
      >
        闔家平安　家運昌隆
      </div>

      <div className="flex flex-row-reverse justify-center" style={{ flex: 1, alignItems: "flex-start", gap: 0, minHeight: 0, overflow: "hidden" }}>
        {/* 地址欄（最右、全家共用主要聯絡人地址） */}
        {addr && (
          <div className="flex items-start justify-center" style={{ width: `${addrColWmm}mm`, borderRight: "1px solid #ccc", overflow: "hidden" }}>
            <span style={{ ...V, fontSize: addrFont, lineHeight: 1.0 }}>{addr}</span>
          </div>
        )}
        {/* 家人欄（由右到左，一人一欄） */}
        {members.map((m, i) => (
          <div key={`${m.name}-${i}`} className="flex flex-col items-center" style={{ width: `${membersWmm / n}mm`, overflow: "hidden" }}>
            <span style={{ ...V, fontSize: colFont, lineHeight: 1.02 }}>{m.titleText}</span>
            <span style={{ ...V, fontSize: nameFont, lineHeight: 1.02, fontWeight: 600 }}>{m.name}</span>
            {m.nominalAgeText && <span style={{ ...V, fontSize: colFont, lineHeight: 1.02 }}>{m.nominalAgeText}</span>}
            {m.birthText && <span style={{ ...V, fontSize: colFont, lineHeight: 1.02 }}>{m.birthText}</span>}
            <span style={{ ...V, fontSize: colFont, lineHeight: 1.02 }}>吉時生</span>
          </div>
        ))}
      </div>
    </div>
  );
}
