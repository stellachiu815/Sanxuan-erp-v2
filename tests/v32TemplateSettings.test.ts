import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultTemplateSetting,
  mergeTemplateSetting,
  sanitizeTemplateInput,
  TEMPLATE_DOC_TYPES,
} from "../src/lib/tabletTemplateSettingsShape";

/** V32 §4 列印模板設定：預設值、合併（缺列回預設）、清理夾範圍。 */

test("五種模板類型齊備", () => {
  assert.deepEqual(
    TEMPLATE_DOC_TYPES.map((t) => t.docType).sort(),
    ["ANCESTOR_LINE", "DEBT_CREDITOR", "INDIVIDUAL_SOUL", "POCKET", "UNBORN_CHILD"]
  );
});

test("預設：offset 0、行距 1.15、顯示作業號碼、不最高密度", () => {
  const d = defaultTemplateSetting("ANCESTOR_LINE");
  assert.equal(d.offsetXmm, 0);
  assert.equal(d.lineHeight, 1.15);
  assert.equal(d.showWorkNumber, true);
  assert.equal(d.maximize, false);
  assert.equal(d.fontFamily, null);
});

test("mergeTemplateSetting：DB 缺列→全預設；部分列→覆蓋、其餘保留預設", () => {
  assert.deepEqual(mergeTemplateSetting("POCKET", null), defaultTemplateSetting("POCKET"));
  const merged = mergeTemplateSetting("POCKET", { offsetXmm: 2, maximize: true });
  assert.equal(merged.offsetXmm, 2);
  assert.equal(merged.maximize, true);
  assert.equal(merged.lineHeight, 1.15); // 未提供→預設
  assert.equal(merged.documentType, "POCKET");
});

test("sanitize：offset/字距/行距夾在安全範圍；空字串→null", () => {
  const s = sanitizeTemplateInput({ offsetXmm: 999, offsetYmm: -999, letterSpacingPx: 100, lineHeight: 9, fontFamily: "  ", defaultMainText: "本宅地基主" });
  assert.equal(s.offsetXmm, 50);
  assert.equal(s.offsetYmm, -50);
  assert.equal(s.letterSpacingPx, 20);
  assert.equal(s.lineHeight, 2);
  assert.equal(s.fontFamily, null);
  assert.equal(s.defaultMainText, "本宅地基主");
});
