import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseYangshangNames,
  classifyMatch,
  resolveColumnMapping,
  extractRiceKgFromImport,
  isRowConfirmable,
  buildImportDupKey,
  resolveImportAddress,
  normalizeYangshangSet,
  type DevoteeCandidate,
} from "../src/lib/purificationImportRules";

/**
 * V14.4 Part 6B + V15R2「Excel 匯入」純規則測試（沙盒可執行）。
 * DB/API/UI 整合測試見 tests/v144Import.db.todo（待 Mac/staging，未執行不計通過）。
 */

test("6. 多位陽上人：逗號／中文逗號／頓號／換行 → 陣列（存 yangshangNames[]）", () => {
  assert.deepEqual(parseYangshangNames("王大明, 王二明，王三明、王四明\n王五明"), ["王大明", "王二明", "王三明", "王四明", "王五明"]);
  assert.deepEqual(parseYangshangNames(""), []);
  assert.deepEqual(parseYangshangNames(null), []);
});

test("欄位別名：analyze 回報實際對應欄名（正式格式：「姓名」＝牌位姓名，非信眾）", () => {
  const map = resolveColumnMapping(["家戶編號", "姓名", "陽上人", "白米", "備註", "信眾姓名"]);
  assert.equal(map.householdCode, "家戶編號");
  assert.equal(map.tabletName, "姓名");
  assert.equal(map.devoteeName, "信眾姓名");
  assert.equal(map.yangshang, "陽上人");
  assert.equal(map.riceKg, "白米");
});

test("10. Excel 白米只採斤數（單價/金額欄位忽略）", () => {
  assert.equal(extractRiceKgFromImport("10"), 10);
  assert.equal(extractRiceKgFromImport(3.5), 3.5);
  assert.equal(extractRiceKgFromImport("0"), null);
  assert.equal(extractRiceKgFromImport("abc"), null);
});

const base = { tabletCategory: "ANCESTOR_LINE", tabletName: "王姓歷代祖先" };

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

