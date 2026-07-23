import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  formatRocDate,
  formatRocDateCompact,
  formatIsoDateToRocCompact,
  formatLunarBirthDate,
} from "../src/lib/minguoDate";
import { ACTIVITY_GROUP_ORDER, activityGroupOrderIndex } from "../src/lib/registrationItems";

/**
 * V14.1：多項報名多選＋整批交易、年度活動固定排序、全系統民國／農曆日期顯示。
 * 不修改 V14／V13.4 既有測試語意。
 */

const ROOT = process.cwd();

// ============================================================
// 一、信眾詳情頁多選＋整批建立
// ============================================================

test("1/2. 信眾詳情頁報名改為多選 checkbox，並走整批建立 API", () => {
  const dialog = readFileSync(join(ROOT, "src/components/devotee/NewActivityRegistrationDialog.tsx"), "utf-8");
  assert.equal(dialog.includes('type="checkbox"'), true, "項目必須是 checkbox 多選");
  assert.equal(dialog.includes("/api/registrations/batch"), true, "建立走整批 API");
  // 不再是單選 selectedItemId
  assert.equal(dialog.includes("selectedItemId"), false, "不得再用單選狀態");
  // 底部確認按鈕固定（手機可按）
  assert.equal(dialog.includes("sticky bottom-0"), true);
});

test("整批 API 存在且要求 register 權限、以交易處理", () => {
  const route = join(ROOT, "src/app/api/registrations/batch/route.ts");
  assert.equal(existsSync(route), true);
  const src = readFileSync(route, "utf-8");
  assert.equal(src.includes('assertRitualRegistrationPermissionForOperator'), true);
  assert.equal(src.includes('"register"'), true);
  const svc = readFileSync(join(ROOT, "src/lib/registrationItemRegistration.ts"), "utf-8");
  const batch = svc.slice(svc.indexOf("export async function registerItemsBatch"));
  assert.equal(batch.includes("prisma.$transaction"), true, "整批必須單一交易");
  assert.equal(batch.includes("ALREADY_EXISTS"), true, "重複項目不重複建立");
  // 交易內回寫既有明細（linkedEntry）
  assert.equal(batch.includes("linkItemToExistingDetail"), true);
});

// ============================================================
// 二、年度活動固定排序：年度燈→宮慶→中元普渡→補庫
// ============================================================

test("18. 年度活動固定排序正確", () => {
  assert.deepEqual(ACTIVITY_GROUP_ORDER.slice(0, 4), [
    "ANNUAL_LANTERN",
    "TEMPLE_CELEBRATION",
    "UNIVERSAL_SALVATION",
    "STORAGE_REPAYMENT",
  ]);
  assert.equal(activityGroupOrderIndex("ANNUAL_LANTERN") < activityGroupOrderIndex("UNIVERSAL_SALVATION"), true);
  assert.equal(activityGroupOrderIndex("TEMPLE_CELEBRATION") < activityGroupOrderIndex("UNIVERSAL_SALVATION"), true);
  assert.equal(activityGroupOrderIndex("UNIVERSAL_SALVATION") < activityGroupOrderIndex("STORAGE_REPAYMENT"), true);
  // 未知分組排最後
  assert.equal(activityGroupOrderIndex("SOMETHING_ELSE"), ACTIVITY_GROUP_ORDER.length);
});

test("listActivityGroups 套用固定排序", () => {
  const src = readFileSync(join(ROOT, "src/lib/registrationItems.ts"), "utf-8");
  const fn = src.slice(src.indexOf("export async function listActivityGroups"));
  assert.equal(fn.includes("activityGroupOrderIndex"), true);
});

// ============================================================
// 三、全系統民國／農曆日期顯示
// ============================================================

test("22-1. 1960/09/25 顯示為民國49年09月25日（月日補零）", () => {
  const d = new Date(Date.UTC(1960, 8, 25));
  assert.equal(formatRocDate(d), "民國49年09月25日");
});

test("22-2. 不會顯示西元 1960", () => {
  const d = new Date(Date.UTC(1960, 8, 25));
  assert.equal(formatRocDate(d).includes("1960"), false);
  assert.equal(formatRocDateCompact(d), "民國49/09/25");
  assert.equal(formatIsoDateToRocCompact("1960-09-25"), "民國49/09/25");
  assert.equal(formatIsoDateToRocCompact("1960-09-25").includes("1960"), false);
});

test("22-3/4. 農曆年份顯示民國年、閏月正確", () => {
  // 1960 農曆 → 民國49；八月初五
  assert.equal(formatLunarBirthDate(1960, 8, 5, false), "民國49年八月初五");
  // 閏四月初五
  assert.equal(formatLunarBirthDate(1960, 4, 5, true), "民國49年閏四月初五");
  // 不含西元
  assert.equal(formatLunarBirthDate(1960, 8, 5, false).includes("1960"), false);
});

test("22-7/8. 空白不產生 Invalid Date、不完整不猜測", () => {
  assert.equal(formatRocDate(null), "");
  assert.equal(formatRocDate(undefined), "");
  assert.equal(formatRocDate(new Date(NaN)), "");
  assert.equal(formatLunarBirthDate(null, null, null, false), "");
  assert.equal(formatLunarBirthDate(1960, 13, 5, false), "");
  assert.equal(formatLunarBirthDate(1960, 8, 31, false), "");
  for (const s of ["民國49年09月25日", formatRocDateCompact(new Date(Date.UTC(1960, 8, 25)))]) {
    assert.equal(s.includes("Invalid"), false);
    assert.equal(s.includes("NaN"), false);
  }
});

test("22-9. 家戶成員卡片不再顯示西元（改用民國/農曆共用工具）", () => {
  const household = readFileSync(join(ROOT, "src/lib/household.ts"), "utf-8");
  assert.equal(household.includes("formatRocDate"), true);
  assert.equal(household.includes("formatLunarBirthDate"), true);
  // 不得再用西元的 formatSolarDate / formatLunarDate 產生卡片文字
  assert.equal(/formatSolarDate\(/.test(household), false);
  assert.equal(/formatLunarDate\(birthday\.lunar\)/.test(household), false);
  // 卡片顯示農曆與國曆（民國）標籤
  const page = readFileSync(join(ROOT, "src/app/household/[id]/page.tsx"), "utf-8");
  assert.equal(page.includes("農曆：") && page.includes("國曆："), true);
});

test("13. 年齡與生肖以實際日期計算，不受顯示格式影響（工具僅格式化，不重算歲數）", () => {
  // formatRocDate/formatLunarBirthDate 只回字串，不涉及 actualAge/nominalAge/zodiac 計算。
  const mg = readFileSync(join(ROOT, "src/lib/minguoDate.ts"), "utf-8");
  const rocFn = mg.slice(mg.indexOf("export function formatRocDate"), mg.indexOf("export function formatRocDateCompact"));
  assert.equal(/actualAge|nominalAge|zodiac/.test(rocFn), false);
});

// ============================================================
// 四、權限
// ============================================================

test("16. READONLY 禁止整批新增（後端權限 register）", () => {
  const perms = readFileSync(join(ROOT, "src/lib/permissions.ts"), "utf-8");
  const ro = perms.match(/READONLY:\s*\[([^\]]*)\]/)![1];
  assert.equal(ro.includes("register"), false);
});
