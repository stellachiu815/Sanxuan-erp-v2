/**
 * V33 中元普渡「橫式 A4 直書・群組版型」正式引擎（純函式，可測試）。
 *
 * 依附件一（祖先）／附件二（多位陽上人）——唯一視覺基準：
 *
 *   每一筆資料 = 一個「群組（Group）＝一戶」，群組內為**緊密相鄰的直書欄**（由右至左）：
 *        主文（右，最大化、視覺主體，佔多數高度）
 *        陽上人＋叩薦（中，靠上小字）
 *        地址（左，滿高小字直書）
 *   所有群組「由右至左」排列；群組內緊密、群組間有明顯間距（＝一眼可分辨一戶）。
 *
 *   陽上人排版（正式規則）：
 *     1~3 人：**主文上下組合**——地址獨立直欄；主文在上、陽上人姓名＋叩薦於主文正下方。
 *             此模式優先讓主文字體最大，陽上人不另占一整條獨立直欄。
 *     4 人以上：**三欄**——主文｜陽上人（獨立直欄完整排列）｜地址；多位陽上人不移到主文下方、
 *             不裁字；主文不縮小。
 *
 *   - 主文在其欄內最大化（寬不超欄、不裁字），主文字級不因陽上人人數改變；4 字可比 6 字更大；
 *     無緣子女主文可再獨立放大。
 *   - 密度依附件一重算（約 7~9 筆／頁）：紙寬 ÷ 群組寬 自動 packing；standard≈附件一，economy＝省紙。
 *   - No.xxx 置群組左上裁切安全角（內容外）。正式列印/預覽**無** slot/Bounding Box/Safe Area/外框/Debug。
 *   - 累世冤親債主／無緣子女與祖先/乙位**完全同版型**，唯一差別是主文文字（上游 mainText 帶入）。
 */

import { fitVerticalFont, fitYangshangVertical } from "./fontFit";
import { cleanTabletMainText } from "./tabletMainTextFit";
import { formatYangshangAcclaim } from "@/lib/yangshang";
import type {
  TabletDocumentType, TabletA4Offset, PositionedBlock, TabletPage, TabletLayout, TabletRecordInput, LayoutViolation,
} from "./universalSalvationTabletA4";
import { ZERO_OFFSET } from "./universalSalvationTabletA4";

const PX_PER_MM = 3.7795275591;

export const LANDSCAPE_A4 = { widthMm: 297, heightMm: 210 } as const;
export type LandscapeDensity = "standard" | "economy";

/**
 * 密度預設：每群組寬（mm）。可用內容寬＝297-2×margin-2×edgePad＝285mm。
 * V36.12：standard 38→**每頁 7 筆**（原 33→8 筆）；群組加寬 → 主文 auto-fit 寬度上限提高 → 主文**等比例放大**。
 *   economy 25→10 筆/頁維持不變。四類牌位（祖先／乙位正魂／冤親／無緣子女）皆走 standard，一併變 7 筆/頁。
 */
const DENSITY: Record<LandscapeDensity, { groupWidthMm: number }> = {
  standard: { groupWidthMm: 38 },
  economy: { groupWidthMm: 25 },
};

const MARGIN_MM = 3;
const GROUP_GAP_MM = 3;   // 一戶與一戶之間的明顯間距（含裁切）
const EDGE_PAD_MM = 3;    // 左右兩側額外內縮，確保最右/最左群組完整、不靠裁切邊、不依賴 overflow
const NO_XXX_TOP_MM = 5;  // 頂端保留給 No.xxx 的白邊
const SAFE_GAP_MM = 4;    // 裁切安全間距：主文↔陽上人（垂直，1~3）／欄↔欄（水平，4+）。固定不被字級吃掉。

/**
 * 主文「固定安全區」——主文字級**只**由主文字數與此固定區計算，不受陽上人人數／地址長度影響，
 * 故同類型（同字數）主文字級一致（周姓/柯姓/邱姓歷代祖先皆同大小）。1~3 與 4+ 皆用同一 Wm/Hm。
 */
