import { test } from "node:test";
import assert from "node:assert/strict";
import {
  minguoYearToADYear,
  calculateNominalAge,
  resolveNominalAgeForMinguoYear,
} from "../src/lib/purificationAge";

test("民國年轉西元年：民國115年 = 西元2026年", () => {
  assert.equal(minguoYearToADYear(115), 2026);
});

test("虛歲跨年度自動增加：113年53歲的人，114年應該自動變54歲", () => {
  // 出生農曆年反推：113 年（西元2024）53歲 → 出生農曆年 = 2024 - 53 + 1 = 1972
  const birthLunarYear = minguoYearToADYear(113) - 53 + 1;
  const ageAt113 = resolveNominalAgeForMinguoYear(birthLunarYear, 113);
  const ageAt114 = resolveNominalAgeForMinguoYear(birthLunarYear, 114);
  assert.equal(ageAt113.ok, true);
  assert.equal(ageAt114.ok, true);
  if (ageAt113.ok && ageAt114.ok) {
    assert.equal(ageAt113.age, 53);
    assert.equal(ageAt114.age, 54);
    assert.equal(ageAt114.age, ageAt113.age + 1, "不需要任何排程或手動修改，跨年度自動加一歲");
  }
});

test("calculateNominalAge：基本算式驗證", () => {
  assert.equal(calculateNominalAge(1972, 2026), 55);
  assert.equal(calculateNominalAge(2026, 2026), 1); // 出生當年就是虛歲1歲
});

test("出生年份不完整（null/undefined）時，回傳無法計算，交給待確認清單", () => {
  const r1 = resolveNominalAgeForMinguoYear(null, 115);
  const r2 = resolveNominalAgeForMinguoYear(undefined, 115);
  assert.equal(r1.ok, false);
  assert.equal(r2.ok, false);
});

test("出生年份異常（例如比1800年還早）時，回傳無法計算", () => {
  const r = resolveNominalAgeForMinguoYear(1500, 115);
  assert.equal(r.ok, false);
});

test("算出來的歲數不合理（例如出生年份在祭改年度之後）時，回傳無法計算而非負數歲數", () => {
  const r = resolveNominalAgeForMinguoYear(2030, 115); // 出生年比目標年還晚
  assert.equal(r.ok, false);
});

test("歲數計算不得由使用者每年手動修改：同一筆出生資料換不同年度會得到不同結果", () => {
  const birthLunarYear = 1980;
  const results = [113, 114, 115].map((y) => resolveNominalAgeForMinguoYear(birthLunarYear, y));
  assert.ok(results.every((r) => r.ok));
  const ages = results.map((r) => (r.ok ? r.age : null));
  assert.deepEqual(ages, [ages[0], (ages[0] as number) + 1, (ages[0] as number) + 2]);
});
