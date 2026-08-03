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

import { fitVerticalFont } from "./fontFit";
import { formatYangshangAcclaim } from "@/lib/yangshang";
import type {
  TabletDocumentType, TabletA4Offset, PositionedBlock, TabletPage, TabletLayout, TabletRecordInput, LayoutViolation,
} from "./universalSalvationTabletA4";
import { ZERO_OFFSET } from "./universalSalvationTabletA4";

const PX_PER_MM = 3.7795275591;

export const LANDSCAPE_A4 = { widthMm: 297, heightMm: 210 } as const;
export type LandscapeDensity = "standard" | "economy";

/** 密度預設：每群組寬（mm）。可用寬 291、群組間距 3：perPage=floor((291+3)/(gw+3))。
 *  standard 33→8 筆/頁（附件一）；economy 26→10 筆/頁（省紙）。 */
const DENSITY: Record<LandscapeDensity, { groupWidthMm: number }> = {
  standard: { groupWidthMm: 33 },
  economy: { groupWidthMm: 26 },
};

const MARGIN_MM = 3;
const GROUP_GAP_MM = 3;   // 一戶與一戶之間的明顯間距（含裁切）
const NO_XXX_TOP_MM = 5;  // 頂端保留給 No.xxx 的白邊
const COL_GAP_MM = 1;     // 群組內欄間距（緊密）

/** 三欄模式（4+）欄寬佔比。 */
const MAIN_W_RATIO = 0.52;   // 主文欄（右，最寬＝最大字）
const YANG_W_RATIO = 0.22;   // 陽上人欄（中，獨立直欄，容多位）
// 地址欄＝其餘（左）。

/** 陽上人達此人數（含）採「三欄」；低於此（1~3）採「主文上下組合」。 */
const YANGSHANG_THREE_COL_THRESHOLD = 4;
/** 1~3 人（上下組合）時主文佔上半比例（主文優先最大；陽上人置其下）。 */
const MAIN_TOP_RATIO_WHEN_STACK = 0.72;
/** 上下組合時地址獨立欄寬佔比（左）。 */
const STACK_ADDR_W_RATIO = 0.30;

const MAIN_MAX_PX = 150, MAIN_MIN_PX = 22;
const ADDR_MAX_PX = 30, ADDR_MIN_PX = 10;
const YANG_MAX_PX = 34, YANG_MIN_PX = 10;
const UNBORN_MAIN_MAX_PX = 190;

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
  const usableW = LANDSCAPE_A4.widthMm - MARGIN_MM * 2;
  const contentTop = MARGIN_MM + NO_XXX_TOP_MM;
  const contentBottom = LANDSCAPE_A4.heightMm - MARGIN_MM;
  const contentH = contentBottom - contentTop;

  const gw0 = DENSITY[density].groupWidthMm;
  const perPage = Math.max(1, Math.floor((usableW + GROUP_GAP_MM) / (gw0 + GROUP_GAP_MM)));
  const stride = usableW / perPage;
  const groupW = stride - GROUP_GAP_MM;
  const mainMax = documentType === "UNBORN_CHILD" ? UNBORN_MAIN_MAX_PX : MAIN_MAX_PX;

  const allBlocks: PositionedBlock[] = [];

  records.forEach((rec, recordIndex) => {
    const pageIndex = Math.floor(recordIndex / perPage);
    const slotIndex = recordIndex % perPage;
    const xRight = MARGIN_MM + usableW - slotIndex * stride; // slot 0 最右
    const xLeft = xRight - groupW;

    const addrText = rec.addressText ?? "";
    const mainText = rec.mainText ?? "";
    const nameCount = (rec.yangshangNames?.filter((s) => s.trim()).length ?? 0) || (rec.yangshangText ? 1 : 0);
    const yangText = yangshangDisplay(rec.yangshangNames, rec.yangshangText);
    const threeCol = nameCount >= YANGSHANG_THREE_COL_THRESHOLD;

    const push = (
      blockType: PositionedBlock["blockType"], x: number, y: number, w: number, h: number, text: string,
      font: { px: number; overflow: boolean }, vAlign: PositionedBlock["vAlign"]
    ) => {
      allBlocks.push({
        recordIndex, pageIndex, slotIndex, blockType,
        entryId: rec.entryId ?? null, registrationId: rec.registrationId ?? null,
        xMm: x + offset.offsetXmm, yMm: y + offset.offsetYmm, widthMm: w, heightMm: h,
        text, fontPx: font.px, overflow: font.overflow, vAlign,
      });
    };

    // 地址欄（左，滿高）永遠獨立一欄。
    if (!threeCol) {
      // 1~3 人：主文上下組合——地址（左，滿高）｜[主文(上，最大) + 陽上人(下)]（右欄）
      const wAddr = Math.max(6, groupW * STACK_ADDR_W_RATIO);
      const wRight = groupW - wAddr - COL_GAP_MM;
      const xAddr = xLeft;
      const xRightCol = xLeft + wAddr + COL_GAP_MM;
      const mainH = contentH * MAIN_TOP_RATIO_WHEN_STACK;
      const gapV = 3;
      const yYang = contentTop + mainH + gapV;
      const yangH = contentBottom - yYang;
      push("address", xAddr, contentTop, wAddr, contentH, addrText, maximizeFont(addrText.length, wAddr, contentH, ADDR_MAX_PX, ADDR_MIN_PX), "start");
      push("main", xRightCol, contentTop, wRight, mainH, mainText, maximizeFont(mainText.length, wRight, mainH, mainMax, MAIN_MIN_PX), "center");
      push("yangshang", xRightCol, yYang, wRight, yangH, yangText, maximizeFont(yangText.length, wRight, yangH, YANG_MAX_PX, YANG_MIN_PX), "center");
    } else {
      // 4+ 人：三欄——右→左 主文（滿高，不縮小）｜陽上人（獨立直欄，滿高、容多位）｜地址（左，滿高）
      const wMain = groupW * MAIN_W_RATIO;
      const wYang = groupW * YANG_W_RATIO;
      const wAddr = Math.max(6, groupW - wMain - wYang - COL_GAP_MM * 2);
      const xAddr = xLeft;
      const xYang = xLeft + wAddr + COL_GAP_MM;
      const xMain = xYang + wYang + COL_GAP_MM;
      push("address", xAddr, contentTop, wAddr, contentH, addrText, maximizeFont(addrText.length, wAddr, contentH, ADDR_MAX_PX, ADDR_MIN_PX), "start");
      push("yangshang", xYang, contentTop, wYang, contentH, yangText, maximizeFont(yangText.length, wYang, contentH, YANG_MAX_PX, YANG_MIN_PX), "start");
      push("main", xMain, contentTop, wMain, contentH, mainText, maximizeFont(mainText.length, wMain, contentH, mainMax, MAIN_MIN_PX), "center");
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
