import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePersonSheet } from "../src/lib/devoteeImportPersonSheet";
import { lunarToSolar } from "../src/lib/lunar";
import { CORRECTABLE_FIELDS } from "../src/lib/devoteeImportFieldDiff";

/**
 * V29：正式信眾 Excel 農曆生日格式（090/01/27(吉)(辛巳)…）解析驗證。
 * 皆為純函式（parsePersonSheet／lunarToSolar），沙盒可跑，不需 DB。
 */

function parseOne(lunarCell: string) {
  const rows = parsePersonSheet([{ "姓名": "王小明", "農曆生日": lunarCell }]);
  return rows[0];
}

test("090/01/27(吉)(辛巳) → 民國90(西元2001) 農曆 1/27，忽略吉凶干支", () => {
  const p = parseOne("090/01/27(吉)(辛巳)");
  assert.equal(p.lunarBirthYear, 2001, "民國90＝西元2001，不得當西元90");
  assert.equal(p.lunarBirthMonth, 1);
  assert.equal(p.lunarBirthDay, 27);
  assert.equal(p.lunarIsLeapMonth, false);
  assert.deepEqual(p.formatErrors, [], "不應有格式錯誤");
});

test("全形括號可解析：090/01/27（吉）（辛巳）", () => {
  const p = parseOne("090/01/27（吉）（辛巳）");
  assert.equal(p.lunarBirthYear, 2001);
  assert.equal(p.lunarBirthMonth, 1);
  assert.equal(p.lunarBirthDay, 27);
});

test("無括號純日期可解析：089/11/23", () => {
  const p = parseOne("089/11/23");
  assert.equal(p.lunarBirthYear, 2000); // 民國89＝西元2000
  assert.equal(p.lunarBirthMonth, 11);
  assert.equal(p.lunarBirthDay, 23);
});

test("前後空白可解析：  077/12/21(吉)(戊辰)  ", () => {
  const p = parseOne("  077/12/21(吉)(戊辰)  ");
  assert.equal(p.lunarBirthYear, 1988); // 民國77＝西元1988
  assert.equal(p.lunarBirthMonth, 12);
  assert.equal(p.lunarBirthDay, 21);
});

test("破折號舊格式仍相容：46-4-17（閏）", () => {
  const p = parseOne("46-4-17（閏）");
  assert.equal(p.lunarBirthYear, 1957); // 民國46＝西元1957
  assert.equal(p.lunarBirthMonth, 4);
  assert.equal(p.lunarBirthDay, 17);
  assert.equal(p.lunarIsLeapMonth, true, "含「閏」→ 閏月");
});

test("無效日期不寫入、不猜測：090/13/40(吉)", () => {
  const p = parseOne("090/13/40(吉)");
  assert.equal(p.lunarBirthYear, null);
  assert.equal(p.lunarBirthMonth, null);
  assert.equal(p.lunarBirthDay, null);
  assert.ok(p.formatErrors.length > 0, "應記錄解析錯誤原因");
});

test("完全看不懂的字串 → 錯誤、不寫入", () => {
  const p = parseOne("（辛巳年）");
  assert.equal(p.lunarBirthYear, null);
  assert.ok(p.formatErrors.length > 0);
});

test("解析成功後可用既有 lunarToSolar() 換算國曆生日", () => {
  const p = parseOne("090/01/27(吉)(辛巳)");
  const solar = lunarToSolar(p.lunarBirthYear!, p.lunarBirthMonth!, p.lunarBirthDay!, p.lunarIsLeapMonth);
  // 農曆 2001-01-27 → 國曆 2001-02-19（既有工具換算）。
  assert.equal(
    `${solar.getUTCFullYear()}-${String(solar.getUTCMonth() + 1).padStart(2, "0")}-${String(solar.getUTCDate()).padStart(2, "0")}`,
    "2001-02-19"
  );
});

test("年齡與生肖不是可校正欄位（永不寫入 patch）", () => {
  assert.ok(!CORRECTABLE_FIELDS.includes("age" as never));
  assert.ok(!CORRECTABLE_FIELDS.includes("zodiac" as never));
});