const MAIN_W_RATIO = 0.42;   // 主文欄寬佔群組寬（1~3 與 4+ 皆同 → 主文字級一致）
const MAIN_H_RATIO = 0.62;   // 主文安全區高佔內容高（足夠 6 字；主文靠上、下方留白）
/** 4+ 三欄時，扣除主文與 2×4mm 間距後，陽上人欄佔剩餘寬比例（其餘給地址）。 */
const YANG_REMAIN_RATIO = 0.42;

/** 陽上人達此人數（含）採「三欄」；低於此（1~3）採「主文上下組合」。 */
const YANGSHANG_THREE_COL_THRESHOLD = 4;

const MAIN_MAX_PX = 150, MAIN_MIN_PX = 22;
const ADDR_MAX_PX = 30, ADDR_MIN_PX = 10;
const YANG_MAX_PX = 34, YANG_MIN_PX = 10;
// V36.11：移除無緣子女專屬主文上限（原 190px），四類牌位主文改共用 MAIN_MAX_PX，字級一致。

type LandscapeRecordInput = TabletRecordInput & { yangshangNames?: string[] };
export type LandscapeLayoutOptions = { density?: LandscapeDensity; offset?: TabletA4Offset };

function maximizeFont(nChars: number, wMm: number, hMm: number, maxPx: number, minPx: number): { px: number; overflow: boolean } {
  const colSpacing = 1.08, lineHeight = 1.15;
  const widthCapPx = Math.max(minPx, Math.floor((wMm * PX_PER_MM) / colSpacing));
  const cfg = { maxPx: Math.min(maxPx, widthCapPx), minPx, stepPx: 2 };
  const r = fitVerticalFont(Math.max(1, nChars), wMm, hMm, cfg, { lineHeight, colSpacing });
  return { px: r.px, overflow: r.overflow };
}

/**
 * 陽上人＋叩薦＝**同一組連續文字**（正式規格）：以共用 formatYangshangAcclaim 組字
 * 「姓名、姓名、姓名叩薦」，「叩薦」緊接最後一位姓名之後，1~3 人與 4+ 皆同、絕不另起一段/一行、
 * 不獨立成區塊。無姓名時回空字串（不顯示單獨「叩薦」）。fallback（已含叩薦的文字）原樣沿用。
 */
function yangshangDisplay(names: string[] | undefined, fallbackText: string | undefined): string {
  const list = (names ?? []).map((s) => s.trim()).filter(Boolean);
  if (list.length > 0) return formatYangshangAcclaim(list); // 例："王昆郎、覺美玲叩薦"（叩薦緊接）
  const fb = (fallbackText ?? "").trim();
  return fb ? (fb.endsWith("叩薦") ? fb : fb + "叩薦") : "";
}

