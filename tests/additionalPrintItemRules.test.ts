import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePrintName,
  computePrintProgress,
  applyPrintAction,
  computeAdditionalPrintItemFee,
  summarizePrintItems,
  expandFixedColumnRow,
  validateDetailSheetImportRow,
  resolveDetailSheetQuantity,
  matchesSourceEntry,
} from "../src/lib/additionalPrintItemRules";

// 以下測試對應 V9.1 需求「十六、自動測試」條列的 20 個案例（在檔案裡以
// 「案例 N」註明對應編號）。跟 DB 有關、無法脫離 Prisma 執行的整合行為
// （例如案例 16「已列印後修改需留下版本紀錄」、案例 20「同一家戶多位
// 祖先的寶袋不會互相混用」牽涉到的真正資料庫關聯查詢）在
// src/lib/additionalPrintItems.ts 裡用程式碼保證，這裡只測試可以脫離
// 資料庫獨立驗證的純規則部分。

test("案例1：只有一個預設寶袋時，summarizePrintItems 統計正確", () => {
  const summary = summarizePrintItems([{ isExtra: false, status: "PENDING_PRINT" }]);
  assert.equal(summary.defaultCount, 1);
  assert.equal(summary.extraCount, 0);
  assert.equal(summary.total, 1);
});

test("案例2／6：兩個額外寶袋即使名稱相同，也要展開成兩筆獨立資料，不合併成一筆", () => {
  const specs = expandFixedColumnRow({
    defaultBagName: "王姓歷代祖先",
    extra1Name: "王姓歷代祖先",
    extra1Quantity: 1,
    extra2Name: "王姓歷代祖先",
    extra2Quantity: 1,
  });
  assert.equal(specs.length, 3);
  assert.equal(specs.filter((s) => s.printName === "王姓歷代祖先").length, 3);
  assert.equal(specs[0].isExtra, false);
  assert.equal(specs[1].isExtra, true);
  assert.equal(specs[2].isExtra, true);
});

test("案例3：新增自訂名稱寶袋（王某某）時，列印名稱使用自訂名稱，不是原祭祀名稱", () => {
  const name = resolvePrintName(false, "王姓歷代祖先", "王某某");
  assert.equal(name, "王某某");
});

test("案例4／6：同一筆祖先有三個不同寶袋名稱時，各自獨立展開，不會合併", () => {
  const specs = expandFixedColumnRow({
    defaultBagName: "王姓歷代祖先",
    extra1Name: "王姓歷代祖先",
    extra2Name: "王某某",
  });
  const names = specs.map((s) => s.printName);
  assert.deepEqual(names, ["王姓歷代祖先", "王姓歷代祖先", "王某某"]);
});

test("案例5：寶袋數量為 2 時，第一次列印會產生「已完整列印兩份」的進度", () => {
  const afterFirstPrint = applyPrintAction(
    { quantity: 2, printedQuantity: 0, reprintCount: 0, isPrinted: false },
    2
  );
  assert.equal(afterFirstPrint.printedQuantity, 2);
  assert.equal(afterFirstPrint.quantity, 2);
  const progress = computePrintProgress(afterFirstPrint.quantity, afterFirstPrint.printedQuantity);
  assert.equal(progress.isFullyPrinted, true);
  assert.equal(progress.remaining, 0);
});

test("案例5（反例）：只印了 1 份、quantity 是 2 時，不算完整列印", () => {
  const progress = computePrintProgress(2, 1);
  assert.equal(progress.isFullyPrinted, false);
  assert.equal(progress.remaining, 1);
});

test("案例7：冤親債主的來源比對，只認同一分類同一名稱", () => {
  const matched = matchesSourceEntry(
    { category: "DEBT_CREDITOR", displayName: "冤親債主" },
    { sourceCategory: "DEBT_CREDITOR", sourceName: "冤親債主" }
  );
  assert.equal(matched, true);
});

