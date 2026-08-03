import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyMatch, type ImportRowInput } from "../src/lib/purificationImportRules";

/**
 * 冤親（DEBT_CREDITOR）匯入：報名者姓名可能填在 報名人(primaryContact)／陽上人(yangshang)／
 * 信眾姓名(devoteeName)／牌位姓名(tabletName) 任一欄，皆應視為有效（不再誤判「缺少報名姓名」）。
 * 這正是使用者回報的情境：只填 報名人 + 陽上人、牌位姓名留空。
 */

const yuanqin = (row: Partial<ImportRowInput>): ImportRowInput => ({ tabletCategory: "DEBT_CREDITOR", ...row });

test("冤親：只填『報名人』(primaryContact) 亦視為有效，不再 INVALID", () => {
  const r = classifyMatch(yuanqin({ primaryContact: "周財寶" }), [], new Set(), []);
  assert.notEqual(r.status, "INVALID");
  assert.ok(!r.issues.includes("缺少報名姓名"));
});

test("冤親：只填『陽上人』(yangshang) 亦視為有效", () => {
  const r = classifyMatch(yuanqin({ yangshangNames: ["陳秀珍"] }), [], new Set(), []);
  assert.notEqual(r.status, "INVALID");
});

test("冤親：使用者實測情境（報名人＋陽上人皆填、牌位姓名留空）→ 有效", () => {
  const r = classifyMatch(yuanqin({ primaryContact: "周財寶", yangshangNames: ["周財寶"] }), [], new Set(), []);
  assert.notEqual(r.status, "INVALID");
  assert.ok(!r.issues.includes("缺少報名姓名"));
});

test("冤親：報名人命中既有信眾 → MATCHED（可取得家戶地址）", () => {
  const cand = [{ id: "m1", name: "周財寶", householdId: "F00001", householdCode: "F00001", phone: null, address: "台北市A路" }];
  const r = classifyMatch(yuanqin({ primaryContact: "周財寶" }), cand, new Set(), []);
  assert.equal(r.status, "MATCHED");
  assert.equal(r.matchedDevoteeId, "m1");
});

test("冤親：完全沒有任何姓名 → 仍為 INVALID（缺少報名姓名）", () => {
  const r = classifyMatch(yuanqin({}), [], new Set(), []);
  assert.equal(r.status, "INVALID");
  assert.ok(r.issues.includes("缺少報名姓名"));
});

test("祖先：仍必須有牌位姓名（未放寬）；只填報名人不足以有效", () => {
  const r = classifyMatch({ tabletCategory: "ANCESTOR_LINE", primaryContact: "周財寶", yangshangNames: ["周財寶"] }, [], new Set(), []);
  assert.equal(r.status, "INVALID");
  assert.ok(r.issues.includes("缺少牌位姓名"));
});
