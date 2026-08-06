import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * V38 現場快速報名（沙盒可執行的靜態守則）。
 * DB 整合（實際建家戶／牌位／確認）於 Mac/staging 用測試活動執行。
 *
 * 這裡守住幾條容易回歸的關鍵規則：
 *  1. 報名成員自動帶報名人（registerActivity memberIds:[memberId]）。
 *  2. 陽上人是自由文字（不要求既有成員）——直接用 input 的 yangshangNames。
 *  3. 冤親地址＝報名人個人地址（registrantAddress）且連結報名人成員。
 *  4. 祖先／乙位正魂用各自安奉地（tabletAddress）。
 *  5. 重用既有零件，不另建第二套報名系統。
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("quickRegistration：重用既有零件（不建第二套）", () => {
  const src = read("src/lib/quickRegistration.ts");
  for (const fn of [
    "createHousehold",
    "createMemberForHousehold",
    "registerActivity",
    "createUniversalSalvationEntry",
    "registerRice",
    "syncSponsorItemInTx",
    "confirmRegistration",
  ]) {
    assert.ok(src.includes(fn), `應重用既有函式 ${fn}`);
  }
});

test("quickRegistration：報名成員自動帶報名人", () => {
  const src = read("src/lib/quickRegistration.ts");
  assert.match(src, /registerActivity\(\{[\s\S]*memberIds:\s*\[memberId\]/, "registerActivity 應帶 memberIds:[memberId]");
});

test("quickRegistration：冤親＝報名人個人地址＋連結報名人", () => {
  const src = read("src/lib/quickRegistration.ts");
  const creditor = src.slice(src.indexOf('category: "DEBT_CREDITOR"'), src.indexOf('category: "DEBT_CREDITOR"') + 400);
  assert.ok(creditor.includes("tabletAddress: registrantAddress"), "冤親地址應為 registrantAddress");
  assert.ok(creditor.includes("linkedItemMemberId: memberId"), "冤親應連結報名人成員");
  assert.ok(creditor.includes('displayName: "累世冤親債主"'), "冤親主文固定");
});

test("quickRegistration：祖先／乙位正魂用各自安奉地", () => {
  const src = read("src/lib/quickRegistration.ts");
  assert.ok(src.includes('category: "ANCESTOR_LINE"'), "應有歷代祖先");
  assert.ok(src.includes('category: "INDIVIDUAL_SOUL"'), "應有乙位正魂");
  // 兩者都以該筆 tabletAddress（安奉地）建立
  assert.match(src, /category: "ANCESTOR_LINE"[\s\S]*tabletAddress: s\(a\.tabletAddress\)/);
  assert.match(src, /category: "INDIVIDUAL_SOUL"[\s\S]*tabletAddress: s\(soul\.tabletAddress\)/);
});

test("quickRegistration：陽上人自由文字（不要求既有成員）", () => {
  const src = read("src/lib/quickRegistration.ts");
  // defaultYang 由 input 的 yangshangNames 正規化而來，留空才退回報名人姓名
  assert.ok(src.includes("normalizeYangshangNames"), "陽上人應經正規化，非查成員");
  assert.ok(src.includes("registrantName ? [registrantName] : []"), "留空時退回報名人姓名");
});

test("quick-registration API：POST 與 GET 皆有權限檢查", () => {
  const src = read("src/app/api/quick-registration/route.ts");
  const checks = src.match(/assertUniversalSalvationPermissionForOperator/g) ?? [];
  assert.ok(checks.length >= 2, "GET 與 POST 都要有權限檢查");
});
