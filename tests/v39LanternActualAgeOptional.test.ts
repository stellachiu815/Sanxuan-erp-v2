import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildActivityYearPrintProfile,
  ACTUAL_AGE_MISSING_ISSUE,
} from "../src/lib/zodiacSexagenary";

/**
 * V39 修正：燈牌不印實歲，所以「活動日期未設定→算不出實歲」不該擋下燈牌列印。
 * 這裡驗證：資料齊全但沒設活動日期時，排除該柔性提醒後就沒有阻擋問題（可列印）；
 * 但真正的資料缺漏（如缺出生年份）仍會阻擋。
 */

test("缺活動日期(實歲)屬非阻擋：排除後可列印，虛歲仍算得出", () => {
  const p = buildActivityYearPrintProfile({
    activityMinguoYear: 116,
    birthLunarYearAD: 1971, // 有出生年 → 虛歲／生肖／太歲可算
    solarBirthDate: new Date(Date.UTC(1971, 6, 18)),
    gender: "女",
    referenceDate: null, // 沒設活動日期
  });
  assert.ok(p.issues.includes(ACTUAL_AGE_MISSING_ISSUE), "有缺實歲的柔性提醒");
  const blocking = p.issues.filter((i) => i !== ACTUAL_AGE_MISSING_ISSUE);
  assert.equal(blocking.length, 0, "排除非阻擋提醒後無其他阻擋問題（可列印）");
  assert.ok(p.nominalAge !== null, "虛歲仍算得出");
});

test("缺出生年份仍真的阻擋（不在非阻擋名單內）", () => {
  const p = buildActivityYearPrintProfile({
    activityMinguoYear: 116,
    birthLunarYearAD: null,
    solarBirthDate: null,
    gender: "女",
    referenceDate: null,
  });
  const blocking = p.issues.filter((i) => i !== ACTUAL_AGE_MISSING_ISSUE);
  assert.ok(blocking.length > 0, "缺出生年份 → 仍有阻擋問題，不可列印");
});
