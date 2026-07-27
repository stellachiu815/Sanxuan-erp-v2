import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitMultiValue } from "../src/lib/devoteeImportNormalize";
import { classifyAllMembers, normalizeAndValidateDevoteeRow } from "../src/lib/devoteeImportValidate";
import { suggestColumnMappingPure } from "../src/lib/importFieldSuggestion";
import { normalizeMemberRole } from "../src/lib/memberRoleNormalize";
import { parsePersonSheet } from "../src/lib/devoteeImportPersonSheet";

/**
 * V24 正式匯入（家戶七欄一列一戶＋信眾九欄一列一人）——解析器驗收（沙盒可執行）。
 * DB 交易行為在 Mac 上以真實 Postgres 驗收；這裡驗證解析/分類/對照/角色正規化。
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const HOUSEHOLD_7 = ["家戶編號", "戶名", "主要聯絡人", "地址", "歷代祖先", "乙位正魂", "家戶成員"];

test("多值分隔：半形逗號/全形逗號/頓號/換行皆可，Trim 且排除空字串，姓名內容不變", () => {
  assert.deepEqual(splitMultiValue("王大明, 王小明，李美,、陳阿花\n林志明 "), ["王大明", "王小明", "李美", "陳阿花", "林志明"]);
  assert.deepEqual(splitMultiValue("  "), []);
  assert.deepEqual(splitMultiValue("周晉萬 乙位正魂"), ["周晉萬 乙位正魂"], "不得改寫姓名內容");
});

test("家戶七欄自動對照：DEVOTEE_PRECHECK 直接認得七欄", () => {
  const mapping = suggestColumnMappingPure("DEVOTEE_PRECHECK", HOUSEHOLD_7, {});
  assert.equal(mapping["家戶編號"], "householdCode");
  assert.equal(mapping["戶名"], "householdName");
  assert.equal(mapping["主要聯絡人"], "primaryContact");
  assert.equal(mapping["地址"], "address");
  assert.equal(mapping["歷代祖先"], "ancestors");
  assert.equal(mapping["乙位正魂"], "spirits");
  assert.equal(mapping["家戶成員"], "householdMembers");
});

test("三獨立清單欄（一列一戶）：家戶成員→成員、歷代祖先/乙位正魂→牌位，不誤建成員", () => {
  const mapping = suggestColumnMappingPure("DEVOTEE_PRECHECK", HOUSEHOLD_7, {});
  const raw = {
    家戶編號: "F00001",
    戶名: "王家",
    主要聯絡人: "王大明",
    地址: "台北市中山區",
    歷代祖先: "王姓歷代祖先",
    乙位正魂: "王阿祖 乙位正魂,王二叔 乙位正魂",
    家戶成員: "王大明、王小明,王小美",
  };
  const r = normalizeAndValidateDevoteeRow(raw, mapping, 1);
  assert.deepEqual(r.memberNames, ["王大明", "王小明", "王小美"]);
  assert.deepEqual(r.ancestorNames, ["王姓歷代祖先"]);
  assert.deepEqual(r.spiritNames, ["王阿祖 乙位正魂", "王二叔 乙位正魂"]);
  assert.equal(r.missingFieldErrors.length, 0);
});

test("空白清單：某類無資料時為空陣列，不報錯（只要有任一類成員即可）", () => {
  const mapping = suggestColumnMappingPure("DEVOTEE_PRECHECK", HOUSEHOLD_7, {});
  const raw = { 家戶編號: "F00002", 戶名: "李家", 主要聯絡人: "", 地址: "", 歷代祖先: "", 乙位正魂: "", 家戶成員: "李大同" };
  const r = normalizeAndValidateDevoteeRow(raw, mapping, 1);
  assert.deepEqual(r.memberNames, ["李大同"]);
  assert.deepEqual(r.ancestorNames, []);
  assert.deepEqual(r.spiritNames, []);
  assert.equal(r.missingFieldErrors.length, 0);
});

test("同戶多人＋同格重複姓名去重（避免重複建立）", () => {
  const mapping = suggestColumnMappingPure("DEVOTEE_PRECHECK", HOUSEHOLD_7, {});
  const raw = { 家戶編號: "F00003", 戶名: "陳家", 家戶成員: "陳一,陳一,陳二", 歷代祖先: "", 乙位正魂: "" };
  const r = normalizeAndValidateDevoteeRow(raw, mapping, 1);
  assert.deepEqual(r.memberNames, ["陳一", "陳二"]);
});

test("向後相容：舊「所有成員」混合欄仍可用（依名稱分類）", () => {
  const cols = ["家戶編號", "戶名", "所有成員"];
  const mapping = suggestColumnMappingPure("DEVOTEE_PRECHECK", cols, {});
  assert.equal(mapping["所有成員"], "allMembers");
  const c = classifyAllMembers("周財寶,陳秀珍,王姓歷代祖先,周晉萬 乙位正魂");
  assert.deepEqual(c.memberNames, ["周財寶", "陳秀珍"]);
  assert.deepEqual(c.ancestorNames, ["王姓歷代祖先"]);
  assert.deepEqual(c.spiritNames, ["周晉萬 乙位正魂"]);
});

test("信眾檔：身份→role、聯絡電話→phone、通訊地址→address；年齡不作為權威值", () => {
  const rows = parsePersonSheet([
    { 家戶編號: "F00001", 姓名: "王大明", 性別: "男", 身份: "戶長", 聯絡電話: "0912345678", 通訊地址: "台北市", 國曆生日: "1958-03-12", 年齡: "67" },
  ]);
  const p = rows[0];
  assert.equal(p.role, "HOUSEHOLD_HEAD");
  assert.equal(p.phone, "0912345678");
  assert.equal(p.address, "台北市");
  assert.equal(p.gender, "男");
  assert.ok(!("age" in p), "年齡不存為權威欄位");
});

test("身份正規化：對得上回 enum，對不上/空白回 null（不猜測）", () => {
  assert.equal(normalizeMemberRole("戶長"), "HOUSEHOLD_HEAD");
  assert.equal(normalizeMemberRole("配偶"), "SPOUSE");
  assert.equal(normalizeMemberRole("女兒"), "DAUGHTER");
  assert.equal(normalizeMemberRole(""), null);
  assert.equal(normalizeMemberRole("外甥女婿"), null);
});

test("唯一正式匯入入口：舊 /import 導向 /system-center/data-import，不形成第二入口", () => {
  const oldPage = read("src/app/import/page.tsx");
  assert.ok(oldPage.includes("redirect") && oldPage.includes("/system-center/data-import"), "舊 /import 導向新入口");
  assert.ok(!oldPage.includes("ImportUploader"), "舊 16 欄上傳畫面不再呈現");
});

test("身份→role 於正式匯入串接（create/update 皆帶入，且更新不覆蓋既有特定身份）", () => {
  const batch = read("src/lib/devoteeImportBatch.ts");
  assert.ok(/role: pm\.personData\.role/.test(batch), "create/update 帶入 role");
  assert.ok(/existing\.role === "OTHER"/.test(batch), "既有為預設 OTHER 才補、不覆蓋特定身份");
});
