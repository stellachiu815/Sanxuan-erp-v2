import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeSponsorAmount } from "../src/lib/sponsorPricing";

/**
 * V15R2 收斂修正測試（沙盒可執行）：
 *  一、讀取純化——listRegisteredItems 不得 create/update/upsert。
 *  二、贊普／隨喜贊普各自獨立、自身計價，後端重算金額。
 * DB 整合（實際建立 item、收款加總、READONLY 403）見 Mac/staging 執行。
 */

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** 取出某個 `export async function NAME(` 到下一個頂層 `\nexport ` 之間的原始碼片段。 */
function funcBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `找不到函式 ${name}`);
  const after = src.indexOf("\nexport ", start + 1);
  return src.slice(start, after === -1 ? undefined : after);
}

// ── 二、贊普金額純函式：數量 × 單價，後端唯一計算來源 ──────────────

test("贊普金額＝數量 × 單價（後端重算）", () => {
  assert.equal(computeSponsorAmount(true, 2, 800), 1600);
  assert.equal(computeSponsorAmount(true, 1, 1200), 1200);
  assert.equal(computeSponsorAmount(true, 3, 500), 1500);
});

test("贊普金額邊界：未勾贊普／單價缺漏／單價<0／數量<1／NaN → 0（不 NaN）", () => {
  assert.equal(computeSponsorAmount(false, 2, 800), 0); // 未勾贊普
  assert.equal(computeSponsorAmount(true, 2, null), 0); // 單價缺漏
  assert.equal(computeSponsorAmount(true, 2, undefined), 0);
  assert.equal(computeSponsorAmount(true, 0, 800), 0); // 數量 < 1
  assert.equal(computeSponsorAmount(true, -1, 800), 0);
  assert.equal(computeSponsorAmount(true, 2, -5), 0); // 單價 < 0
  assert.equal(computeSponsorAmount(true, Number.NaN, 800), 0);
  assert.equal(computeSponsorAmount(true, 2, Number.NaN), 0);
  assert.ok(!Number.isNaN(computeSponsorAmount(true, Number.NaN, Number.NaN)));
});

test("贊普數量取整數（無條件捨去到整數份）", () => {
  assert.equal(computeSponsorAmount(true, 2.9, 800), 1600); // floor(2.9)=2
});

// ── 一、讀取純化：listRegisteredItems 不得寫入資料庫 ────────────────

test("listRegisteredItems 為純讀取（不含 create/update/upsert，不呼叫整理/補建）", () => {
  const src = read("src/lib/registrationItemRegistration.ts");
  const body = funcBody(src, "listRegisteredItems");
  for (const forbidden of [".create(", ".update(", ".updateMany(", ".upsert(", ".delete(", ".deleteMany("]) {
    assert.equal(body.includes(forbidden), false, `listRegisteredItems 不應包含 ${forbidden}`);
  }
  assert.equal(body.includes("cleanupDuplicateDraftItems("), false, "讀取不得整理重複草稿（寫入）");
  assert.equal(body.includes("ensureSponsorItemFromDetail("), false, "讀取不得補建贊普 item（寫入）");
});

test("已移除讀取時補建贊普函式（ensureSponsorItemFromDetail 不存在）", () => {
  const src = read("src/lib/registrationItemRegistration.ts");
  assert.equal(src.includes("function ensureSponsorItemFromDetail"), false);
});

// ── 二、贊普 item-based 且在寫入 transaction 建立；不共用 Detail、不依順序 ──

