import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePersonalAddress, displayPersonalAddress } from "../src/lib/personalAddress";

/**
 * V25 正式信眾資料權威同步——驗收測試。
 * 純函式（地址解析規則）可直接驗；DB／UI 串接以 source-scan 鎖定架構不回退。
 * 真正的 727 戶／dry-run／邱雅玲同步在本機以真實資料庫執行（見 scripts/syncDevoteesFromExcel.ts）。
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// ── 1. 個人地址優先、家戶地址僅 fallback ──
test("個人地址有值 → 顯示個人地址（不被家戶地址覆蓋）", () => {
  const r = resolvePersonalAddress("台北市士林區承德路四段181號7樓之一", "雲林縣水林鄉土厝村大庄路九之二號");
  assert.equal(r.address, "台北市士林區承德路四段181號7樓之一");
  assert.equal(r.source, "personal");
});

test("個人地址空白 → 才 fallback 顯示家戶地址（僅顯示）", () => {
  const r = resolvePersonalAddress(null, "雲林縣水林鄉土厝村大庄路九之二號");
  assert.equal(r.address, "雲林縣水林鄉土厝村大庄路九之二號");
  assert.equal(r.source, "household");
});

test("個人與家戶皆空白 → none", () => {
  assert.deepEqual(resolvePersonalAddress("  ", null), { address: null, source: "none" });
});

// ── 2/3. 同戶不同成員可各有不同個人地址（解析彼此獨立） ──
test("同一家戶不同成員可有不同個人地址（解析互不影響）", () => {
  const household = "雲林縣水林鄉土厝村大庄路九之二號";
  const a = displayPersonalAddress("台北市士林區承德路四段181號7樓之一", household);
  const b = displayPersonalAddress("台中市西區民權路100號", household);
  const c = displayPersonalAddress(null, household); // 沒填個人地址 → fallback 家戶
  assert.equal(a, "台北市士林區承德路四段181號7樓之一");
  assert.equal(b, "台中市西區民權路100號");
  assert.equal(c, household);
});

// ── 10. 邱雅玲案例 ──
test("邱雅玲：個人地址設為正式 Excel 值後，顯示與 Excel 完全一致（不再顯示雲林家戶地址）", () => {
  const excel = "台北市士林區承德路四段181號7樓之一";
  const householdWrong = "雲林縣水林鄉土厝村大庄路九之二號";
  assert.equal(displayPersonalAddress(excel, householdWrong), excel);
});

// ── 資料模型：Member 新增個人地址欄位（獨立於 Household.address） ──
test("Schema：Member 新增 address 欄位、且有 migration", () => {
  const schema = read("prisma/schema.prisma");
  assert.ok(/model Member[\s\S]*?\n\s*address String\?/.test(schema), "Member 具備 address 欄位");
  const mig = read("prisma/migrations/20260818000000_v25_member_personal_address/migration.sql");
  assert.ok(/ALTER TABLE "members" ADD COLUMN "address" TEXT/.test(mig), "migration 新增 members.address");
});

// ── 顯示層：summary 曝露 personalAddress / displayAddress ──
test("composeDevoteeSummary 曝露 personalAddress 與 displayAddress（家戶地址 fallback）", () => {
  const src = read("src/lib/devoteeProfile.ts");
  assert.ok(/personalAddress:/.test(src) && /displayAddress:/.test(src), "summary 具個人/顯示地址");
  assert.ok(/displayPersonalAddress\(/.test(src), "displayAddress 走共用 fallback 規則");
});

// ── 4. 個人地址編輯只改本人（Member.address），與家戶地址分開 ──
test("編輯：個人地址寫 Member.address、家戶地址寫 Household.address，兩者分開", () => {
  const edit = read("src/lib/devoteeBaseEdit.ts");
  assert.ok(/input\.address !== undefined/.test(edit), "個人地址寫入 memberData");
  assert.ok(/\(memberData as Record<string, unknown>\)\.address = input\.address/.test(edit), "個人地址進 Member，不進 Household");
  const route = read("src/app/api/devotee-center/[memberId]/base/route.ts");
  assert.ok(/address: "address" in body \? toNullableString\(body\.address\)/.test(route), "API 傳遞個人地址");
  const page = read("src/app/devotee-center/[memberId]/page.tsx");
  assert.ok(/address: personalAddress\.trim\(\) \|\| null/.test(page), "編輯頁送出個人地址");
  assert.ok(/家戶共用地址（全戶共用，非個人地址）/.test(page), "家戶地址欄位明確標示為家戶共用");
});

// ── 6/7. 正式信眾 Excel 匯入寫 Member.address（家戶匯入不寫個人地址；空白不覆蓋） ──
test("匯入：信眾 Excel 通訊地址 → Member.address（create 與 update 皆寫入，且空白不覆蓋）", () => {
  const batch = read("src/lib/devoteeImportBatch.ts");
  assert.ok(/address: pm\.personData\.address/.test(batch), "建立成員時寫入個人地址（來源為個人 Excel，非家戶地址）");
  assert.ok(/!\(existing as unknown as \{ address: string \| null \}\)\.address && pm\.personData\.address/.test(batch), "更新時既有為空且 Excel 有值才補（空白不覆蓋）");
  // 家戶匯入寫的是 Household.address（家戶建立），個人成員地址一律來自個人 Excel（pm.personData.address）——兩者來源分離。
  assert.ok(/id: code,[\s\S]*?address: r\.household\.address/.test(batch), "Household 建立才用 r.household.address（與 Member 個人地址分離）");
});

// ── 5. 家戶地址變更不覆蓋已有個人地址（解析：個人優先） ──
test("家戶地址變更不影響已有個人地址（解析永遠個人優先）", () => {
  const personal = "台北市士林區承德路四段181號7樓之一";
  assert.equal(displayPersonalAddress(personal, "改成任何家戶新地址"), personal);
});

// ── 8/9. 同步工具：保守配對、禁止順序/index 配對、同名多筆待確認 ──
test("同步工具：保守配對（家戶編號＋姓名／姓名唯一／生日手機縮小），同名多筆 AMBIGUOUS 不猜測", () => {
  const tool = read("scripts/syncDevoteesFromExcel.ts");
  assert.ok(/AMBIGUOUS/.test(tool) && /UNMATCHED/.test(tool), "保留待確認分類");
  assert.ok(/byHouseholdName\.get\(`\$\{code\}::\$\{p\.name\}`\)/.test(tool), "家戶編號＋姓名以 key 配對，非列序");
  assert.ok(/byName\.get\(p\.name\)/.test(tool), "無家戶編號時以姓名 key 配對");
  assert.ok(/personBirthdayKey|birthdayKey/.test(tool), "同名以生日/手機保守縮小");
  // 配對來源皆為 Map key（家戶編號/姓名/生日/手機），未使用任何 Excel 列序、陣列 index 或 findMany 回傳順序。
  assert.ok(!/persons\[\s*\w+\s*\]\s*.*members\[|memberById\.get\(.*index/.test(tool), "不以列序/index 對應 Excel↔Member");
});

// ── 5(規則). Excel 有值覆蓋、空白保留 ERP、不拿別人的值 ──
test("同步工具：Excel 有值才覆蓋、空白保留 ERP 現值（不拿家戶或別人地址）", () => {
  const tool = read("scripts/syncDevoteesFromExcel.ts");
  // 合併版：extract() 略過空值（Excel 空白不進合併結果）；只在「合併後有值且與現值不同」才更新。
  assert.ok(/if \(norm === null \|\| norm === ""\) continue;/.test(tool), "空值不進合併（Excel 空白不覆蓋）");
  assert.ok(/if \(mergedRaw\.address !== undefined && \(mergedRaw\.address as string\) !== clean\(curAddress\)\)/.test(tool), "地址：合併後有值且與現值不同才更新");
});

// ── Dry-run 預設不寫入 ──
test("同步工具：預設 dry-run 不寫入，--commit 才寫入", () => {
  const tool = read("scripts/syncDevoteesFromExcel.ts");
  assert.ok(/if \(!args\.commit\)/.test(tool) && /\[DRY-RUN\] 未寫入任何資料/.test(tool), "dry-run 不寫入");
  assert.ok(/args\.commit/.test(tool), "commit 模式受旗標控制");
});

// ── 11/12. 冪等，且不動報名/收款/收據/列印/活動 ──
test("同步工具：冪等（差異為 0 不寫入），且只碰 Member/DevoteeProfile/RecordVersion", () => {
  const tool = read("scripts/syncDevoteesFromExcel.ts");
  assert.ok(/Object\.keys\(memberUpdate\)\.length > 0 \|\| Object\.keys\(profileUpdate\)\.length > 0/.test(tool), "無差異不加入更新清單（冪等）");
  assert.ok(!/ritualRecord|paymentTransaction|\.receipt\.|purificationEntry|worshipRecord\.|household\.update|ritualRegistrationItem/i.test(tool), "不得改報名/收款/收據/普渡/牌位/家戶");
});

// ── V25.1 全畫面收斂：信眾顯示地址一律 displayAddress（個人→家戶 fallback） ──
test("信眾名單/搜尋：顯示與過濾一律用 displayAddress，不再直接用 householdAddress", () => {
  const list = read("src/app/devotee-center/list/page.tsx");
  assert.ok(/displayAddress: string \| null/.test(list), "名單列型別具 displayAddress");
  assert.ok(/\{r\.displayAddress &&/.test(list) && /\{r\.displayAddress \|\| "—"\}/.test(list), "卡片與表格顯示 displayAddress");
  assert.ok(/hasAddress = Boolean\(r\.displayAddress\)/.test(list), "完整度過濾用 displayAddress");
  assert.ok(!/\{r\.householdAddress\}/.test(list) && !/r\.householdAddress \|\| "—"/.test(list), "不再直接顯示 householdAddress");
});

test("信眾詳情：標題與完整度卡片顯示 displayAddress（個人優先）", () => {
  const page = read("src/app/devotee-center/[memberId]/page.tsx");
  assert.ok(/\{b\.displayAddress \|\| "無地址"\}/.test(page), "標題顯示個人地址（fallback 家戶）");
  assert.ok(/address=\{overview\.basic\.displayAddress\}/.test(page), "完整度卡片用 displayAddress");
});

test("牌位地址帶入順序 Excel→Member→Household：乙位正魂預填優先個人地址", () => {
  const flow = read("src/lib/soulTabletFlow.ts");
  assert.ok(/suggestedLocation: displayPersonalAddress\(/.test(flow), "個人往生者牌位帶入優先個人地址，空白才家戶");
  // 歷代祖先（家戶層級、無單一成員）維持家戶地址帶入。
  assert.ok(/suggestedLocation: household\.address \?\? null/.test(flow), "歷代祖先維持家戶地址帶入");
});

test("牌位地址帶入優先序：個人地址（devoteeAddress）排在家戶地址之前（Member→Household）", () => {
  const dc = read("src/lib/dataCompleteness.ts");
  assert.ok(/sources\.devoteeAddress,\s*\n\s*sources\.householdAddress,/.test(dc), "devoteeAddress 排在 householdAddress 之前");
  const ritual = read("src/lib/ritual.ts");
  assert.ok(/devoteeAddress, \/\/ V25：信眾個人地址/.test(ritual), "乙位正魂建立時傳入成員個人地址");
  assert.ok(/worshipRecord\.findUnique\(\{ where: \{ id: input\.worshipRecordId \}/.test(ritual), "由 worshipRecordId 解析成員");
});

test("同步工具：備註（Member.notes）納入同步、生肖/信仰狀態透明回報", () => {
  const tool = read("scripts/syncDevoteesFromExcel.ts");
  assert.ok(/memberUpdate\.notes = mergedRaw\.notes as string/.test(tool), "備註納入個人欄位同步（合併後）");
  assert.ok(/生肖：由生日換算/.test(tool), "生肖由生日換算，透明說明");
  assert.ok(/信仰：ERP schema 與正式信眾 Excel 皆無此欄位/.test(tool), "信仰無欄位，透明說明不同步");
});

// ── 補充1：新增信眾畫面 → 個人地址寫 Member.address ──
test("新增信眾：畫面有個人通訊地址欄，送出 personalAddress 並寫入 Member.address", () => {
  const modal = read("src/components/devotee/CreateDevoteeModal.tsx");
  assert.ok(/個人通訊地址（只屬於本人/.test(modal), "新增信眾畫面有個人地址欄");
  assert.ok(/personalAddress: personalAddress\.trim\(\) \|\| null/.test(modal), "payload 送出個人地址");
  assert.ok(/家戶共用地址（全戶共用，非個人地址）/.test(modal), "家戶地址明確標示為家戶共用");
  const mc = read("src/lib/memberCreate.ts");
  assert.ok(/personalAddress\?: unknown/.test(mc), "建立輸入含 personalAddress");
  assert.ok(/address: normalized\.address/.test(mc), "建立成員時寫入 Member.address");
  assert.ok(/const address = typeof input\.personalAddress === "string"/.test(mc), "個人地址正規化");
});

// ── V25.1：P2028 修正——短批次交易、冪等、可中斷重跑 ──
test("同步 commit：不再用單一長 interactive transaction，改短批次陣列交易（CHUNK=50）", () => {
  const tool = read("scripts/syncDevoteesFromExcel.ts");
  assert.ok(/const CHUNK = 50/.test(tool), "每批 50 筆");
  assert.ok(/await prisma\.\$transaction\(ops\)/.test(tool), "以陣列型 $transaction([...]) 短交易提交");
  // 不得再用「把所有更新包在單一 interactive transaction」的實際呼叫（註解說明舊法不算）。
  assert.ok(!/await prisma\.\$transaction\(async/.test(tool), "不得使用長時間 interactive transaction");
});

test("同步 commit：交易外先讀現值、無變更略過（冪等、可中斷重跑）", () => {
  const tool = read("scripts/syncDevoteesFromExcel.ts");
  assert.ok(/const curMembers = await prisma\.member\.findMany\(\{ where: \{ id: \{ in: ids \} \} \}\)/.test(tool), "交易外先讀該批現值");
  assert.ok(/batchSkipped\+\+/.test(tool) && /冪等/.test(tool), "現值一致者略過（冪等）");
  assert.ok(/equalField/.test(tool), "逐欄比對現值與 Excel 值");
});

test("同步 commit：任一批失敗→印範圍與錯誤、非 0 結束、不回滾前批", () => {
  const tool = read("scripts/syncDevoteesFromExcel.ts");
  assert.ok(/批次 \$\{rangeLabel\} 寫入失敗/.test(tool), "印出失敗批次範圍與錯誤");
  assert.ok(/process\.exit\(1\)/.test(tool), "非 0 exit code");
  assert.ok(/不回滾/.test(tool), "已成功批次不回滾（重跑冪等略過）");
});

test("同步 commit：輸出 UPDATED / SKIPPED_NO_CHANGE / FAILED 統計", () => {
  const tool = read("scripts/syncDevoteesFromExcel.ts");
  assert.ok(/UPDATED（實際更新）/.test(tool), "統計 UPDATED");
  assert.ok(/SKIPPED_NO_CHANGE（現值已一致/.test(tool), "統計 SKIPPED_NO_CHANGE");
  assert.ok(/FAILED（找不到成員/.test(tool), "統計 FAILED");
  assert.ok(/已完成（本批 更新/.test(tool), "每批輸出進度");
});

// ── V25.2：重複來源合併＋歷代祖先排除 ──
test("合併：名稱含「歷代祖先」的列完全排除（不配對/不合併/不寫入），並計數", () => {
  const tool = read("scripts/syncDevoteesFromExcel.ts");
  assert.ok(/const isAncestorRow = \(name: string\) => \(clean\(name\) \?\? ""\)\.includes\("歷代祖先"\)/.test(tool), "以名稱含「歷代祖先」判定排除");
  assert.ok(/ancestorExcluded\+\+/.test(tool) && /歷代祖先排除筆數/.test(tool), "計數並輸出歷代祖先排除筆數");
  assert.ok(/persons\.filter\(\(p\) => \{[\s\S]*?isAncestorRow\(p\.name\)/.test(tool), "排除後才進配對/合併");
});

test("合併：同一 memberId 多列先分組合併，非最後一列覆蓋", () => {
  const tool = read("scripts/syncDevoteesFromExcel.ts");
  assert.ok(/const matchedGroups = new Map<string, \{ basis: string; rows: PersonSheetRow\[\] \}>\(\)/.test(tool), "依 memberId 分組");
  assert.ok(/g\.rows\.push\(p\)/.test(tool), "同一 memberId 的多列收進同一組");
  // 每個 memberId 產生一筆 update（合併後），非逐列 push（避免最後一列覆蓋）。
  assert.ok(/for \(const \[memberId, g\] of matchedGroups\)/.test(tool), "以 memberId 群組為單位計算更新");
});

test("合併規則：唯一非空值採用；多個不同非空值→CONFLICT，不採用不寫入", () => {
  const tool = read("scripts/syncDevoteesFromExcel.ts");
  assert.ok(/if \(byValue\.size === 1\) \{[\s\S]*?mergedRaw\[key\] = e\.raw/.test(tool), "唯一非空值→採用");
  assert.ok(/conflicts\.push\(\{ field: FIELD_LABEL\[key\], values:/.test(tool), "多個不同非空值→記為 CONFLICT");
  // CONFLICT 欄位不會進 mergedRaw，故不會被寫入。
  assert.ok(/else \{\s*\n\s*conflicts\.push/.test(tool), "CONFLICT 分支不設 mergedRaw（不寫入）");
});

test("合併 dry-run 輸出：合併人數／來源列／採用欄位／衝突／歷代祖先排除／最終寫入數", () => {
  const tool = read("scripts/syncDevoteesFromExcel.ts");
  assert.ok(/合併成功人數（同一 memberId 由多列合併成一筆）/.test(tool), "輸出合併成功人數");
  assert.ok(/由 Excel 列合併：\$\{m\.sourceRows\.join/.test(tool), "輸出每人由哪些 Excel 列合併");
  assert.ok(/採用欄位：/.test(tool), "輸出採用欄位");
  assert.ok(/欄位衝突（不自動寫入）/.test(tool), "輸出欄位衝突明細");
  assert.ok(/需寫入的信眾數（合併後、每人一筆）/.test(tool), "輸出最終需寫入筆數");
});

// ── V25.2：人工決議以外部資料（--resolve JSON）帶入，非寫死的永久規則 ──
test("人工決議：由 --resolve 外部 JSON 帶入，不是寫死在程式的特例規則", () => {
  const tool = read("scripts/syncDevoteesFromExcel.ts");
  assert.ok(/argv\[i\] === "--resolve"/.test(tool), "支援 --resolve 旗標");
  assert.ok(/function loadResolutions\(/.test(tool), "由外部 JSON 載入決議");
  assert.ok(/const override = overrideFor\(key\)/.test(tool) && /mergedRaw\[key\] = override/.test(tool), "有決議值則採用（可解 CONFLICT）");
  // 不得把任何具體人工決議姓名寫死在程式碼裡（那才是永久特例）。決議屬使用者資料，不是程式。
  assert.ok(!/吳詩靜|蔡昕穎|吳淑芬|許力丹/.test(tool), "程式碼不得寫死本次人工決議的姓名");
  // 提供決議格式範本檔（.example.json）供使用者複製填寫；實際決議檔由使用者自行提供、不綁進測試。
  const example = JSON.parse(read("scripts/data/v25-devotee-resolutions.example.json")) as { resolutions: { name: string }[] };
  assert.ok(Array.isArray(example.resolutions), "範本含 resolutions 陣列");
  // 決議檔不得含歷代祖先（規則二：完全不動）。
  assert.ok(!/歷代祖先/.test(read("scripts/data/v25-devotee-resolutions.example.json")), "決議範本不含歷代祖先");
});

test("人工決議：未套用（姓名對不到）會警示，避免打錯無聲略過", () => {
  const tool = read("scripts/syncDevoteesFromExcel.ts");
  assert.ok(/未套用的人工決議（姓名對不到任何合併信眾/.test(tool), "對不到的決議會警示");
  assert.ok(/appliedResolutionNames\.add\(displayName\)/.test(tool), "套用時記錄，供比對未套用者");
});

// ── 補充2：永久維護工具（非一次性 script） ──
test("同步工具為 ERP 永久維護工具：可重複執行、npm script、資料驅動欄位", () => {
  const tool = read("scripts/syncDevoteesFromExcel.ts");
  assert.ok(/ERP 永久維護工具，非一次性 script/.test(tool), "定位為永久維護工具");
  assert.ok(/未來正式信眾 Excel 更新時/.test(tool), "說明未來 Excel 更新不需改程式");
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["sync:devotees"], "tsx scripts/syncDevoteesFromExcel.ts", "npm run sync:devotees（dry-run）");
  assert.equal(pkg.scripts["sync:devotees:commit"], "tsx scripts/syncDevoteesFromExcel.ts --commit", "npm run sync:devotees:commit");
});
