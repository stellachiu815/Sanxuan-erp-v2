import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCorrectionNormalizedRows,
  correctionSolarFromLunar,
} from "../src/lib/devoteeImportBatch";
import type { PersonSheetRow } from "../src/lib/devoteeImportPersonSheet";

/**
 * V29 信眾個人資料校正（以姓名為主、完全不依賴家戶）純函式驗證。
 *
 * ⚠️ 註：本檔 import 了 devoteeImportBatch，會連帶載入 Prisma client。實際「配對／寫入」路徑
 * 需要資料庫，無法在沙盒跑；本檔只驗證**不需要 DB 的純函式**（分列合成、農曆→國曆換算）。
 * 完整配對規則（同名唯一→可安全更新、同名多人→待確認不自動選、Excel有DB無不新增）以
 * npx tsc --noEmit + npm run build + 正式站驗收為準。
 */

function person(p: Partial<PersonSheetRow> & { name: string }): PersonSheetRow {
  return {
    rowNumber: 1,
    name: p.name,
    householdCode: p.householdCode ?? null,
    gender: p.gender ?? null,
    mobile: p.mobile ?? null,
    phone: p.phone ?? null,
    email: p.email ?? null,
    solarBirthDate: p.solarBirthDate ?? null,
    lunarBirthYear: p.lunarBirthYear ?? null,
    lunarBirthMonth: p.lunarBirthMonth ?? null,
    lunarBirthDay: p.lunarBirthDay ?? null,
    lunarIsLeapMonth: p.lunarIsLeapMonth ?? false,
    nationalId: p.nationalId ?? null,
    address: p.address ?? null,
    role: p.role ?? null,
    tabletAddress: p.tabletAddress ?? null,
    formatErrors: p.formatErrors ?? [],
  } as PersonSheetRow;
}

test("每位信眾一列；無家戶編號不略過（household.code 只作參考）", () => {
  const rows = buildCorrectionNormalizedRows([
    person({ name: "王小明", householdCode: "F001" }),
    person({ name: "李大華", householdCode: null }), // 無家戶編號
    person({ name: "陳美玲", householdCode: "" }),
  ]);
  assert.equal(rows.length, 3, "三位信眾 → 三列（無家戶編號的列不被略過）");
  assert.deepEqual(
    rows.map((r) => r.memberNames),
    [["王小明"], ["李大華"], ["陳美玲"]],
    "每列 memberNames 恰為該位姓名"
  );
  assert.deepEqual(
    rows.map((r) => r.household.code),
    ["F001", "", ""],
    "household.code 僅作參考；缺值以空字串保留、不影響列數"
  );
  // 校正不建立/修改家戶：合成列不得帶入任何家戶欄位內容
  for (const r of rows) {
    assert.equal(r.household.name, "");
    assert.equal(r.household.contactName, null);
    assert.equal(r.household.address, null);
    assert.deepEqual(r.ancestorNames, []);
    assert.deepEqual(r.spiritNames, []);
  }
});

test("農曆生日換算國曆（沿用既有 lunarToSolar；含閏月）", () => {
  // 農曆 1957-03-18（平月）→ 國曆 1957-04-17
  assert.equal(
    correctionSolarFromLunar({ solarBirthDate: null, lunarBirthYear: 1957, lunarBirthMonth: 3, lunarBirthDay: 18, lunarIsLeapMonth: false }),
    "1957-04-17"
  );
});

test("Excel 已有國曆生日 → 直接沿用，不再換算", () => {
  assert.equal(
    correctionSolarFromLunar({ solarBirthDate: "1980-01-01", lunarBirthYear: 1979, lunarBirthMonth: 11, lunarBirthDay: 14, lunarIsLeapMonth: false }),
    "1980-01-01"
  );
});

test("農曆不完整 → 不猜測，回 null（保留原國曆＋待確認）", () => {
  assert.equal(
    correctionSolarFromLunar({ solarBirthDate: null, lunarBirthYear: 1957, lunarBirthMonth: null, lunarBirthDay: 18, lunarIsLeapMonth: false }),
    null
  );
  assert.equal(
    correctionSolarFromLunar({ solarBirthDate: null, lunarBirthYear: null, lunarBirthMonth: null, lunarBirthDay: null, lunarIsLeapMonth: false }),
    null
  );
});