test("3. 同名多人 → AMBIGUOUS（列出候選，不自動猜測）", () => {
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

test("INVALID：缺牌位姓名或牌位類型不合法（祖先／正魂需牌位姓名）", () => {
  assert.equal(classifyMatch({ tabletCategory: "ANCESTOR_LINE", tabletName: "" }, []).status, "INVALID");
  assert.equal(classifyMatch({ tabletCategory: "XXX", tabletName: "王", devoteeName: "王小明" }, []).status, "INVALID");
  assert.notEqual(classifyMatch({ ...base }, []).status, "INVALID");
});

test("NEW：查無候選（需明確確認才建新信眾）＋ isRowConfirmable", () => {
  const r = classifyMatch({ ...base, devoteeName: "全新信眾" }, []);
  assert.equal(r.status, "NEW");
  assert.equal(isRowConfirmable("NEW", null, false), false);
  assert.equal(isRowConfirmable("NEW", null, true), true);
  assert.equal(isRowConfirmable("AMBIGUOUS", "d1", false), true);
  assert.equal(isRowConfirmable("MATCHED", null, false), true);
});

// ── V15R2 新增回歸測試 ──────────────────────────────────────

test("V15R2-1 祖先只有牌位名稱＋陽上人 → 依陽上人唯一配對信眾（可據以補地址）", () => {
  const cands: DevoteeCandidate[] = [{ id: "d1", name: "王大明", householdId: "h1", householdCode: "F001", address: "台北市A路1號" }];
  const r = classifyMatch(
    { tabletCategory: "ANCESTOR_LINE", tabletName: "王姓歷代祖先", yangshangNames: ["王大明"] },
    cands
  );
  assert.equal(r.status, "MATCHED");
  assert.equal(r.matchedDevoteeId, "d1");
  assert.equal(r.matchedHouseholdId, "h1");
});

test("V15R2-2 乙位正魂只有牌位名稱＋陽上人 → 同樣依陽上人配對", () => {
  const cands: DevoteeCandidate[] = [{ id: "d9", name: "李小華", householdId: "h9", householdCode: "F009" }];
  const r = classifyMatch(
    { tabletCategory: "INDIVIDUAL_SOUL", tabletName: "先父李公", yangshangNames: ["李小華"] },
    cands
  );
  assert.equal(r.status, "MATCHED");
  assert.equal(r.matchedHouseholdId, "h9");
});

test("V15R2-3 冤親只有報名姓名 → 依報名姓名配對信眾（無牌位名稱不判 INVALID）", () => {
  const cands: DevoteeCandidate[] = [{ id: "d3", name: "張三", householdId: "h3", householdCode: "F003" }];
  const r = classifyMatch({ tabletCategory: "DEBT_CREDITOR", devoteeName: "張三" }, cands);
  assert.equal(r.status, "MATCHED");
  assert.equal(r.matchedDevoteeId, "d3");
});

test("V15R2-3b 冤親查無相符信眾 → 尚未配對（無法取得地址）", () => {
  const r = classifyMatch({ tabletCategory: "DEBT_CREDITOR", devoteeName: "查無此人" }, []);
  assert.equal(r.status, "NEW");
  assert.ok(r.issues.some((m) => m.includes("尚未配對")));
});

test("V15R2-4 多人同名（陽上人）→ 待確認，列出候選，不自動猜測地址", () => {
  const cands: DevoteeCandidate[] = [
    { id: "a1", name: "陳文", householdId: "h1", address: "甲地" },
    { id: "a2", name: "陳文", householdId: "h2", address: "乙地" },
  ];
  const r = classifyMatch(
    { tabletCategory: "ANCESTOR_LINE", tabletName: "陳姓歷代祖先", yangshangNames: ["陳文"] },
    cands
  );
  assert.equal(r.status, "AMBIGUOUS");
  assert.equal(r.matchedDevoteeId, null);
  assert.deepEqual(r.candidateIds.sort(), ["a1", "a2"]);
});

test("V15R2-5 同姓／同牌位名稱但不同陽上人 → 不同重複鍵（不誤判重複）", () => {
  const rowA = { tabletCategory: "ANCESTOR_LINE", tabletName: "周姓歷代祖先", yangshangNames: ["周大"] };
  const rowB = { tabletCategory: "ANCESTOR_LINE", tabletName: "周姓歷代祖先", yangshangNames: ["周二"] };
  const keyA = buildImportDupKey(rowA, null, null);
  const keyB = buildImportDupKey(rowB, null, null);
  assert.notEqual(keyA, keyB);
  // 用同一批 seen 驗證：A 不會讓 B 被判成 DUPLICATE。
  const seen = new Set<string>([keyA]);
  const r = classifyMatch(rowB, [], seen);
  assert.notEqual(r.status, "DUPLICATE");
});

test("V15R2-5b 內容完全一致（含陽上集合）→ 才判 DUPLICATE", () => {
  const row = { tabletCategory: "ANCESTOR_LINE", tabletName: "周姓歷代祖先", yangshangNames: ["周大", "周二"] };
  const seen = new Set<string>([buildImportDupKey(row, null, null)]);
  const r = classifyMatch({ ...row, yangshangNames: ["周二", "周大"] }, [], seen); // 集合相同、順序不同
  assert.equal(r.status, "DUPLICATE");
});

test("V15R2 normalizeYangshangSet：去空白、去重、排序（順序無關）", () => {
  assert.deepEqual(normalizeYangshangSet([" 周大 ", "周二", "周大", ""]), ["周二", "周大"]);
  assert.deepEqual(normalizeYangshangSet(["周二", "周大"]), normalizeYangshangSet(["周大", "周二"]));
});

test("V15R2 地址來源優先序：家戶 > 信眾所屬家戶 > 信眾本人 > 尚無", () => {
  assert.deepEqual(resolveImportAddress({ matchedHouseholdAddress: "家戶地址", devoteeHouseholdAddress: "戶2", devoteeOwnAddress: "本人" }), { address: "家戶地址", source: "家戶" });
  assert.deepEqual(resolveImportAddress({ matchedHouseholdAddress: null, devoteeHouseholdAddress: "戶2地址", devoteeOwnAddress: "本人" }), { address: "戶2地址", source: "家戶" });
  assert.deepEqual(resolveImportAddress({ matchedHouseholdAddress: null, devoteeHouseholdAddress: null, devoteeOwnAddress: "本人地址" }), { address: "本人地址", source: "信眾" });
  assert.deepEqual(resolveImportAddress({}), { address: null, source: null });
});
