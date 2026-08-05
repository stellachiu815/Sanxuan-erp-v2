import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyMatch, resolveImportAddress, type ImportRowInput, type DevoteeCandidate } from "../src/lib/purificationImportRules";

/**
 * V36.3 §一：信眾／家戶配對（classifyMatch，純函式；候選由呼叫端提供）。
 * classifyMatch 只認**精確**姓名（matchNames.includes(candidate.name)），不做模糊比對。
 */

const anc = (row: Partial<ImportRowInput>): ImportRowInput => ({ tabletCategory: "ANCESTOR_LINE", tabletName: "王姓", ...row });
const cand = (p: Partial<DevoteeCandidate> & { id: string; name: string }): DevoteeCandidate => ({ householdId: "H1", householdCode: "F001", phone: null, address: null, ...p });

test("家戶編號正確 → 直接配對（MATCHED，基於家戶編號）", () => {
  const r = classifyMatch(anc({ householdCode: "F001", yangshangNames: ["王大"] }), [], new Set(), [{ id: "F001", name: "王家" }]);
  assert.equal(r.status, "MATCHED");
  assert.equal(r.matchedHouseholdId, "F001");
});

test("姓名唯一 → 自動配對（MATCHED）", () => {
  const r = classifyMatch(anc({ yangshangNames: ["王大"] }), [cand({ id: "m1", name: "王大", householdId: "H9", householdCode: "F009" })], new Set(), []);
  assert.equal(r.status, "MATCHED");
  assert.equal(r.matchedDevoteeId, "m1");
});

test("同名多人 → 必須待人工確認（AMBIGUOUS＝NEEDS_REVIEW）", () => {
  const r = classifyMatch(anc({ yangshangNames: ["王大"] }), [cand({ id: "m1", name: "王大" }), cand({ id: "m2", name: "王大", householdId: "H2" })], new Set(), []);
  assert.equal(r.status, "AMBIGUOUS");
  assert.equal(r.matchedDevoteeId, null);
});

test("查無信眾 → 列為新增（NEW）", () => {
  const r = classifyMatch(anc({ yangshangNames: ["查無此人"] }), [], new Set(), []);
  assert.equal(r.status, "NEW");
});

test("不因姓名相似而模糊亂配（王大 ≠ 王大明）", () => {
  const r = classifyMatch(anc({ yangshangNames: ["王大"] }), [cand({ id: "m9", name: "王大明" })], new Set(), []);
  assert.notEqual(r.status, "MATCHED");
  assert.equal(r.status, "NEW");
});

// V36.16：一張牌位多位陽上人，不該被誤判成「同名多人」而逼人工選。
test("多位陽上人同一家戶 → 自動配對該戶（不需人工選）", () => {
  const r = classifyMatch(
    anc({ tabletName: "楊姓", yangshangNames: ["楊菁文", "楊婷勻"] }),
    [cand({ id: "m1", name: "楊菁文", householdId: "H7", householdCode: "F007" }),
     cand({ id: "m2", name: "楊婷勻", householdId: "H7", householdCode: "F007" })],
    new Set(), []
  );
  assert.equal(r.status, "MATCHED");
  assert.equal(r.matchedHouseholdId, "H7");
});

test("多位陽上人分屬不同戶、主要陽上人唯一 → 以主要陽上人家戶為準", () => {
  const r = classifyMatch(
    anc({ tabletName: "吳姓", yangshangNames: ["吳明仁", "孫怡萍"] }),
    [cand({ id: "m1", name: "吳明仁", householdId: "H1", householdCode: "F001" }),
     cand({ id: "m2", name: "孫怡萍", householdId: "H2", householdCode: "F002" })],
    new Set(), []
  );
  assert.equal(r.status, "MATCHED");
  assert.equal(r.matchedHouseholdId, "H1");
});

test("主要陽上人本身同名多人 → 仍待人工確認（AMBIGUOUS）", () => {
  const r = classifyMatch(
    anc({ tabletName: "陳姓", yangshangNames: ["陳志明", "陳小美"] }),
    [cand({ id: "m1", name: "陳志明", householdId: "H1" }),
     cand({ id: "m2", name: "陳志明", householdId: "H2" }),
     cand({ id: "m3", name: "陳小美", householdId: "H3" })],
    new Set(), []
  );
  assert.equal(r.status, "AMBIGUOUS");
  assert.equal(r.matchedDevoteeId, null);
});

test("analyze 查詢層排除已封存 Member／Household（靜態驗證 deletedAt:null）", () => {
  const src = readFileSync(new URL("../src/lib/purificationImport.ts", import.meta.url), "utf8");
  // 候選信眾查詢帶 deletedAt: null；家戶候選查詢帶 deletedAt: null。
  assert.ok(/member\.findMany\(\{[\s\S]*?deletedAt:\s*null/.test(src), "候選信眾需排除已封存");
  assert.ok(/household\.findMany\(\{[\s\S]*?deletedAt:\s*null/.test(src), "候選家戶需排除已封存");
});

/** §二（地址部分）：Member.address 與 Household.address 不得混用——resolveImportAddress 以獨立來源、明確優先序解析。 */
test("地址優先序：Excel 牌位地址最高", () => {
  const r = resolveImportAddress({ rowTabletAddress: "牌位路1號", rowAddress: "聯絡路2號", matchedHouseholdAddress: "家戶路3號", devoteeHouseholdAddress: "信眾家戶路4號" });
  assert.deepEqual([r.address, r.source], ["牌位路1號", "Excel"]);
});

test("地址優先序：無 Excel 時採信眾家戶地址（不與家戶地址混用）", () => {
  const r = resolveImportAddress({ rowTabletAddress: null, rowAddress: null, matchedHouseholdAddress: "家戶路3號", devoteeHouseholdAddress: "信眾家戶路4號" });
  assert.deepEqual([r.address, r.source], ["信眾家戶路4號", "信眾"]);
});

test("地址優先序：只有配對家戶地址時才用家戶地址", () => {
  const r = resolveImportAddress({ matchedHouseholdAddress: "家戶路3號" });
  assert.deepEqual([r.address, r.source], ["家戶路3號", "家戶"]);
});

test("地址全無 → null（呼叫端顯示缺牌位地址，不亂帶）", () => {
  const r = resolveImportAddress({});
  assert.deepEqual([r.address, r.source], [null, null]);
});
