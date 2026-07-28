import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  splitMultiValue,
  annotateTabletRoutedColumns,
  forwardFillAndGroupHouseholdRows,
  classifyTabletType,
  decodeTabletMeta,
  TABLET_ROUTED_COLUMNS,
} from "../src/lib/devoteeImportNormalize";
import { classifyAllMembers, normalizeAndValidateDevoteeRow } from "../src/lib/devoteeImportValidate";
import { suggestColumnMappingPure, applyCanonicalDevoteeHouseholdMapping } from "../src/lib/importFieldSuggestion";
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

test("根因修正：陳舊/錯誤欄位記憶不得阻斷正式七欄——canonical 覆蓋家戶成員/祖先/正魂對應", () => {
  // 模擬 suggestColumnMapping 因舊記憶把「家戶成員」錯對成 memberCount、把「歷代祖先/乙位正魂」對成 null。
  const staleSuggested: Record<string, string | null> = {
    家戶編號: "householdCode", 戶名: "householdName", 主要聯絡人: "primaryContact", 地址: "address",
    家戶成員: "memberCount", 歷代祖先: null, 乙位正魂: null,
  };
  const noManual: Record<string, string | null> = {};
  const fixed = applyCanonicalDevoteeHouseholdMapping(HOUSEHOLD_7, staleSuggested, noManual);
  assert.equal(fixed["家戶成員"], "householdMembers", "覆蓋錯誤記憶→正確對應成員欄");
  assert.equal(fixed["歷代祖先"], "ancestors");
  assert.equal(fixed["乙位正魂"], "spirits");
  // 使用者這次手動改過的欄，尊重其選擇（不覆蓋）。
  const withManual = applyCanonicalDevoteeHouseholdMapping(HOUSEHOLD_7, staleSuggested, { 家戶成員: "memberCount" });
  assert.equal(withManual["家戶成員"], "memberCount", "使用者本次手動選擇不被覆蓋");
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

test("正式七欄不得因缺「所有成員」阻擋：家戶成員空白仍可匯入（警告而非 blocking error）", () => {
  const mapping = suggestColumnMappingPure("DEVOTEE_PRECHECK", HOUSEHOLD_7, {});
  const raw = { 家戶編號: "F00727", 戶名: "空戶", 主要聯絡人: "", 地址: "", 歷代祖先: "", 乙位正魂: "", 家戶成員: "" };
  const r = normalizeAndValidateDevoteeRow(raw, mapping, 1);
  assert.equal(r.missingFieldErrors.length, 0, "不得產生 missingFieldError（不阻擋）");
  assert.ok(!r.missingFieldErrors.some((e) => e.includes("所有成員")), "不得再要求「所有成員」");
  assert.ok(r.warnings.some((w) => w.includes("待補成員")), "改以待補成員警告呈現");
  assert.deepEqual([r.memberNames.length, r.ancestorNames.length, r.spiritNames.length], [0, 0, 0]);
});

test("家戶成員為正式主來源：三欄有資料時不看「所有成員」", () => {
  const cols = [...HOUSEHOLD_7, "所有成員"];
  const mapping = suggestColumnMappingPure("DEVOTEE_PRECHECK", cols, {});
  const raw = { 家戶編號: "F1", 戶名: "王家", 家戶成員: "王大明,王小明", 歷代祖先: "", 乙位正魂: "", 所有成員: "不該採用甲,不該採用乙" };
  const r = normalizeAndValidateDevoteeRow(raw, mapping, 1);
  assert.deepEqual(r.memberNames, ["王大明", "王小明"], "以正式家戶成員為準，不採用舊『所有成員』");
});

test("無效牌位略過：只有模糊標籤且無姓名/地址一律略過該筆牌位，不影響家戶與成員", () => {
  const mapping = suggestColumnMappingPure("DEVOTEE_PRECHECK", HOUSEHOLD_7, {});
  const raw = { 家戶編號: "F2", 戶名: "李家", 地址: "", 歷代祖先: "歷代祖先", 乙位正魂: "李阿祖 乙位正魂", 家戶成員: "李大同" };
  const r = normalizeAndValidateDevoteeRow(raw, mapping, 1);
  assert.deepEqual(r.ancestorNames, [], "模糊標籤『歷代祖先』且無地址→略過");
  assert.deepEqual(r.spiritNames, ["李阿祖 乙位正魂"], "有牌位姓名→保留");
  assert.equal(r.skippedTablets.length, 1);
  assert.equal(r.memberNames.length, 1, "家戶成員不受影響");
  assert.equal(r.missingFieldErrors.length, 0, "不阻擋整戶");
});

test("模糊標籤但有家戶地址→保留（地址視為牌位地址，三者任一有內容即保留）", () => {
  const mapping = suggestColumnMappingPure("DEVOTEE_PRECHECK", HOUSEHOLD_7, {});
  const raw = { 家戶編號: "F3", 戶名: "陳家", 地址: "台北市大同區", 歷代祖先: "歷代祖先", 乙位正魂: "", 家戶成員: "陳一" };
  const r = normalizeAndValidateDevoteeRow(raw, mapping, 1);
  assert.deepEqual(r.ancestorNames, ["歷代祖先"], "有地址→保留");
  assert.equal(r.skippedTablets.length, 0);
});

test("主要聯絡人成為可搜尋成員：未列於家戶成員時補入；已列於名單時不重複", () => {
  const mapping = suggestColumnMappingPure("DEVOTEE_PRECHECK", HOUSEHOLD_7, {});
  // 未列於家戶成員 → 補入
  const r1 = normalizeAndValidateDevoteeRow({ 家戶編號: "F10", 戶名: "王家", 主要聯絡人: "王大明", 家戶成員: "王小明", 歷代祖先: "", 乙位正魂: "" }, mapping, 1);
  assert.ok(r1.memberNames.includes("王大明") && r1.memberNames.includes("王小明"), "主要聯絡人補為成員");
  // 已列於家戶成員 → 不重複
  const r2 = normalizeAndValidateDevoteeRow({ 家戶編號: "F11", 戶名: "李家", 主要聯絡人: "李大同", 家戶成員: "李大同,李二", 歷代祖先: "", 乙位正魂: "" }, mapping, 1);
  assert.deepEqual(r2.memberNames, ["李大同", "李二"], "已在名單內不重複建立");
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

// ============================================================
// V24 牌位遺失根因修正：牌位類型路由（一列一牌位 → 歷代祖先／乙位正魂）
// ============================================================

test("牌位類型分類：歷代祖先→ancestor、個人往生者/乙位正魂/往生→spirit、其餘/空白→member", () => {
  assert.equal(classifyTabletType("歷代祖先"), "ancestor");
  assert.equal(classifyTabletType("個人往生者"), "spirit");
  assert.equal(classifyTabletType("乙位正魂"), "spirit");
  assert.equal(classifyTabletType("往生者"), "spirit");
  assert.equal(classifyTabletType(""), "member");
  assert.equal(classifyTabletType("在世"), "member");
  assert.equal(classifyTabletType(null), "member");
});

/**
 * 模擬 analyze route 在有「牌位類型」欄時建立的欄位對應：家戶層級用真實欄，
 * 成員／祖先／乙位正魂／牌位隨附資料一律由合成路由欄提供。
 */
function tabletRoutedMapping(): Record<string, string | null> {
  return {
    家戶編號: "householdCode",
    戶名: "householdName",
    地址: "address",
    [TABLET_ROUTED_COLUMNS.members]: "householdMembers",
    [TABLET_ROUTED_COLUMNS.ancestors]: "ancestors",
    [TABLET_ROUTED_COLUMNS.spirits]: "spirits",
    [TABLET_ROUTED_COLUMNS.meta]: "tabletMeta",
  };
}

test("牌位類型路由（一列一牌位、合併儲存格一戶多列）：Preview 統計不再全 0", () => {
  // 一戶三列：在世成員一列＋歷代祖先一列＋個人往生者一列。家戶欄僅第一列有值（合併儲存格）。
  const rawRows = [
    { 家戶編號: "F001", 戶名: "許家", 地址: "台北市中山區1號", 姓名: "許大明", 牌位類型: "", 牌位顯示名稱: "", 陽上姓名: "", 安奉地: "" },
    { 家戶編號: "", 戶名: "", 地址: "", 姓名: "", 牌位類型: "歷代祖先", 牌位顯示名稱: "許姓歷代祖先", 陽上姓名: "許春榮", 安奉地: "本宮 A 區 1 號" },
    { 家戶編號: "", 戶名: "", 地址: "", 姓名: "", 牌位類型: "個人往生者", 牌位顯示名稱: "許大祖 乙位正魂", 陽上姓名: "許淑澄 許志慶", 安奉地: "本宮 B 區 2 號" },
  ];

  const enabled = annotateTabletRoutedColumns(rawRows);
  assert.equal(enabled, true, "偵測到『牌位類型』欄，啟用牌位路由");

  const mapping = tabletRoutedMapping();
  const grouped = forwardFillAndGroupHouseholdRows(rawRows, mapping);
  assert.equal(grouped.rows.length, 1, "三列合併為一戶");

  const r = normalizeAndValidateDevoteeRow(grouped.rows[0].raw, mapping, 2);
  // Preview 統計：家庭成員 1 / 歷代祖先 1 / 乙位正魂 1，皆不為 0（核心驗收）。
  assert.deepEqual(r.memberNames, ["許大明"], "在世成員");
  assert.deepEqual(r.ancestorNames, ["許姓歷代祖先"], "歷代祖先 +1");
  assert.deepEqual(r.spiritNames, ["許大祖 乙位正魂"], "乙位正魂 +1");
  assert.notEqual(r.ancestorNames.length, 0);
  assert.notEqual(r.spiritNames.length, 0);
  assert.equal(r.household.code, "F001");
  assert.equal(r.household.name, "許家");
});

test("牌位隨附資料：陽上姓名原文保留（不刪除/不重組）、安奉地→tabletAddress，依 displayName 對應", () => {
  const rawRows = [
    { 家戶編號: "F002", 戶名: "林家", 地址: "新北市板橋區", 姓名: "", 牌位類型: "歷代祖先", 牌位顯示名稱: "林姓歷代祖先", 陽上姓名: "林淑澄 林志慶", 安奉地: "本宮 C 區 3 號" },
    { 家戶編號: "", 戶名: "", 地址: "", 姓名: "", 牌位類型: "個人往生者", 牌位顯示名稱: "林大祖 乙位正魂", 陽上姓名: "林春榮", 安奉地: "" },
  ];
  annotateTabletRoutedColumns(rawRows);
  const mapping = tabletRoutedMapping();
  const grouped = forwardFillAndGroupHouseholdRows(rawRows, mapping);
  const r = normalizeAndValidateDevoteeRow(grouped.rows[0].raw, mapping, 2);

  assert.equal(r.tabletMeta.length, 2, "兩筆牌位隨附資料");
  const anc = r.tabletMeta.find((m) => m.displayName === "林姓歷代祖先");
  assert.ok(anc);
  assert.equal(anc!.type, "ancestor");
  assert.equal(anc!.yangshang, "林淑澄 林志慶", "多位陽上以空白分隔，原文保留不重組");
  assert.equal(anc!.address, "本宮 C 區 3 號", "安奉地原文保留");
  const spr = r.tabletMeta.find((m) => m.displayName === "林大祖 乙位正魂");
  assert.ok(spr);
  assert.equal(spr!.yangshang, "林春榮");
  assert.equal(spr!.address, "", "安奉地空白時維持空字串（待補，不推測）");
});

test("牌位隨附資料 base64 編碼可還原，且不被頓號/逗號分隔符破壞", () => {
  // 直接驗證 decodeTabletMeta 對「多筆頓號串接」的還原（forwardFill 串接後的形狀）。
  const rawRows: Record<string, unknown>[] = [
    { 牌位類型: "歷代祖先", 牌位顯示名稱: "陳姓歷代祖先", 陽上姓名: "陳一, 陳二", 安奉地: "D 區、E 區" },
  ];
  annotateTabletRoutedColumns(rawRows);
  const tokenA = String(rawRows[0][TABLET_ROUTED_COLUMNS.meta]);
  const tokenB = String(rawRows[0][TABLET_ROUTED_COLUMNS.meta]);
  const decoded = decodeTabletMeta(`${tokenA}、${tokenB}`);
  assert.equal(decoded.length, 2);
  // 陽上/安奉地即使含逗號、頓號，也能完整還原（base64 不含這些分隔符）。
  assert.equal(decoded[0].yangshang, "陳一, 陳二");
  assert.equal(decoded[0].address, "D 區、E 區");
});

test("無牌位類型欄（正式七欄清單格式）：annotate 回 false，維持既有三欄清單路徑", () => {
  const rawRows = [{ 家戶編號: "F1", 戶名: "王家", 家戶成員: "王大明", 歷代祖先: "", 乙位正魂: "" }];
  assert.equal(annotateTabletRoutedColumns(rawRows), false, "無牌位類型欄→不啟用路由，不影響既有格式");
});

test("正式匯入寫入 WorshipRecord.yangshangName／location（陽上＋安奉地落地）", () => {
  const batch = read("src/lib/devoteeImportBatch.ts");
  assert.ok(/yangshangName: tabletYangshang\(displayName\)/.test(batch), "祖先／乙位正魂建立時帶入陽上姓名");
  assert.ok(/buildTabletYangshang/.test(batch), "陽上姓名於預檢階段落地供 commit 使用");
});

// ============================================================
// V24.2 確認匯入頁「永久載入中」根因修正
// ============================================================

test("commit-preview 效能：改為批次查詢（in: codes），不再逐戶查詢造成數百次來回", () => {
  const batch = read("src/lib/devoteeImportBatch.ts");
  const fn = batch.slice(batch.indexOf("export async function getCommitPreview"), batch.indexOf("export async function getCommitPreview") + 2600);
  // 既有成員／牌位改用 in: codes 一次撈回
  assert.ok(/member\.findMany\(\{\s*where:\s*\{\s*householdId:\s*\{\s*in:\s*codes\s*\}/.test(fn), "成員以 in: codes 批次查詢");
  assert.ok(/worshipRecord\.findMany\(\{\s*where:\s*\{\s*householdId:\s*\{\s*in:\s*codes\s*\}/.test(fn), "牌位以 in: codes 批次查詢");
  // 不得再於逐戶迴圈內查詢（householdId: code 的單戶查詢）
  assert.ok(!/householdId:\s*code\s*,\s*deletedAt/.test(fn), "不得逐戶查詢成員");
});

// ============================================================
// V24.3 正式匯入 Transaction 逾時根因修正（批次寫入）
// ============================================================

test("commit：改為 createMany 批次寫入，交易內不再逐戶逐筆 create", () => {
  const batch = read("src/lib/devoteeImportBatch.ts");
  const commitFn = batch.slice(batch.indexOf("export async function commitDevoteeImport"));
  // 批次寫入：家戶／成員／個資／牌位／稽核各一次 createMany
  assert.ok(/tx\.household\.createMany/.test(commitFn), "家戶 createMany");
  assert.ok(/tx\.member\.createMany/.test(commitFn), "成員 createMany");
  assert.ok(/tx\.worshipRecord\.createMany/.test(commitFn), "牌位 createMany");
  assert.ok(/tx\.devoteeProfile\.createMany/.test(commitFn), "個資 createMany");
  assert.ok(/tx\.recordVersion\.createMany/.test(commitFn), "版本紀錄一次批次寫入");
  // 批次預查以 in: codes 取代逐戶查詢
  assert.ok(/householdId:\s*\{\s*in:\s*codes\s*\}/.test(commitFn), "成員／牌位以 in: codes 批次預查");
  // 仍維持單一 $transaction（整批原子性）
  assert.ok(/prisma\.\$transaction\(/.test(commitFn), "仍在單一交易內，維持整批成功或整批回滾");
});

test("commit：每批戶數放大且逾時非用來掩蓋逐筆（DEFAULT_COMMIT_CHUNK_SIZE=200）", () => {
  const batch = read("src/lib/devoteeImportBatch.ts");
  assert.ok(/DEFAULT_COMMIT_CHUNK_SIZE = 200/.test(batch), "每批 200 戶（批次往返與戶數無關）");
});

test("residual 檢查腳本存在且為唯讀（不刪除）", () => {
  const script = read("scripts/checkImportBatchResidual.ts");
  assert.ok(/cms4608m900kh9k8tixts47fi/.test(script), "預設檢查指定失敗批次");
  assert.ok(!/\.delete\(|\.deleteMany\(|deletedAt:\s*new Date/.test(script), "腳本不得執行刪除/軟刪除");
});

test("前端 commit-preview：以請求識別碼防止過期/重複請求覆蓋狀態，且有重試按鈕", () => {
  const wiz = read("src/components/system-center/DevoteeImportWizard.tsx");
  assert.ok(/commitPreviewReqRef/.test(wiz), "使用請求識別碼 ref");
  assert.ok(/commitPreviewReqRef\.current !== reqId/.test(wiz), "非最新請求則丟棄結果，不覆蓋較新狀態");
  assert.ok(/if \(loadingCommitPreview\) return;/.test(wiz), "載入中不重複發送同一 batch");
  assert.ok(/onClick=\{\(\) => loadCommitPreview\(\)\}/.test(wiz), "錯誤時提供重試按鈕");
  // loading 關閉必須交給最新請求（避免過期請求把 loading 卡住或錯誤關閉）
  assert.ok(/if \(commitPreviewReqRef\.current === reqId\) setLoadingCommitPreview\(false\)/.test(wiz), "只有最新請求負責關閉 loading");
});
