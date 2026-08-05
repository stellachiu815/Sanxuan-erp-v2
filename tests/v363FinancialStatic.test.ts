import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * V36.3 §七：財務保護（靜態驗證——讀正式程式碼斷言關鍵不變式，不修改任何業務碼、不連 DB）。
 * 財務端到端行為需在 Mac DB 驗證；此處守住「程式碼層」的關鍵護欄。
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("Excel 匯入贊普／隨喜一律建 DRAFT、amountPaid=0、不建收款交易（不自動變已收）", () => {
  const src = read("src/lib/purificationImport.ts");
  // materializeSponsors 一律 status: "DRAFT"。
  const count = (src.match(/status:\s*"DRAFT"/g) ?? []).length;
  assert.ok(count >= 2, "贊普與隨喜贊普皆應建立為 DRAFT");
  assert.ok(src.includes("一律建**草稿**") || src.includes("amountPaid=0"), "匯入註記：草稿、amountPaid=0、不進已收");
  assert.ok(src.includes("不建收款交易") || src.includes("不進已收"), "匯入不得自動進帳本/已收");
});

test("匯入白米只採斤數，不採單價/金額/已收（不覆蓋正式財務）", () => {
  const rules = read("src/lib/purificationImportRules.ts");
  assert.ok(rules.includes("extractRiceKgFromImport"), "白米只擷取斤數");
  assert.ok(/只(採用|匯入).*斤數|其餘.*不採|單價.*一律不採/.test(rules), "白米單價/金額一律不採為正式來源");
});

test("補印不得改應收/已收/未收（confirmPrintObjects 只動列印欄位）", () => {
  const src = read("src/lib/additionalPrintItems.ts");
  const start = src.indexOf("export async function confirmPrintObjects");
  assert.ok(start > 0, "找得到 confirmPrintObjects");
  const body = src.slice(start, start + 4000);
  // 補印流程不得寫入金額欄位。
  assert.ok(!body.includes("amountDue"), "補印不得改 amountDue");
  assert.ok(!body.includes("amountPaid"), "補印不得改 amountPaid");
  assert.ok(!body.includes("amountUnpaid"), "補印不得改 amountUnpaid");
});

test("牌位取消連動：已收款不動，保留歷史（cancelLinkedTabletItem 守 amountPaid>0）", () => {
  const src = read("src/lib/registrationItemRegistration.ts");
  assert.ok(/if\s*\(\s*Number\(item\.amountPaid\)\s*>\s*0\s*\)\s*return/.test(src), "已收款的計價項目不得被取消連動改動");
});

test("封存牌位連動軟刪列印物件時，不得改動任何財務欄位（只設 deletedAt/deletedByName）", () => {
  const src = read("src/lib/ritual.ts");
  const m = src.match(/additionalPrintItem\.updateMany\(\{[\s\S]*?data:\s*\{([\s\S]*?)\}\s*,?\s*\}\)/);
  assert.ok(m, "找得到封存連動的 updateMany");
  const data = m![1];
  assert.ok(data.includes("deletedAt"), "應設 deletedAt");
  assert.ok(!/amount(Due|Paid|Unpaid)/.test(data), "封存連動不得改任何金額欄位");
});

test("正式報名確認前有完整度 gate（缺資料回 422、維持草稿，不會靜默進帳）", () => {
  const route = read("src/app/api/registrations/[ritualRecordId]/confirm/route.ts");
  assert.ok(route.includes("checkRitualRecordCompleteness"), "確認前套用完整度驗證");
  assert.ok(/status:\s*422/.test(route), "缺資料回 422");
});