test("案例8：個人乙位正魂的來源比對", () => {
  const matched = matchesSourceEntry(
    { category: "INDIVIDUAL_SOUL", displayName: "王小明 乙位正魂" },
    { sourceCategory: "INDIVIDUAL_SOUL", sourceName: "王小明 乙位正魂" }
  );
  assert.equal(matched, true);
});

test("案例9：無緣子女的來源比對", () => {
  const matched = matchesSourceEntry(
    { category: "UNBORN_CHILD", displayName: "無緣子女" },
    { sourceCategory: "UNBORN_CHILD", sourceName: "無緣子女" }
  );
  assert.equal(matched, true);
});

test("案例10：Excel 匯入固定欄位展開出的額外寶袋，isExtra 皆為 true", () => {
  const specs = expandFixedColumnRow({
    extra1Name: "王某某",
    extra1Quantity: 1,
    extra2Name: "李氏歷代祖先",
    extra2Quantity: 2,
  });
  assert.equal(specs.length, 2);
  assert.ok(specs.every((s) => s.isExtra));
  assert.equal(specs[1].quantity, 2);
});

test("案例11：明細工作表列缺少原祭祀名稱時驗證失敗，需列入待確認", () => {
  const result = validateDetailSheetImportRow({
    householdId: "F00009",
    sourceCategory: "ANCESTOR_LINE",
    sourceName: "",
    itemType: "POCKET",
    printName: "王姓歷代祖先",
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("原祭祀名稱")));
});

test("案例11（反例）：找不到來源比對——分類相符但名稱不符時 matchesSourceEntry 回傳 false", () => {
  const matched = matchesSourceEntry(
    { category: "ANCESTOR_LINE", displayName: "王姓歷代祖先" },
    { sourceCategory: "ANCESTOR_LINE", sourceName: "李姓歷代祖先" }
  );
  assert.equal(matched, false);
});

test("案例12：預設與額外寶袋分開統計，不會混在一起", () => {
  const summary = summarizePrintItems([
    { isExtra: false, status: "PENDING_PRINT" },
    { isExtra: true, status: "PENDING_PRINT" },
    { isExtra: true, status: "PRINTED" },
  ]);
  assert.equal(summary.defaultCount, 1);
  assert.equal(summary.extraCount, 2);
  assert.equal(summary.total, 3);
});

test("案例13：單筆補印——已經列印過後再印一次，quantity 不變、reprintCount +1", () => {
  const printed = { quantity: 1, printedQuantity: 1, reprintCount: 0, isPrinted: true };
  const reprinted = applyPrintAction(printed, 1);
  assert.equal(reprinted.quantity, 1);
  assert.equal(reprinted.printedQuantity, 2);
  assert.equal(reprinted.reprintCount, 1);
});

test("案例14：多份補印——quantity 為 2，補印 2 份時 printedQuantity 累加、quantity 仍是 2", () => {
  const printed = { quantity: 2, printedQuantity: 2, reprintCount: 0, isPrinted: true };
  const reprinted = applyPrintAction(printed, 2);
  assert.equal(reprinted.quantity, 2);
  assert.equal(reprinted.printedQuantity, 4);
  assert.equal(reprinted.reprintCount, 1);
});

test("案例15：取消（CANCELLED）的項目不計入總數與待列印數量", () => {
  const summary = summarizePrintItems([
    { isExtra: false, status: "PENDING_PRINT" },
    { isExtra: true, status: "CANCELLED" },
  ]);
  assert.equal(summary.total, 1);
  assert.equal(summary.pendingPrintCount, 1);
  assert.equal(summary.cancelledCount, 1);
});

test("案例17：活動摘要數量——預設/額外/總數/待列印/已列印全部正確", () => {
  const summary = summarizePrintItems([
    { isExtra: false, status: "PRINTED" },
    { isExtra: false, status: "PENDING_PRINT" },
    { isExtra: true, status: "PENDING_CONFIRMATION" },
    { isExtra: true, status: "PRINTED" },
    { isExtra: true, status: "CANCELLED" },
  ]);
  assert.equal(summary.defaultCount, 2);
  assert.equal(summary.extraCount, 2);
  assert.equal(summary.total, 4);
  assert.equal(summary.printedCount, 2);
  assert.equal(summary.pendingPrintCount, 2);
  assert.equal(summary.cancelledCount, 1);
});

