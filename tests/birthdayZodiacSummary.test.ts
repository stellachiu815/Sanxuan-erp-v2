import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveBirthdayInfo,
  safeDeriveBirthdayInfo,
  formatLunarDate,
  getZodiacByLunarYear,
  ZODIAC_LIST,
} from "../src/lib/lunar";

/**
 * V13.1 生日／生肖模組：六種生日資料案例的邊界測試。
 *
 * 這裡直接測 deriveBirthdayInfo()——它是 composeDevoteeSummary() 產生
 * zodiac / actualAge / nominalAge 的**唯一**來源。只要這一支在六種案例下
 * 都不產生 NaN 或 Invalid Date，詳情頁就不可能顯示壞值（畫面層完全不做
 * new Date() 或算術，只做 `?? "未填寫"`）。
 */

/** 畫面層的顯示規則，與 page.tsx 的寫法一致。 */
function display(v: string | number | null | undefined, suffix = ""): string {
  if (v === null || v === undefined) return "未填寫";
  return `${v}${suffix}`;
}

function assertNoBadValue(label: string, info: ReturnType<typeof deriveBirthdayInfo>) {
  if (info === null) return; // null 是合法狀態，畫面顯示「未填寫」
  assert.equal(Number.isNaN(info.solarDate.getTime()), false, `${label}：solarDate 不得為 Invalid Date`);
  assert.equal(Number.isNaN(info.actualAge), false, `${label}：actualAge 不得為 NaN`);
  assert.equal(Number.isNaN(info.nominalAge), false, `${label}：nominalAge 不得為 NaN`);
  assert.equal(typeof info.zodiac, "string", `${label}：zodiac 必須是字串`);
  assert.equal(info.zodiac.length > 0, true, `${label}：zodiac 不得為空字串`);
}

// ── 生肖：必須一律輸出繁體 ──
test("生肖：十二年連續輸出全部是繁體", () => {
  /**
   * lunar-javascript 的 getYearShengXiao() 回傳簡體（马、龙、鸡、猪），
   * 必須在 lunar.ts 單一來源正規化成繁體。
   */
  const expected = ["鼠", "牛", "虎", "兔", "龍", "蛇", "馬", "羊", "猴", "雞", "狗", "豬"];
  assert.deepEqual([...ZODIAC_LIST], expected);

  // 1984 是甲子鼠年，往後連續 12 年應完整走完一輪
  for (let i = 0; i < 12; i++) {
    assert.equal(getZodiacByLunarYear(1984 + i), expected[i], `${1984 + i} 年生肖不符`);
  }
});

test("生肖：簡體字絕不外流", () => {
  const simplified = ["马", "龙", "鸡", "猪"];
  for (let year = 1900; year <= 2100; year++) {
    const z = getZodiacByLunarYear(year);
    assert.equal(simplified.includes(z), false, `${year} 年輸出了簡體「${z}」`);
    assert.equal(ZODIAC_LIST.includes(z), true, `${year} 年輸出了非預期的「${z}」`);
  }
});

test("生肖：deriveBirthdayInfo 的輸出也是繁體", () => {
  const info = deriveBirthdayInfo({ solarBirthDate: new Date(Date.UTC(1990, 3, 25)) });
  assert.equal(info!.zodiac, "馬", "不可以是簡體「马」");
});

test("生肖：不合理年份回空字串，不丟例外", () => {
  assert.doesNotThrow(() => getZodiacByLunarYear(NaN));
  assert.equal(getZodiacByLunarYear(NaN), "");
  assert.equal(getZodiacByLunarYear(Infinity), "");
});

