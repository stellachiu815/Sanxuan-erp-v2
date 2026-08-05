import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cleanTabletMainText,
  tabletMainCharCount,
  fitV34MainSizeMm,
  TABLET_MAIN_FIT,
} from "../src/components/ritual/tablets/tabletMainTextFit";

/** V36.11：普渡列印名單統一 + V34 牌位主文字級統一。 */

// ── 一、主文字串清理（不可見空白／換行不得灌水字數） ──
test("cleanTabletMainText 移除首尾空白、換行、zero-width、全形空白、NBSP", () => {
  assert.equal(cleanTabletMainText("  陳永成乙位正魂  "), "陳永成乙位正魂");
  assert.equal(cleanTabletMainText("陳永成乙位正魂\n"), "陳永成乙位正魂");
  assert.equal(cleanTabletMainText("陳永成​乙位正魂"), "陳永成乙位正魂"); // zero-width
  assert.equal(cleanTabletMainText("彭江河　乙位正魂"), "彭江河乙位正魂");   // 全形空白
  assert.equal(cleanTabletMainText("彭江河 乙位正魂"), "彭江河乙位正魂");   // NBSP
  assert.equal(cleanTabletMainText("累世冤親債主"), "累世冤親債主");
  assert.equal(cleanTabletMainText(null), "");
});

test("清理後字數＝實際可見字數（不被隱藏字元灌水）", () => {
  assert.equal(tabletMainCharCount("陳永成乙位正魂"), 7);
  assert.equal(tabletMainCharCount("陳永成乙位正魂 "), 7);
  assert.equal(tabletMainCharCount("陳永成​乙位正魂\n"), 7);
});

// ── 二、四類共用同一套字級；相同字數 → 相同字級 ──
test("彭江河乙位正魂 / 陳永成乙位正魂 與其他同長度乙位正魂字級一致", () => {
  const names = ["彭江河乙位正魂", "陳永成乙位正魂", "王小明乙位正魂", "林淑芬乙位正魂"];
  const sizes = names.map((n) => fitV34MainSizeMm(tabletMainCharCount(n)));
  assert.ok(sizes.every((s) => s === sizes[0]), `同長度字級應一致，得 ${sizes.join(",")}`);
  assert.equal(sizes[0], TABLET_MAIN_FIT.baseSizeMm); // 7 字 ≤ 門檻 → 基準字級
});

test("夾帶不可見空白／換行的名稱與乾淨名稱字級一致（不誤縮）", () => {
  const clean = fitV34MainSizeMm(tabletMainCharCount("陳永成乙位正魂"));
  const dirty = fitV34MainSizeMm(tabletMainCharCount("陳永成​乙位正魂 \n"));
  assert.equal(dirty, clean);
});

test("四類（祖先/乙位/冤親/無緣）主文字級規則不分類別——同字數同字級", () => {
  // fitV34MainSizeMm 不接受 category 參數：相同字數必得相同字級。
  const soul = fitV34MainSizeMm(tabletMainCharCount("陳永成乙位正魂"));       // 7
  const creditor = fitV34MainSizeMm(tabletMainCharCount("累世冤親債主"));      // 6
  const ancestor = fitV34MainSizeMm(tabletMainCharCount("王姓歷代祖先"));      // 6
  assert.equal(creditor, ancestor); // 同 6 字
  assert.equal(soul, TABLET_MAIN_FIT.baseSizeMm);
});

// ── 三、只有超出 bounding box（門檻）才縮小；夾在 minSize ──
test("字數 ≤ 門檻不縮；超出才等比縮小、夾在最小字級、單調不遞增", () => {
  assert.equal(fitV34MainSizeMm(TABLET_MAIN_FIT.autoFitThreshold), TABLET_MAIN_FIT.baseSizeMm);
  const big = fitV34MainSizeMm(TABLET_MAIN_FIT.autoFitThreshold + 1);
  assert.ok(big < TABLET_MAIN_FIT.baseSizeMm, "超出門檻應縮小");
  assert.ok(fitV34MainSizeMm(60) >= TABLET_MAIN_FIT.minSizeMm, "不得小於最小字級");
  for (let n = 1; n < 50; n++) assert.ok(fitV34MainSizeMm(n) >= fitV34MainSizeMm(n + 1), "字級隨字數單調不遞增");
});

// ── 四、程式碼接線靜態驗證 ──
const printDocs = readFileSync(new URL("../src/lib/printDocuments.ts", import.meta.url), "utf8");
const landscape = readFileSync(new URL("../src/components/ritual/tablets/landscapeLayout.ts", import.meta.url), "utf8");
const shared = readFileSync(new URL("../src/components/ritual/tablets/shared.ts", import.meta.url), "utf8");
const v34 = readFileSync(new URL("../src/components/universal-salvation/v34/TabletLandscapeSheetV34.tsx", import.meta.url), "utf8");

test("listPrintCenterItems：普渡列印物件 key 走 listPrintItemsForPrintCenter（唯一來源），非列印物件才走 CONFIRMED", () => {
  assert.ok(printDocs.includes("US_PRINTOBJECT_KEYS"), "定義普渡列印物件 key 集合");
  assert.ok(printDocs.includes("listUniversalSalvationPrintObjectRows"), "普渡列印物件名單來源函式");
  assert.ok(/listUniversalSalvationPrintObjectRows[\s\S]*?listPrintItemsForPrintCenter\(f\.year/.test(printDocs), "普渡來源＝V34 同一支查詢");
  assert.ok(/registrationItemType:\s*\{\s*key:\s*\{\s*notIn:\s*\[\.\.\.US_PRINTOBJECT_KEYS\]/.test(printDocs), "全部項目時 CONFIRMED 查詢排除普渡列印物件 key，避免重複");
});

test("V34／mm 版型：主文清理 + 四類共用字級", () => {
  assert.ok(shared.includes("cleanTabletMainText(displayDebtCreditorName"), "toPrintableTablet 主文已清理");
  assert.ok(landscape.includes("cleanTabletMainText(rec.mainText"), "mm 版型主文先清理再 auto-fit");
  assert.ok(/const mainMax = MAIN_MAX_PX;/.test(landscape), "四類共用同一主文字級上限（移除無緣子女專屬上限）");
  assert.ok(v34.includes("fitV34MainSizeMm"), "V34 主文套用共用字級規則");
  assert.ok(v34.includes('documentType !== "POCKET"'), "寶袋維持原字級、不套用牌位規則");
});