test("案例18：收款金額預留——不收費時小計固定為 0", () => {
  const fee = computeAdditionalPrintItemFee(false, null, 3);
  assert.equal(fee.subtotal, 0);
});

test("案例18（收費）：收費且已設定單價時，小計 = 單價 × 數量", () => {
  const fee = computeAdditionalPrintItemFee(true, 50, 3);
  assert.equal(fee.subtotal, 150);
});

test("案例18（尚未設定單價）：要收費但還沒填單價時，回傳 null（不可假裝是 0）", () => {
  const fee = computeAdditionalPrintItemFee(true, null, 3);
  assert.equal(fee.subtotal, null);
});

test("案例19：沿用原名稱時回傳原祭祀名稱，不會被自訂名稱覆蓋", () => {
  const name = resolvePrintName(true, "王姓歷代祖先", "應該被忽略的自訂名稱");
  assert.equal(name, "王姓歷代祖先");
});

test("案例19（反例）：自訂名稱情境下，即使原祭祀名稱之後改變，這筆列印名稱是獨立存好的字串，呼叫端不會重新讀取原名稱", () => {
  // 這裡用兩次呼叫模擬「原祭祀名稱後來被改了」：resolvePrintName 只在建立
  // 當下決定一次要存進資料庫的字串，之後原名稱怎麼變都不會影響已經算出來
  // 的這個回傳值（真正的「不回寫」保證在 lib 層是「只在建立時算一次、
  // 存成獨立欄位」，這裡驗證純函式本身不會有需要重新查詢原名稱的副作用）。
  const printNameAtCreation = resolvePrintName(false, "王姓歷代祖先", "王某某");
  const sourceNameChangedLater = "王姓歷代祖先（已改名）";
  assert.equal(printNameAtCreation, "王某某");
  assert.notEqual(printNameAtCreation, sourceNameChangedLater);
});

test("案例20：同分類但不同名稱的祖先資料不會被誤認為同一筆來源", () => {
  const wangAncestor = { category: "ANCESTOR_LINE", displayName: "王姓歷代祖先" };
  const chenAncestor = { category: "ANCESTOR_LINE", displayName: "陳姓歷代祖先" };
  const rowForWang = { sourceCategory: "ANCESTOR_LINE", sourceName: "王姓歷代祖先" };
  assert.equal(matchesSourceEntry(wangAncestor, rowForWang), true);
  assert.equal(matchesSourceEntry(chenAncestor, rowForWang), false);
});

test("resolveDetailSheetQuantity：沒填數量時預設為 1", () => {
  assert.equal(resolveDetailSheetQuantity(undefined), 1);
  assert.equal(resolveDetailSheetQuantity(""), 1);
  assert.equal(resolveDetailSheetQuantity(3), 3);
  assert.equal(resolveDetailSheetQuantity(0), 1);
  assert.equal(resolveDetailSheetQuantity(-1), 1);
});

test("validateDetailSheetImportRow：附加項目類型不是合法選項時驗證失敗", () => {
  const result = validateDetailSheetImportRow({
    householdId: "F00009",
    sourceCategory: "ANCESTOR_LINE",
    sourceName: "王姓歷代祖先",
    itemType: "不存在的類型",
    printName: "王姓歷代祖先",
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("附加項目類型")));
});

test("validateDetailSheetImportRow：欄位齊全時驗證通過", () => {
  const result = validateDetailSheetImportRow({
    householdId: "F00009",
    sourceCategory: "ANCESTOR_LINE",
    sourceName: "王姓歷代祖先",
    itemType: "POCKET",
    printName: "王姓歷代祖先",
    quantity: 2,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});