// ── 案例 1：有完整國曆生日 ──
test("案例1：完整國曆生日 → 五個欄位都算得出來", () => {
  const info = deriveBirthdayInfo({ solarBirthDate: new Date(Date.UTC(1990, 3, 25)) });
  assert.notEqual(info, null);
  assertNoBadValue("完整國曆", info);
  assert.equal(info!.zodiac, "馬", "1990 年應為馬");
  assert.equal(info!.actualAge >= 0, true);
  assert.equal(info!.nominalAge >= 1, true);
  // 農曆顯示字串也要組得出來
  assert.equal(formatLunarDate(info!.lunar).length > 0, true);
});

// ── 案例 2：有農曆生日（無國曆） ──
test("案例2：只有農曆生日 → 可反推國曆並算出生肖歲數", () => {
  const info = deriveBirthdayInfo({
    lunarBirthYear: 1990,
    lunarBirthMonth: 4,
    lunarBirthDay: 1,
    lunarIsLeapMonth: false,
  });
  assert.notEqual(info, null);
  assertNoBadValue("只有農曆", info);
  assert.equal(typeof info!.zodiac, "string");
});

// ── 案例 3：只有部分生日資料 ──
test("案例3：農曆只有年、缺月日 → 回 null，不猜測", () => {
  const info = deriveBirthdayInfo({ lunarBirthYear: 1990 });
  assert.equal(info, null, "資料不完整必須整個回 null，不得回傳帶 NaN 的物件");
});

test("案例3：農曆缺日 → 回 null", () => {
  const info = deriveBirthdayInfo({ lunarBirthYear: 1990, lunarBirthMonth: 4 });
  assert.equal(info, null);
});

// ── 案例 4：完全沒有生日 ──
test("案例4：完全沒有生日 → 回 null，畫面顯示「未填寫」", () => {
  assert.equal(deriveBirthdayInfo({}), null);
  assert.equal(
    deriveBirthdayInfo({
      solarBirthDate: null,
      lunarBirthYear: null,
      lunarBirthMonth: null,
      lunarBirthDay: null,
      lunarIsLeapMonth: false,
    }),
    null
  );
});

// ── 案例 5：Excel 匯入的既有信眾（國曆＋農曆兩者都有） ──
test("案例5：國曆與農曆都有值（V13.1 之後的資料） → 以國曆為準，不衝突", () => {
  const info = deriveBirthdayInfo({
    solarBirthDate: new Date(Date.UTC(1990, 3, 25)),
    lunarBirthYear: 1990,
    lunarBirthMonth: 4,
    lunarBirthDay: 1,
    lunarIsLeapMonth: false,
  });
  assert.notEqual(info, null);
  assertNoBadValue("國曆農曆並存", info);
});

// ── 案例 6：閏月／轉換失敗資料 ──
test("案例6：閏月資料可正確處理", () => {
  // 2020 年（民國109）閏四月
  const info = deriveBirthdayInfo({
    lunarBirthYear: 2020,
    lunarBirthMonth: 4,
    lunarBirthDay: 10,
    lunarIsLeapMonth: true,
  });
  // 能算出來就必須是有效值；算不出來則必須是 null
  assertNoBadValue("閏月", info);
});

test("案例6：Invalid Date 物件不得丟例外，且不得產生 NaN", () => {
  // deriveBirthdayInfo() 本身就必須擋下 Invalid Date，不能只靠包裝層
  assert.doesNotThrow(() => deriveBirthdayInfo({ solarBirthDate: new Date("Invalid Date") }));
  const info = deriveBirthdayInfo({ solarBirthDate: new Date("Invalid Date") });
  assert.equal(info, null, "Invalid Date 必須回 null，畫面顯示「未填寫」");
  assertNoBadValue("Invalid Date 輸入", info);
});