export function buildLandscapeTabletLayout(
  documentType: TabletDocumentType,
  records: LandscapeRecordInput[],
  options: LandscapeLayoutOptions = {}
): TabletLayout {
  const density = options.density ?? "standard";
  const offset = options.offset ?? ZERO_OFFSET;
  const contentTop = MARGIN_MM + NO_XXX_TOP_MM;
  const contentBottom = LANDSCAPE_A4.heightMm - MARGIN_MM;
  const contentH = contentBottom - contentTop;

  // 左右各留 margin + edgePad：群組只落在 [leftBound, rightBound] 內，最右/最左群組完整、不靠裁切邊。
  const leftBound = MARGIN_MM + EDGE_PAD_MM;
  const rightBound = LANDSCAPE_A4.widthMm - MARGIN_MM - EDGE_PAD_MM;
  const availW = rightBound - leftBound;
  const groupW = DENSITY[density].groupWidthMm;
  const perPage = Math.max(1, Math.floor((availW + GROUP_GAP_MM) / (groupW + GROUP_GAP_MM)));
  // 群組原點距（含間距）：讓 perPage 個群組平均填滿 availW，slot 0 最右緣＝rightBound、最左群組左緣＝leftBound。
  const stride = perPage > 1 ? (availW - groupW) / (perPage - 1) : 0;
  // V36.11：四類牌位主文共用同一字級上限（歷代祖先／乙位正魂／累世冤親債主／無緣子女一致）——
  //   移除無緣子女專屬較大上限，避免同字數主文因類別而字級不同；超出 bounding box 時仍由 auto-fit 縮小。
  const mainMax = MAIN_MAX_PX;

  const allBlocks: PositionedBlock[] = [];

  records.forEach((rec, recordIndex) => {
    const pageIndex = Math.floor(recordIndex / perPage);
    const slotIndex = recordIndex % perPage;
    const xRight = rightBound - slotIndex * stride; // slot 0 最右緣＝rightBound（完整、不裁切）
    const xLeft = xRight - groupW;

    const addrText = rec.addressText ?? "";
    // V36.11：主文先清理不可見空白／換行，再進 auto-fit——避免長度被灌水導致同字數主文被誤縮。
    const mainText = cleanTabletMainText(rec.mainText ?? "");
    const nameCount = (rec.yangshangNames?.filter((s) => s.trim()).length ?? 0) || (rec.yangshangText ? 1 : 0);
    const yangText = yangshangDisplay(rec.yangshangNames, rec.yangshangText);
    const threeCol = nameCount >= YANGSHANG_THREE_COL_THRESHOLD;

    const push = (
      blockType: PositionedBlock["blockType"], x: number, y: number, w: number, h: number, text: string,
      font: { px: number; overflow: boolean; lineHeight?: number; letterSpacingPx?: number }, vAlign: PositionedBlock["vAlign"]
    ) => {
      allBlocks.push({
        recordIndex, pageIndex, slotIndex, blockType,
        entryId: rec.entryId ?? null, registrationId: rec.registrationId ?? null,
        xMm: x + offset.offsetXmm, yMm: y + offset.offsetYmm, widthMm: w, heightMm: h,
        text, fontPx: font.px, overflow: font.overflow, vAlign,
        lineHeight: font.lineHeight, letterSpacingPx: font.letterSpacingPx,
      });
    };
    // 陽上人專用縮字（只縮陽上人：字級→字距→行距→警告；不影響主文/地址）。
    const yangCfg = { maxPx: YANG_MAX_PX, minPx: YANG_MIN_PX, stepPx: 2 };
    const fitYang = (w: number, h: number) => fitYangshangVertical(yangText.length, w, h, yangCfg);

    // 主文固定安全區（1~3 與 4+ 皆同）→ 主文字級一致、不受陽上人/地址影響。全部欄位一律頂端對齊（start）。
    const wMain = groupW * MAIN_W_RATIO;
    const hMain = contentH * MAIN_H_RATIO;
    const mainFont = maximizeFont(mainText.length, wMain, hMain, mainMax, MAIN_MIN_PX);

    if (!threeCol) {
      // 1~3 人：地址（左，滿高，頂端）｜右欄[主文(頂端，固定安全區) → 4mm 安全間距 → 陽上人(其下，頂端)]
      const wAddr = groupW - wMain - SAFE_GAP_MM;
      const xAddr = xLeft;
      const xRightCol = xLeft + wAddr + SAFE_GAP_MM;
      const yYang = contentTop + hMain + SAFE_GAP_MM; // 固定 4mm，不被字級吃掉
      const yangH = Math.max(4, contentBottom - yYang);
      push("address", xAddr, contentTop, wAddr, contentH, addrText, maximizeFont(addrText.length, wAddr, contentH, ADDR_MAX_PX, ADDR_MIN_PX), "start");
      push("main", xRightCol, contentTop, wMain, hMain, mainText, mainFont, "start");
      // 陽上人：只縮陽上人（字級→字距→行距→警告），完整放入 4mm 間距後的剩餘高度；不縮主文、不取消 4mm、不跨欄/裁字。
      push("yangshang", xRightCol, yYang, wMain, yangH, yangText, fitYang(wMain, yangH), "start");
    } else {
      // 4+ 人：三欄（右→左）主文｜陽上人｜地址，欄間固定 4mm 水平安全間距，全部頂端對齊、滿高。
      const remain = groupW - wMain - SAFE_GAP_MM * 2; // 主文＋2×4mm 之後給 陽上人＋地址
      const wYang = remain * YANG_REMAIN_RATIO;
      const wAddr = remain - wYang;
      const xAddr = xLeft;
      const xYang = xLeft + wAddr + SAFE_GAP_MM;
      const xMain = xYang + wYang + SAFE_GAP_MM;
      push("address", xAddr, contentTop, wAddr, contentH, addrText, maximizeFont(addrText.length, wAddr, contentH, ADDR_MAX_PX, ADDR_MIN_PX), "start");
      // 陽上人獨立欄：只縮陽上人（字級→字距→行距→警告）；主文/地址不受影響。
      push("yangshang", xYang, contentTop, wYang, contentH, yangText, fitYang(wYang, contentH), "start");
      push("main", xMain, contentTop, wMain, hMain, mainText, mainFont, "start");
    }
  });

  const pageMap = new Map<number, PositionedBlock[]>();
  for (const b of allBlocks) (pageMap.get(b.pageIndex) ?? pageMap.set(b.pageIndex, []).get(b.pageIndex)!).push(b);
  const pages: TabletPage[] = Array.from(pageMap.entries()).sort((a, b) => a[0] - b[0]).map(([pageIndex, blocks]) => ({ pageIndex, blocks }));

  const violations = validateLandscape(allBlocks);
  return {
    documentType, slotsPerPage: perPage, offset, pages, allBlocks,
    pageWidthMm: LANDSCAPE_A4.widthMm, pageHeightMm: LANDSCAPE_A4.heightMm, violations,
    packing: {
      source: "packed", columns: perPage, rows: 1, perPage, baseline: perPage,
      minFontPx: allBlocks.reduce((m, b) => Math.min(m, b.fontPx ?? Infinity), Infinity) || 0,
      warnings: allBlocks.some((b) => b.overflow) ? ["TEXT_OVERFLOW"] : [],
    },
  };
}

