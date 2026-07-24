import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseYangshangNames,
  classifyMatch,
  resolveColumnMapping,
  extractRiceKgFromImport,
  isRowConfirmable,
  type DevoteeCandidate,
} from "../src/lib/purificationImportRules";

/**
 * V14.4 Part 6B「Excel 匯入」純規則測試（沙盒可執行）。對應 6B 測試 2/3/4/5/6/10。
 * DB/API/UI 整合測試見 tests/v144Import.db.todo（待 Mac/staging，未執行不計通過）。
 */

test("6. 多位陽上人：逗號／中文逗號／頓號／換行 → 陣列（存 yangshangNames[]）", () => {
  assert.deepEqual(parseYangshangNames("王大明, 王二明，王三明、王四明\n王五明"), ["王大明", "王二明", "王三明", "王四明", "王五明"]);
  assert.deepEqual(parseYangshangNames(""), []);
  assert.deepEqual(parseYangshangNames(null), []);
});

test("欄位別名：analyze 回報實際對應欄名", () => {
  const map = resolveColumnMapping(["家戶編號", "姓名", "陽上人", "白米", "備註"]);
  assert.equal(map.householdCode, "家戶編號");
  assert.equal(map.devoteeName, "姓名");
  assert.equal(map.yangshang, "陽上人");
  assert.equal(map.riceKg, "白米");
});

test("10. Excel 白米只採斤數（單價/金額欄位忽略）", () => {
  assert.equal(extractRiceKgFromImport("10"), 10);
  assert.equal(extractRiceKgFromImport(3.5), 3.5);
  assert.equal(extractRiceKgFromImport("0"), null);
  assert.equal(extractRiceKgFromImport("abc"), null);
  // 沒有任何採用 Excel 單價/金額的函式——只有斤數萃取（正式價由 confirm 讀今年 riceUnitPrice）。
});

const base = { tabletCategory: "ANCESTOR_LINE", tabletName: "王姓歷代祖先" };

test("2. 只有姓名相同不自動 MATCHED（→ AMBIGUOUS）", () => {
  const cands: DevoteeCandidate[] = [{ id: "d1", name: "王小明", householdId: "h1", phone: "0911111111", address: "台北市A路" }];
  const r = classifyMatch({ ...base, devoteeName: "王小明" }, cands);
  assert.equal(r.status, "AMBIGUOUS");
  assert.equal(r.matchedDevoteeId, null);
  assert.deepEqual(r.candidateIds, ["d1"]);
});

test("MATCHED：家戶編號＋姓名一致（強依據）", () => {
  const cands: DevoteeCandidate[] = [{ id: "d1", name: "王小明", householdId: "h1", householdCode: "F001", phone: "0911" }];
  const r = classifyMatch({ ...base, devoteeName: "王小明", householdCode: "F001" }, cands);
  assert.equal(r.status, "MATCHED");
  assert.equal(r.matchedDevoteeId, "d1");
});

test("MATCHED：姓名＋電話一致（強依據）", () => {
  const cands: DevoteeCandidate[] = [{ id: "d1", name: "王小明", householdId: "h1", phone: "0922222222" }];
  const r = classifyMatch({ ...base, devoteeName: "王小明", phone: "0922222222" }, cands);
  assert.equal(r.status, "MATCHED");
  assert.equal(r.matchedDevoteeId, "d1");
});

test("3. 同名多人 → AMBIGUOUS（列出候選）", () => {
  const cands: DevoteeCandidate[] = [
    { id: "d1", name: "陳美麗", householdId: "h1", phone: "0911" },
    { id: "d2", name: "陳美麗", householdId: "h2", phone: "0922" },
  ];
  const r = classifyMatch({ ...base, devoteeName: "陳美麗" }, cands);
  assert.equal(r.status, "AMBIGUOUS");
  assert.deepEqual(r.candidateIds.sort(), ["d1", "d2"]);
});

test("4. 電話與所有同名候選皆不符 → CONFLICT", () => {
  const cands: DevoteeCandidate[] = [
    { id: "d1", name: "林大同", householdId: "h1", phone: "0911" },
    { id: "d2", name: "林大同", householdId: "h2", phone: "0922" },
  ];
  const r = classifyMatch({ ...base, devoteeName: "林大同", phone: "0999999999" }, cands);
  assert.equal(r.status, "CONFLICT");
});

test("5. 同批次重複列 → DUPLICATE", () => {
  const seen = new Set<string>(["F001|王小明|0911"]);
  const r = classifyMatch({ ...base, devoteeName: "王小明", householdCode: "F001", phone: "0911" }, [], seen);
  assert.equal(r.status, "DUPLICATE");
});

test("INVALID：缺姓名或牌位類型不合法", () => {
  assert.equal(classifyMatch({ ...base, devoteeName: "" }, []).status, "INVALID");
  assert.equal(classifyMatch({ tabletCategory: "XXX", tabletName: "王", devoteeName: "王小明" }, []).status, "INVALID");
});

test("NEW：查無候選（需明確確認才建新信眾）", () => {
  const r = classifyMatch({ ...base, devoteeName: "全新信眾" }, []);
  assert.equal(r.status, "NEW");
  // 未明確確認建新 → 不可確認；明確確認 → 可確認。
  assert.equal(isRowConfirmable("NEW", null, false), false);
  assert.equal(isRowConfirmable("NEW", null, true), true);
  // 人工指定了正確信眾 → 可確認。
  assert.equal(isRowConfirmable("AMBIGUOUS", "d1", false), true);
  // MATCHED → 可確認。
  assert.equal(isRowConfirmable("MATCHED", null, false), true);
});
