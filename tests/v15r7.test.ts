import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * V15R7 普渡 Excel 匯入中心——來源掃描（不需 DB；DB 行為見 v15r7ImportDb）。
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("匯入一律建草稿：贊普／隨喜贊普狀態改 DRAFT，不再 CONFIRMED", () => {
  const src = read("src/lib/purificationImport.ts");
  const mat = src.slice(src.indexOf("async function materializeSponsors"));
  assert.ok(!/status: "CONFIRMED"/.test(mat), "贊普物化不得 CONFIRMED");
  assert.ok((mat.match(/status: "DRAFT"/g) ?? []).length >= 2, "贊普＋隨喜贊普皆 DRAFT");
});

test("財務隔離：匯入不設 amountPaid>0、不建收款交易", () => {
  const src = read("src/lib/purificationImport.ts");
  assert.ok(!/amountPaid:\s*new Prisma\.Decimal/.test(src), "不寫入 amountPaid 金額（維持預設 0）");
});

test("永久名單同步：confirm 依 syncToHousehold 呼叫 createUniversalSalvationEntry／同步服務", () => {
  const src = read("src/lib/purificationImport.ts");
  assert.ok(src.includes("syncToHousehold: doSync"), "建立牌位時帶入 syncToHousehold");
  assert.ok(src.includes("syncEntryToHouseholdWorshipRecord"), "更新既有牌位時亦走同步服務");
  assert.ok(src.includes("isSyncableWorshipCategory"), "只對祖先／正魂同步");
});

test("DB 去重：tabletIdentityKey（category＋標準化姓名＋地址）＋SKIP/UPDATE，不默默覆蓋", () => {
  const src = read("src/lib/purificationImport.ts");
  assert.ok(src.includes("tabletIdentityKey"), "以牌位識別鍵比對既有");
  assert.ok(src.includes('existingMatchStatus'), "analyze 標記 DB 既有狀態");
  // 明確處理語意（CREATE/UPDATE/SKIP）：無既有一律 CREATE；有既有預設 SKIP、僅明確 UPDATE 才更新。
  assert.ok(/!decisionHit \? "CREATE"/.test(src), "無既有牌位一律 CREATE（不可因預設 SKIP 略過）");
  assert.ok(/ext\.resolutionAction === "UPDATE" \? "UPDATE" : "SKIP"/.test(src), "有既有：預設 SKIP、僅明確 UPDATE 才更新");
  assert.ok(src.includes("SAME_NAME_DIFF_ADDR"), "同名不同址視為不同牌位");
});

test("沿用共用底層服務（不複製計價公式、不改走 registerItemsBatch）", () => {
  const src = read("src/lib/purificationImport.ts");
  assert.ok(src.includes("createUniversalSalvationEntry"), "牌位走既有核心");
  assert.ok(src.includes("registerRice"), "白米走 registerRice");
  assert.ok(src.includes("createAdditionalPrintItem"), "寶袋走既有服務");
  assert.ok(!src.includes("registerItemsBatch"), "本單元不改走 registerItemsBatch");
});

test("schema：PurificationImportRow 純新增 4 欄位＋安全預設；migration 存在", () => {
  const schema = read("prisma/schema.prisma");
  const block = schema.slice(schema.indexOf("model PurificationImportRow"), schema.indexOf("model PurificationImportRow") + 2000);
  for (const f of ["syncToHousehold", "existingMatchStatus", "existingRecordId", "resolutionAction"]) {
    assert.ok(block.includes(f), `schema 缺欄位 ${f}`);
  }
  assert.ok(block.includes("@default(true)"), "syncToHousehold 有安全預設");
  const mig = read("prisma/migrations/20260814000000_v15r7_purification_import_dedup/migration.sql");
  assert.ok(/ADD COLUMN "syncToHousehold" BOOLEAN NOT NULL DEFAULT true/.test(mig), "migration 純新增欄位");
});

test("範本下載 route 存在；rows route 接受 syncToHousehold/resolutionAction", () => {
  assert.ok(read("src/app/api/universal-salvation/[year]/import/template/route.ts").includes("aoa_to_sheet"), "範本產生 xlsx");
  const rows = read("src/app/api/universal-salvation/[year]/import/[batchId]/rows/[rowId]/route.ts");
  assert.ok(rows.includes("syncToHousehold") && rows.includes("resolutionAction"), "rows route 接受新旗標");
});

test("預檢 UI：範本下載、同步勾選、既有徽章、處理方式選擇、已收固定 0", () => {
  const ui = read("src/components/universal-salvation/PurificationImportScreen.tsx");
  assert.ok(ui.includes("下載範本"), "有下載範本");
  assert.ok(ui.includes("同步永久名單"), "祖先/正魂同步勾選");
  assert.ok(ui.includes("EXISTING_LABEL"), "既有牌位徽章");
  assert.ok(ui.includes("更新既有牌位") && ui.includes("已存在，略過"), "處理方式選擇");
  assert.ok(ui.includes("固定 0 元"), "已收固定 0");
});

test("效能：唯讀與決策移出交易、SKIP 不開交易、record 預建；交易內只留寫入", () => {
  const src = read("src/lib/purificationImport.ts");
  const confirm = src.slice(src.indexOf("export async function confirmPurificationImportBatch"));
  // 地址解析＋DB 去重在「Phase A（交易外）」用 prisma（非 tx）。
  assert.ok(/Phase A（interactive transaction 外，純唯讀）/.test(confirm), "唯讀決策移到交易外");
  // 既有家戶的今年 record 於交易外預建一次。
  assert.ok(confirm.includes("preResolvedHhIds"), "record 於交易外預建（每戶一次）");
  // SKIP 用 prisma（非 tx）單一寫入，不開 interactive transaction。
  assert.ok(/不需 interactive transaction，只更新草稿列/.test(confirm), "SKIP 不開交易");
  // 交易內不再做 DB 去重 findMany（改在 Phase A）。
  const txBlock = confirm.slice(confirm.indexOf("Phase B"), confirm.indexOf("catch (e)"));
  assert.ok(!/tx\.universalSalvationEntry\.findMany/.test(txBlock), "交易內不再做去重 findMany");
  assert.ok(!/tx\.household\.findUnique/.test(txBlock), "交易內不再查家戶地址");
  // 交易上限沿用 registerItemsBatch 慣例（非以 timeout 掩蓋，已先縮短工作）。
  assert.ok(/timeout: 20000/.test(confirm), "設定合理交易上限");
});

test("找不到配對不得自動建立：仍需 createNew*Confirmed 明確勾選", () => {
  const src = read("src/lib/purificationImport.ts");
  assert.ok(src.includes("createNewHouseholdConfirmed") && src.includes("createNewDevoteeConfirmed"), "建新家戶/信眾需明確確認");
  assert.ok(src.includes("尚未指定家戶，且未明確確認建立新家戶"), "未確認不得自動建戶");
});