function validateLandscape(blocks: PositionedBlock[]): LayoutViolation[] {
  const v: LayoutViolation[] = [];
  const x0 = MARGIN_MM, y0 = MARGIN_MM, x1 = LANDSCAPE_A4.widthMm - MARGIN_MM, y1 = LANDSCAPE_A4.heightMm - MARGIN_MM;
  for (const b of blocks) {
    if (b.xMm < x0 - 1e-6 || b.yMm < y0 - 1e-6 || b.xMm + b.widthMm > x1 + 1e-6 || b.yMm + b.heightMm > y1 + 1e-6)
      v.push({ code: "OUT_OF_BOUNDS", detail: `rec${b.recordIndex}/${b.blockType}` });
  }
  const byPage = new Map<number, PositionedBlock[]>();
  for (const b of blocks) (byPage.get(b.pageIndex) ?? byPage.set(b.pageIndex, []).get(b.pageIndex)!).push(b);
  for (const list of byPage.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], c = list[j];
      if (a.recordIndex === c.recordIndex) continue;
      if (a.xMm < c.xMm + c.widthMm && c.xMm < a.xMm + a.widthMm && a.yMm < c.yMm + c.heightMm && c.yMm < a.yMm + a.heightMm)
        v.push({ code: "COLLISION", detail: `rec${a.recordIndex} vs rec${c.recordIndex}` });
    }
  }
  return v;
}