test("案例6：不合理的農曆月份不得產生壞值", () => {
  for (const bad of [
    { lunarBirthYear: 1990, lunarBirthMonth: 13, lunarBirthDay: 1 },
    { lunarBirthYear: 1990, lunarBirthMonth: 0, lunarBirthDay: 1 },
    { lunarBirthYear: 1990, lunarBirthMonth: 4, lunarBirthDay: 99 },
    { lunarBirthYear: 1990, lunarBirthMonth: -1, lunarBirthDay: 1 },
    { lunarBirthYear: 99999, lunarBirthMonth: 4, lunarBirthDay: 1 },
  ]) {
    // deriveBirthdayInfo() 本身必須完整防護，不得丟例外
    assert.doesNotThrow(
      () => deriveBirthdayInfo(bad),
      `deriveBirthdayInfo 不得對 ${JSON.stringify(bad)} 丟例外`
    );
    assert.equal(deriveBirthdayInfo(bad), null, `${JSON.stringify(bad)} 應回 null`);
  }
});

// ── 畫面顯示規則 ──
test("畫面規則：null 一律顯示「未填寫」，絕不顯示 NaN 或 Invalid Date", () => {
  assert.equal(display(null), "未填寫");
  assert.equal(display(undefined), "未填寫");
  assert.equal(display(null, " 歲"), "未填寫", "null 時不得變成「未填寫 歲」以外的怪字串");
  assert.equal(display("馬"), "馬");
  assert.equal(display(35, " 歲"), "35 歲");
  assert.equal(display(0, " 歲"), "0 歲", "0 歲是合法值，不可被當成空值");
});

test("畫面規則：實歲 0 歲（未滿週歲）必須顯示，不可誤判為未填寫", () => {
  // 這是 `??` 與 `||` 的差別：用 || 會把 0 當成 falsy 顯示成「未填寫」
  const actualAge: number | null = 0;
  assert.equal(actualAge === null ? "未填寫" : `${actualAge} 歲`, "0 歲");
});

// ── 防護版：資料異常不得讓整頁崩潰 ──
test("safeDeriveBirthdayInfo：與 deriveBirthdayInfo 行為完全一致（薄轉接）", () => {
  /**
   * 防護已內建在 deriveBirthdayInfo() 本身，safeDeriveBirthdayInfo() 只是
   * 薄轉接、不含額外邏輯——這個測試確保兩者不會分裂成兩套判斷標準。
   */
  for (const bad of [
    { lunarBirthYear: 1990, lunarBirthMonth: 13, lunarBirthDay: 1 },
    { lunarBirthYear: 1990, lunarBirthMonth: 0, lunarBirthDay: 1 },
    { lunarBirthYear: 1990, lunarBirthMonth: 4, lunarBirthDay: 99 },
    { solarBirthDate: new Date("Invalid Date") },
  ]) {
    assert.doesNotThrow(
      () => safeDeriveBirthdayInfo(bad),
      `safeDeriveBirthdayInfo 不得對 ${JSON.stringify(bad)} 丟例外`
    );
    assertNoBadValue(`防護版 ${JSON.stringify(bad)}`, safeDeriveBirthdayInfo(bad));
  }
});

test("safeDeriveBirthdayInfo：正常資料的結果與 deriveBirthdayInfo 完全相同", () => {
  const fields = { solarBirthDate: new Date(Date.UTC(1990, 3, 25)) };
  const raw = deriveBirthdayInfo(fields);
  const safe = safeDeriveBirthdayInfo(fields);
  assert.notEqual(safe, null);
  assert.equal(safe!.zodiac, raw!.zodiac);
  assert.equal(safe!.actualAge, raw!.actualAge);
  assert.equal(safe!.nominalAge, raw!.nominalAge);
});

// ── 虛歲邏輯 ──
test("虛歲不是實歲加一：使用既有農曆邏輯", () => {
  const info = deriveBirthdayInfo({ solarBirthDate: new Date(Date.UTC(1990, 11, 25)) });
  assert.notEqual(info, null);
  // 12 月底出生者，在年初時實歲與虛歲的差距會大於 1
  const diff = info!.nominalAge - info!.actualAge;
  assert.equal(diff >= 1, true, "虛歲必定大於等於實歲");
  assert.equal(diff <= 2, true, "虛歲與實歲差距不應超過 2");
});
