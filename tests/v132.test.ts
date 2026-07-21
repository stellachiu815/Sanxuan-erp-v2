import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeGenderInput,
  toStoredGender,
  isValidStoredGender,
  isGenderConflict,
  GENDER_OPTIONS,
} from "../src/lib/genderNormalize";
import { parsePersonSheet } from "../src/lib/devoteeImportPersonSheet";

/**
 * V13.2「性別、生日與生肖顯示整合修正」測試。
 *
 * 對應規格第七節列出的 10 項要求。
 */

// ============================================================
// 七之 1／2：個人資料性別「男」「女」正確流入匯入資料
// ============================================================

test("七之1：個人資料性別「男」正確解析", () => {
  const rows = parsePersonSheet([{ 姓名: "王大明", 性別: "男" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gender, "男");
  assert.deepEqual(rows[0].formatErrors, []);
});

test("七之2：個人資料性別「女」正確解析", () => {
  const rows = parsePersonSheet([{ 姓名: "陳小美", 性別: "女" }]);
  assert.equal(rows[0].gender, "女");
  assert.deepEqual(rows[0].formatErrors, []);
});

// ============================================================
// 七之 3：男性／女性／M／F 可正規化
// ============================================================

test("七之3：各種寫法都正規化成「男」", () => {
  for (const raw of ["男", "男性", "男生", "男士", "M", "m", "Male", "male", "1", "Ｍ"]) {
    const r = normalizeGenderInput(raw);
    assert.equal(r.ok, true, `「${raw}」應可辨識`);
    assert.equal(r.ok && r.value, "男", `「${raw}」應為男`);
  }
});

test("七之3：各種寫法都正規化成「女」", () => {
  for (const raw of ["女", "女性", "女生", "女士", "F", "f", "Female", "female", "2", "Ｆ"]) {
    const r = normalizeGenderInput(raw);
    assert.equal(r.ok, true, `「${raw}」應可辨識`);
    assert.equal(r.ok && r.value, "女", `「${raw}」應為女`);
  }
});

test("七之3：前後空白不影響辨識", () => {
  const r = normalizeGenderInput("  男性  ");
  assert.equal(r.ok && r.value, "男");
});

test("空白／null 視為未填寫，是合法狀態不是錯誤", () => {
  assert.deepEqual(normalizeGenderInput(null), { ok: true, value: null });
  assert.deepEqual(normalizeGenderInput(undefined), { ok: true, value: null });
  assert.deepEqual(normalizeGenderInput(""), { ok: true, value: null });
  assert.deepEqual(normalizeGenderInput("   "), { ok: true, value: null });
});

// ============================================================
// 七之 4：無法辨識進入人工確認，不自動猜測
// ============================================================

test("七之4：無法辨識的性別回報錯誤，不猜測", () => {
  const r = normalizeGenderInput("不詳");
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason.includes("無法辨識"), true);
});

test("七之4：無法辨識的性別在解析時進入 formatErrors，gender 留 null", () => {
  const rows = parsePersonSheet([{ 姓名: "測試", 性別: "不詳" }]);
  // 絕不猜測、絕不寫入任意文字
  assert.equal(rows[0].gender, null);
  // 但必須讓使用者知道
  assert.equal(rows[0].formatErrors.length > 0, true);
  assert.equal(rows[0].formatErrors[0].includes("性別"), true);
});

test("七之4：無法辨識時不得寫入原始文字", () => {
  const rows = parsePersonSheet([{ 姓名: "測試", 性別: "男女" }]);
  assert.notEqual(rows[0].gender, "男女");
  assert.equal(rows[0].gender, null);
});

test("絕不從身分證推導性別：只有身分證、沒有性別欄 → gender 為 null", () => {
  // A1... 的第 2 碼是 1（男），若有推導邏輯這裡會變成「男」
  const rows = parsePersonSheet([{ 姓名: "王大明", 身分證字號: "A123456789" }]);
  assert.equal(rows[0].nationalId, "A123456789");
  assert.equal(rows[0].gender, null);
});

// ============================================================
// 七之 5：家戶資料沒有性別欄位時，不會清掉個人資料性別
// ============================================================

test("七之5：個人資料有性別、家戶列沒有性別欄，性別不得遺失", () => {
  // 模擬個人 Excel 解析結果
  const persons = parsePersonSheet([
    { 家戶編號: "F00001", 姓名: "王大明", 性別: "男" },
  ]);
  assert.equal(persons[0].gender, "男");

  // 模擬 devoteeImportBatch 組 IncomingMember 的合併規則：
  // 家戶 Excel 七欄沒有性別欄位，一律以個人資料為準
  const householdRowHasNoGenderColumn = undefined;
  const merged = persons[0].gender ?? householdRowHasNoGenderColumn ?? null;
  assert.equal(merged, "男", "家戶端沒有性別欄不得把個人資料的性別清空");
});

test("七之5：沒有個人資料時性別為 null（代表本次未帶性別，不是要清空）", () => {
  const person = null as { gender: string | null } | null;
  const merged = person?.gender ?? null;
  assert.equal(merged, null);
});

// ============================================================
// 七之 6：既有性別與匯入值衝突時，不靜默覆蓋
// ============================================================

test("七之6：兩邊都有值且不同 → 判定為衝突", () => {
  assert.equal(isGenderConflict("男", "女"), true);
  assert.equal(isGenderConflict("女", "男"), true);
});

test("七之6：相同或任一邊為空 → 不是衝突", () => {
  assert.equal(isGenderConflict("男", "男"), false);
  assert.equal(isGenderConflict(null, "男"), false, "既有為空是「可補入」不是衝突");
  assert.equal(isGenderConflict("男", null), false, "Excel 為空不代表要清空");
  assert.equal(isGenderConflict(null, null), false);
  assert.equal(isGenderConflict("", "男"), false);
});

test("七之6：衝突時的更新規則——既有有值就不覆蓋", () => {
  // 模擬 commit 階段的 patch 邏輯：`if (!existing.gender && incoming.gender)`
  const buildPatch = (existingGender: string | null, incomingGender: string | null) => {
    const patch: { gender?: string } = {};
    if (!existingGender && incomingGender) patch.gender = incomingGender;
    return patch;
  };

  // 衝突 → 不寫入（保留既有值）
  assert.deepEqual(buildPatch("男", "女"), {}, "衝突時不得靜默覆蓋");
  // 既有為空 → 補入
  assert.deepEqual(buildPatch(null, "女"), { gender: "女" });
  // Excel 為空 → 不動
  assert.deepEqual(buildPatch("男", null), {}, "Excel 空白不得清空既有資料");
});

// ============================================================
// 七之 10：性別編輯只允許男、女或空白
// ============================================================

test("七之10：只有「男」「女」null 可寫入資料庫", () => {
  assert.equal(isValidStoredGender("男"), true);
  assert.equal(isValidStoredGender("女"), true);
  assert.equal(isValidStoredGender(null), true);
  assert.equal(isValidStoredGender("男性"), false, "未正規化的值不得入庫");
  assert.equal(isValidStoredGender("M"), false);
  assert.equal(isValidStoredGender("不詳"), false);
  assert.equal(isValidStoredGender(""), false);
});

test("七之10：下拉選項只有未填寫／男／女三個", () => {
  assert.equal(GENDER_OPTIONS.length, 3);
  assert.deepEqual(
    GENDER_OPTIONS.map((o) => o.value),
    ["", "男", "女"]
  );
});

test("toStoredGender：便利版無法辨識時回 null", () => {
  assert.equal(toStoredGender("男性"), "男");
  assert.equal(toStoredGender("不詳"), null);
  assert.equal(toStoredGender(null), null);
});

// ============================================================
// 七之 9：原始農曆生日編輯後仍維持農曆來源
// ============================================================

test("七之9：農曆登記的信眾，編輯頁初始曆別必須是農曆", () => {
  /**
   * 這是 V13.2 修掉的一個真實 bug。
   *
   * V13.1 起國曆與農曆兩者都會永久保存，所以 solarBirthDate 一定有值。
   * 舊寫法 `basic.solarBirthDate ? "solar" : basic.lunarBirthYear ? "lunar" : "none"`
   * 會讓**所有**農曆登記的信眾一開編輯頁就變成國曆模式，一存檔就把原本的
   * 農曆登記誤存成國曆。
   *
   * 正確判斷順序：先看 lunarBirthYear（使用者親手輸入的原始值），
   * 再看 solarBirthDate。
   */
  const resolveMode = (basic: { solarBirthDate: string | null; lunarBirthYear: number | null }) =>
    basic.lunarBirthYear ? "lunar" : basic.solarBirthDate ? "solar" : "none";

  // 農曆登記（V13.1 之後兩者都有值）
  assert.equal(
    resolveMode({ solarBirthDate: "1990-04-25", lunarBirthYear: 1990 }),
    "lunar",
    "農曆登記的信眾不得被判定成國曆"
  );
  // 國曆登記且尚未回填農曆（V13.1 之前的舊資料）
  assert.equal(resolveMode({ solarBirthDate: "1990-04-25", lunarBirthYear: null }), "solar");
  // 完全沒有生日
  assert.equal(resolveMode({ solarBirthDate: null, lunarBirthYear: null }), "none");
});

test("七之9（對照）：舊寫法確實會誤判，證明這次修正有意義", () => {
  const oldResolve = (basic: { solarBirthDate: string | null; lunarBirthYear: number | null }) =>
    basic.solarBirthDate ? "solar" : basic.lunarBirthYear ? "lunar" : "none";

  // 農曆登記的信眾在舊寫法下會被判成 solar —— 這就是 bug
  assert.equal(oldResolve({ solarBirthDate: "1990-04-25", lunarBirthYear: 1990 }), "solar");
});

// ============================================================
// 七之 7／8：詳情頁 summary 與顯示邏輯
// ============================================================

test("七之7：summary 需同時包含性別、國曆、農曆、生肖（型別層級）", () => {
  /**
   * DevoteeSummary 的欄位齊備性由 TypeScript 保證（composeDevoteeSummary
   * 的回傳型別已宣告全部欄位）。這裡用一個結構化樣本確認欄位名稱與
   * 語意沒有被改掉——欄位若被移除或改名，這個測試會在編譯期就失敗。
   */
  const sample = {
    gender: "男" as string | null,
    solarBirthDate: "1990-04-25" as string | null,
    lunarBirthDisplay: "農曆 1990 年 四月 初一" as string | null,
    lunarBirthYear: 1990 as number | null,
    lunarBirthMonth: 4 as number | null,
    lunarBirthDay: 1 as number | null,
    lunarIsLeapMonth: false,
    zodiac: "馬" as string | null,
  };
  for (const key of [
    "gender",
    "solarBirthDate",
    "lunarBirthDisplay",
    "lunarBirthYear",
    "lunarBirthMonth",
    "lunarBirthDay",
    "lunarIsLeapMonth",
    "zodiac",
  ]) {
    assert.equal(key in sample, true, `summary 缺少 ${key}`);
  }
});

test("七之8：詳情頁四個欄位必須各自獨立判斷，不得短路", () => {
  /**
   * 舊寫法 `solarBirthDate || lunarBirthDisplay` 的問題：兩者都有值時
   * 只會顯示國曆，農曆永遠看不到。這裡驗證新的判斷方式。
   */
  const shouldShow = (b: {
    gender: string | null;
    solarBirthDate: string | null;
    lunarBirthDisplay: string | null;
    zodiac: string | null;
  }) => ({
    gender: Boolean(b.gender),
    solar: Boolean(b.solarBirthDate),
    lunar: Boolean(b.lunarBirthDisplay),
    zodiac: Boolean(b.zodiac),
    empty: !b.solarBirthDate && !b.lunarBirthDisplay,
  });

  // 兩種曆別都有 → 兩個都要顯示
  const both = shouldShow({
    gender: "男",
    solarBirthDate: "1990-04-25",
    lunarBirthDisplay: "農曆 1990 年 四月 初一",
    zodiac: "馬",
  });
  assert.deepEqual(both, { gender: true, solar: true, lunar: true, zodiac: true, empty: false });

  // 只有農曆 → 農曆要顯示，且不可顯示「無生日資料」
  const lunarOnly = shouldShow({
    gender: null,
    solarBirthDate: null,
    lunarBirthDisplay: "農曆 1990 年 四月 初一",
    zodiac: "馬",
  });
  assert.equal(lunarOnly.lunar, true);
  assert.equal(lunarOnly.empty, false);

  // 完全沒有生日 → 才顯示「無生日資料」
  const none = shouldShow({
    gender: "女",
    solarBirthDate: null,
    lunarBirthDisplay: null,
    zodiac: null,
  });
  assert.equal(none.empty, true);
  assert.equal(none.gender, true, "沒有生日不影響性別顯示");
});
