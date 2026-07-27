import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tabletIdentityKey, normalizeTabletText, isSameTablet } from "../src/lib/tabletIdentity";

/**
 * V15R6 普渡報名流程整合——純函式單元測試 + 來源掃描（不需 DB）。
 */

// ── 一、tabletIdentity 純函式：per-tablet 冪等鍵 ──
test("normalizeTabletText：全形/空白正規化", () => {
  assert.equal(normalizeTabletText("　陳　家 "), "陳家");
  assert.equal(normalizeTabletText(null), "");
  assert.equal(normalizeTabletText("ＡＢＣ"), "ABC");
});

test("同 category＋同名＋同地址 → 同一把冪等鍵（返回重進不增筆）", () => {
  const a = tabletIdentityKey({ category: "INDIVIDUAL_SOUL", displayName: "陳大明", tabletAddress: "台北市中山路1號" });
  const b = tabletIdentityKey({ category: "INDIVIDUAL_SOUL", displayName: " 陳大明 ", tabletAddress: "台北市中山路1號" });
  assert.equal(a, b);
});

test("同名但地址不同 → 不同鍵（同名不同牌位不得合併）", () => {
  const a = tabletIdentityKey({ category: "INDIVIDUAL_SOUL", displayName: "陳大明", tabletAddress: "台北市中山路1號" });
  const b = tabletIdentityKey({ category: "INDIVIDUAL_SOUL", displayName: "陳大明", tabletAddress: "新北市板橋區2號" });
  assert.notEqual(a, b);
  assert.equal(isSameTablet(
    { category: "INDIVIDUAL_SOUL", displayName: "陳大明", tabletAddress: "台北市中山路1號" },
    { category: "INDIVIDUAL_SOUL", displayName: "陳大明", tabletAddress: "新北市板橋區2號" }
  ), false);
});

test("不同 category → 不同鍵", () => {
  const a = tabletIdentityKey({ category: "ANCESTOR_LINE", displayName: "陳家歷代祖先", tabletAddress: null });
  const b = tabletIdentityKey({ category: "INDIVIDUAL_SOUL", displayName: "陳家歷代祖先", tabletAddress: null });
  assert.notEqual(a, b);
});

test("有 sourceId → 以 sourceId 為最優先鍵", () => {
  const k = tabletIdentityKey({ category: "ANCESTOR_LINE", displayName: "x", tabletAddress: "y", sourceId: "wr123" });
  assert.ok(k.includes("src:wr123"));
});

// ── 二、來源掃描：確保實作走既有架構且符合規格 ──
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("householdRegistrationOptions：以牌位(名+址)合併、WorshipOption 帶 sourceId", () => {
  const src = read("src/lib/householdRegistrationOptions.ts");
  assert.ok(src.includes("mergeByTablet"), "改用 mergeByTablet");
  assert.ok(/sourceId/.test(src), "WorshipOption 帶 sourceId");
  assert.ok(!src.includes("mergeByDisplayName"), "不再用只看姓名的合併");
});

test("registrationItemRegistration：auto-draft 逐既有牌位 fan-out＋tabletIdentityKey 冪等", () => {
  const src = read("src/lib/registrationItemRegistration.ts");
  const block = src.slice(src.indexOf("AUTO_DRAFT_TABLET_KEYS.has(p.itemType.key)"));
  assert.ok(block.includes("tabletIdentityKey"), "以 per-tablet 冪等鍵判斷");
  assert.ok(/for \(const t of targets\)/.test(block), "逐既有牌位建立（非只帶第一筆）");
  // 不再只用 category findFirst 當唯一存在判斷。
  assert.ok(!/const existingEntry = await tx\.universalSalvationEntry\.findFirst\(\{\s*where: \{ category, deletedAt: null, universalSalvation: \{ ritualRecordId: recordId \} \},\s*select: \{ registrationItem/.test(block), "不再只用 category findFirst 判存在");
});

test("batch 送出仍走既有 /api/registrations/batch（不建第二套 API）", () => {
  const picker = read("src/components/ritual/HouseholdUniversalSalvationPicker.tsx");
  assert.ok(picker.includes("/api/registrations/batch"), "picker 送出走既有 batch");
  assert.ok(!/\/api\/households\/.+\/universal-salvation-batch-create/.test(picker), "沒有第二套建立 API");
});

test("家戶合併 picker＋按鈕＋讀取端點存在，家戶頁已掛入", () => {
  assert.ok(read("src/components/ritual/HouseholdUniversalSalvationPicker.tsx").length > 0);
  assert.ok(read("src/components/ritual/HouseholdUniversalSalvationButton.tsx").length > 0);
  assert.ok(read("src/app/api/households/[id]/universal-salvation-batch-options/route.ts").length > 0);
  assert.ok(read("src/app/household/[id]/page.tsx").includes("HouseholdUniversalSalvationButton"), "家戶頁掛入按鈕");
});

test("EntryRow：逐筆清楚提示尚缺欄位", () => {
  const src = read("src/components/ritual/EntryRow.tsx");
  assert.ok(src.includes("尚缺"), "顯示尚缺欄位提示");
  assert.ok(src.includes("牌位姓名"), "缺牌位姓名");
});

test("財務隔離：批次建立一律 amountPaid: 0，不建收款交易", () => {
  const src = read("src/lib/registrationItemRegistration.ts");
  assert.ok(src.includes("amountPaid: 0"), "建立時 amountPaid 固定 0");
});