test("syncSponsorItemInTx 以 transaction client 執行、可處理兩種 sponsor key，且由 updateUniversalSalvationDetail 於交易內呼叫", () => {
  const reg = read("src/lib/registrationItemRegistration.ts");
  assert.equal(/export async function syncSponsorItemInTx\(\s*tx: Prisma\.TransactionClient/.test(reg), true);
  // 泛化為 itemKey，可建立 US_SPONSOR 與 US_SPONSOR_DONATION 各自一筆自身計價 item。
  assert.equal(reg.includes("itemKey: SponsorItemKey"), true);
  const ritual = read("src/lib/ritual.ts");
  assert.equal(ritual.includes("syncSponsorItemInTx(tx, {"), true, "應在 $transaction 內以 tx 呼叫");
  assert.equal(ritual.includes('itemKey: "US_SPONSOR"'), true, "贊普由 US_SPONSOR 建立");
  assert.equal(ritual.includes('itemKey: "US_SPONSOR_DONATION"'), true, "隨喜贊普由 US_SPONSOR_DONATION 建立");
  // 未收款才轉 item（避免破壞已收款舊資料）。
  assert.equal(ritual.includes("sponsorPaid === 0"), true);
  // 隨喜贊普只在有帶欄位（donationTouched）時處理，未動則不影響既有隨喜贊普。
  assert.equal(ritual.includes("donationTouched"), true);
});

test("隨喜贊普有完整寫入路徑：input／route／form 都串起來（大額自由金額，非只靠匯入）", () => {
  const ritual = read("src/lib/ritual.ts");
  // service input 具備 donation 自由金額欄位。
  for (const f of ["isDonation?", "donationName?", "donationAmount?"]) {
    assert.equal(ritual.includes(f), true, `UpdateUniversalSalvationDetailInput 需含 ${f}`);
  }
  const route = read("src/app/api/households/[id]/rituals/universal-salvation/[year]/route.ts");
  assert.equal(route.includes('"isDonation" in body'), true, "PATCH route 需解析 donation 欄位");
  assert.equal(route.includes("input.donationAmount"), true);
  const form = read("src/components/ritual/UniversalSalvationDetailForm.tsx");
  assert.equal(form.includes("隨喜贊普"), true, "編輯頁需有隨喜贊普區塊");
  assert.equal(form.includes("donationDirty"), true, "未操作隨喜贊普區則不送出、不影響既有資料");
  assert.equal(form.includes("donationAmount"), true, "隨喜贊普＝自由金額輸入");
});

test("一般贊普固定價：後端用年度固定價、不信任前端 sponsorUnitPrice；FREE/FIXED 分流", () => {
  const ritual = read("src/lib/ritual.ts");
  // 後端讀年度固定價，US_SPONSOR 走 FIXED、隨喜贊普走 FREE。
  assert.equal(ritual.includes("getUniversalSalvationSponsorPrice(year)"), true, "後端讀年度固定價");
  assert.equal(/itemKey: "US_SPONSOR",[\s\S]*?pricing: \{ mode: "FIXED", quantity: qty, fixedUnitPrice: yearSponsorPrice \}/.test(ritual), true, "US_SPONSOR＝FIXED＋年度固定價");
  assert.equal(/itemKey: "US_SPONSOR_DONATION",[\s\S]*?pricing: \{ mode: "FREE", amount: donationAmount \}/.test(ritual), true, "隨喜贊普＝FREE 自由金額");
  const reg = read("src/lib/registrationItemRegistration.ts");
  const fn = reg.slice(reg.indexOf("export async function syncSponsorItemInTx"), reg.indexOf("export async function listRegisteredItems"));
  // FIXED：新建用 fixedUnitPrice；既有未收款沿用原鎖定價快照；缺價丟錯。
  assert.equal(fn.includes("params.pricing.fixedUnitPrice"), true);
  assert.equal(fn.includes("keeper.lockedUnitPrice"), true, "既有未收款沿用原鎖定價快照");
  assert.equal(fn.includes("尚未設定"), true, "年度固定價缺漏丟明確錯誤");
  // FREE：quantity=1、lockedUnitPrice=金額。
  assert.equal(fn.includes('params.pricing.mode === "FIXED"'), true);
  const form = read("src/components/ritual/UniversalSalvationDetailForm.tsx");
  // 前端一般贊普單價唯讀（readOnly 顯示固定單價），不提供可自由修改的 sponsorUnitPrice 輸入。
  assert.equal(form.includes("固定單價（依年度設定）"), true, "一般贊普單價唯讀顯示");
  assert.equal(form.includes("setSponsorUnitPrice"), false, "不得再有可自由修改的贊普單價輸入");
  // 前端不再送出 sponsorUnitPrice（後端亦不採用）。
  assert.equal(/sponsorUnitPrice: isSponsor/.test(form), false, "前端不再送出贊普單價");
});

test("US_SPONSOR 姓名保存實際 sponsorName、不再固定「本人」", () => {
  const reg = read("src/lib/registrationItemRegistration.ts");
  // syncSponsorItemInTx 一律保存實際姓名（不再 || member?.name、不存「本人」）。
  assert.equal(reg.includes('const name = (params.customName ?? "").trim() || null;'), true, "姓名一律取實際輸入，空白存 null");
  assert.equal(reg.includes('customName: "本人"'), false, "不得再寫死「本人」");
  const ritual = read("src/lib/ritual.ts");
  // updateUniversalSalvationDetail 把 sponsorName 傳入 US_SPONSOR 的 customName。
  assert.equal(/itemKey: "US_SPONSOR",[\s\S]*?customName: input\.sponsorName/.test(ritual), true, "US_SPONSOR customName＝input.sponsorName");
});

test("sponsorName 完整資料流（input type／PATCH route／表單姓名欄位）", () => {
  const ritual = read("src/lib/ritual.ts");
  assert.equal(ritual.includes("sponsorName?: string | null"), true, "UpdateUniversalSalvationDetailInput 需含 sponsorName");
  const route = read("src/app/api/households/[id]/rituals/universal-salvation/[year]/route.ts");
  assert.equal(route.includes('"sponsorName" in body'), true, "PATCH route 需解析 sponsorName");
  assert.equal(route.includes("input.sponsorName = toNullableString"), true);
  const form = read("src/components/ritual/UniversalSalvationDetailForm.tsx");
  assert.equal(form.includes("sponsorName"), true, "表單需有贊普姓名欄位");
  assert.equal(/sponsorName: isSponsor \? sponsorName\.trim\(\) \|\| null/.test(form), true, "表單送出實際姓名");
  // 回填既有姓名（讀取，不寫入）。
  assert.equal(form.includes("/api/registrations/${ritualRecordId}/items"), true, "編輯既有資料時回填實際姓名");
});

test("舊「本人」讀取相容：顯示實名或「姓名待補」，絕不顯示「本人」", () => {
  const reg = read("src/lib/registrationItemRegistration.ts");
  const body = funcBody(reg, "listRegisteredItems");
  // SPONSOR 顯示：real ?? memberName ?? 姓名待補；排除字面「本人」。
  assert.equal(body.includes('r.customName.trim() !== "本人"'), true, "舊「本人」不得直接當姓名顯示");
  assert.equal(body.includes("姓名待補"), true, "找不到實名時顯示「姓名待補」");
});

test("歷史重複 item：合法寫入 transaction 內整理（findMany＋取消未收款重複＋已收款多筆丟錯），不放回 GET", () => {
  const reg = read("src/lib/registrationItemRegistration.ts");
  const fn = reg.slice(reg.indexOf("export async function syncSponsorItemInTx"), reg.indexOf("export async function listRegisteredItems"));
  assert.equal(fn.includes("findMany("), true, "需 findMany 找出所有有效重複，而非只 findFirst");
  assert.equal(fn.includes('status: "CANCELLED"'), true, "未收款重複標記 CANCELLED");
  assert.equal(fn.includes("amountUnpaid: 0"), true, "取消重複的未收金額歸 0，避免兩次應收");
  assert.equal(fn.includes("此報名有多筆已收款的${label}"), true, "多筆已收款需丟明確錯誤要求人工處理");
  assert.equal(fn.includes("throw new Error("), true, "以 throw 明確錯誤（transaction rollback）");
  // listRegisteredItems（GET 呼叫鏈）內不得實際呼叫這些整理寫入（註解提及不算）。
  const listBody = funcBody(reg, "listRegisteredItems");
  assert.equal(listBody.includes("syncSponsorItemInTx(tx"), false, "GET 讀取鏈不得呼叫寫入整理");
  assert.equal(listBody.includes("await syncSponsorItemInTx"), false);
});

test("舊 Detail 贊普 adapter 主動排除已有 CONFIRMED US_SPONSOR item（不依賴歸零）", () => {
  const adp = read("src/lib/receivableAdapters.ts");
  // adapter 3 的 where.ritualRecord 需以 registrationItems.none 排除已有 CONFIRMED US_SPONSOR item。
  assert.equal(
    adp.includes('none: { registrationItemType: { key: "US_SPONSOR" }, deletedAt: null, status: "CONFIRMED" }'),
    true,
    "舊 Detail adapter 需主動排除已有 CONFIRMED US_SPONSOR item"
  );
  // 只排除 status:"CONFIRMED"（DRAFT／CANCELLED item 不遮蔽相容舊資料）——排除條件用 CONFIRMED，非 DRAFT。
  assert.equal(adp.includes('deletedAt: null, status: "CONFIRMED" }'), true);
});

test("贊普不再共用 Detail 單一金額、不依 SPONSOR 陣列順序決定金額", () => {
  const reg = read("src/lib/registrationItemRegistration.ts");
  const body = funcBody(reg, "listRegisteredItems");
  assert.equal(body.includes("firstSponsorId"), false, "不得用『第一筆 SPONSOR 讀 Detail』的順序依賴邏輯");
});

test("linkItemToExistingDetail 不再把 SPONSOR 金額寫回 Detail（改為自身計價 item）", () => {
  const reg = read("src/lib/registrationItemRegistration.ts");
  // 取非匯出函式 linkItemToExistingDetail 的片段（到下一個 `\nasync function` 或 `\nexport`）。
  const start = reg.indexOf("async function linkItemToExistingDetail");
  assert.notEqual(start, -1);
  const rest = reg.slice(start + 1);
  const nextA = rest.indexOf("\nasync function ");
  const nextE = rest.indexOf("\nexport ");
  const endRel = [nextA, nextE].filter((n) => n !== -1).sort((a, b) => a - b)[0] ?? -1;
  const body = endRel === -1 ? reg.slice(start) : reg.slice(start, start + 1 + endRel);
  assert.equal(body.includes('contentKind === "SPONSOR"'), false, "不應再有把 SPONSOR 金額塞回 Detail 的特例分支");
  assert.equal(body.includes("universalSalvationDetail.upsert"), false, "SPONSOR 不應再 upsert Detail 金額");
});

test("收款 adapter：US_SPONSOR 與 US_SPONSOR_DONATION 各自 item 計價（避免重複計價）", () => {
  const adp = read("src/lib/receivableAdapters.ts");
  assert.equal(adp.includes('["US_SPONSOR", "US_SPONSOR_DONATION"]'), true, "贊普與隨喜贊普經 item adapter 各自計價");
  assert.equal(adp.includes("UNIVERSAL_SALVATION_SPONSOR_ITEM"), true);
  // 舊 Detail 贊普 adapter 仍在（僅供未轉 item 的舊資料），編輯頁未收款儲存會把 Detail 應收歸 0。
  assert.equal(adp.includes("UNIVERSAL_SALVATION_SPONSOR"), true);
});

test("舊 Detail 贊普唯讀相容（readOnlyLegacy），且僅在無 US_SPONSOR item 時顯示", () => {
  const reg = read("src/lib/registrationItemRegistration.ts");
  const body = funcBody(reg, "listRegisteredItems");
  assert.equal(body.includes("readOnlyLegacy: true"), true);
  assert.equal(body.includes("legacy-sponsor:"), true);
  assert.equal(body.includes("hasSponsorItem"), true, "需判斷已無 US_SPONSOR item 才顯示舊資料，避免重複計入");
});
