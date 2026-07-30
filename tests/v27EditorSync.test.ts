import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * V27（第二輪）：普渡編輯器實際資料鏈修正——結構驗證（沙盒可跑，不 import 會觸發
 * Prisma 引擎的元件模組）。實際 react-dom 元件渲染＋initialNames 單元測試見
 * tests/v27EditorRenderDb.test.ts（需 Prisma 原生引擎，於 Mac 執行）。
 */
const readSrc = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// ── V27.1 回歸修正：EntryRow 只在 mount 以 initialNames 回填，不再用 effect 覆蓋 render state ──
test("EntryRow：四類回填由 mount 的 useState(initialNames) 完成；已移除會抖動的 entry 同步 effect", () => {
  const src = readSrc("src/components/ritual/EntryRow.tsx");
  assert.ok(/useState<string\[\]>\(initialNames\(entry\)\)/.test(src), "mount 以 initialNames 回填（四類共用）");
  assert.ok(/export function initialNames\(entry: EntryJSON\): string\[\]/.test(src), "initialNames 可供單元測試/渲染測試");
  // 不得再存在 d411768 的 [entry, editing] 同步 effect（回歸點）。
  assert.ok(!/\}, \[entry, editing\]\)/.test(src), "已移除 [entry, editing] 同步 effect（避免新增/刷新循環抖動）");
  assert.ok(!/useEffect\s*\(/.test(src), "EntryRow 不再實際呼叫 useEffect(");
});

// ── Root Cause A：牌位變動 → 已報名項目/確認預檢重新載入 ──
test("RegistrationEditor：牌位變動 → 重刷已報名項目(refreshKey)＋重跑確認預檢", () => {
  const src = readSrc("src/components/registration/RegistrationEditor.tsx");
  assert.ok(/const \[registeredItemsRefreshKey, setRegisteredItemsRefreshKey\] = useState\(0\)/.test(src), "有 refreshKey state");
  assert.ok(/refreshKey=\{registeredItemsRefreshKey\}/.test(src), "已報名項目接上 refreshKey");
  assert.ok(
    /onRecordChanged=\{\(\) => \{[\s\S]*?setRegisteredItemsRefreshKey\(\(k\) => k \+ 1\);[\s\S]*?void checkConfirmable\(\);/.test(src),
    "onRecordChanged 觸發重刷＋確認預檢"
  );
});

test("UniversalSalvationScreen：任何 record 變動（新增/修改/刪除牌位）都通知外層", () => {
  const src = readSrc("src/components/ritual/UniversalSalvationScreen.tsx");
  assert.ok(/onRecordChanged\?: \(\) => void/.test(src), "宣告 onRecordChanged prop");
  assert.ok(
    /function handleUpdated\(nextRecord: RecordJSON\) \{[\s\S]*?setRecord\(nextRecord\);[\s\S]*?onRecordChanged\?\.\(\);/.test(src),
    "handleUpdated 一律呼叫 onRecordChanged（四類牌位與明細共用同一 funnel）"
  );
});

test("RegisteredItemsPanel：refreshKey 變動即重新載入（既有機制被實際使用）", () => {
  const src = readSrc("src/components/registration/RegisteredItemsPanel.tsx");
  assert.ok(/useEffect\(\(\) => \{\s*void load\(\);\s*\}, \[load, refreshKey\]\)/.test(src), "refreshKey 觸發 load");
});

// ── 資料鏈一致（需求四、五）：建立牌位即建立並連結 RitualRegistrationItem；四類共用 ──
test("建立牌位即連動建立並連結 RitualRegistrationItem（listRegisteredItems 立即查得到）", () => {
  const src = readSrc("src/lib/ritual.ts");
  assert.ok(/await ensureLinkedTabletItem\(tx, \{[\s\S]*?entryId: created\.id/.test(src), "建立 entry 時連動建立/連結計價項目");
});

test("Confirm 與畫面同源：US_YUANQIN 也從連結 entry 帶出 yangshangNames（四類一致）", () => {
  const src = readSrc("src/lib/registrationItemRegistration.ts");
  assert.ok(/key === "US_YUANQIN"[\s\S]*?yangshangNames = linkedYangshang;/.test(src), "累世冤親債主帶出陽上人");
  assert.ok(/if \(key in TABLET_NAME_ITEM_CATEGORY\)[\s\S]*?yangshangNames = linkedYangshang;/.test(src), "其餘牌位帶出陽上人");
});

// ── 已移除 DEBUG_US_ENTRY 暫時診斷：確認程式碼不再殘留 ──
test("已移除 DEBUG_US_ENTRY 暫時診斷碼", () => {
  const route = readSrc("src/app/api/households/[id]/rituals/universal-salvation/[year]/entries/route.ts");
  const lib = readSrc("src/lib/ritual.ts");
  assert.ok(!/DEBUG_US_ENTRY/.test(route) && !/DEBUG_US_ENTRY/.test(lib), "DEBUG_US_ENTRY 已清除");
});

// ── V27.1：永久名單 → 本年度草稿 陽上人補入（安全護欄） ──
test("backfill：只補空、只從永久名單有值、祖先與正魂皆處理、不覆蓋不猜測", () => {
  const src = readSrc("src/lib/householdWorshipSync.ts");
  // 只挑「本年度 entry 陽上人為空」且舊單一欄位也空的祖先/正魂。
  assert.ok(/category === "ANCESTOR_LINE" \|\| e\.category === "INDIVIDUAL_SOUL"/.test(src), "涵蓋歷代祖先與乙位正魂");
  assert.ok(/\(e\.yangshangNames\?\.length \?\? 0\) === 0/.test(src), "只補陽上人為空的 entry");
  assert.ok(/!\(e\.yangshangName && e\.yangshangName\.trim\(\)\)/.test(src), "舊單一 yangshangName 也空才算真的缺（相容舊欄位）");
  // 永久名單沒有陽上人 → 不動、不猜。
  assert.ok(/if \(names\.length === 0\) continue;/.test(src), "永久名單無值則不補、不猜測");
  // 對應永久牌位：優先 worshipRecordId，否則姓名＋地址比對。
  assert.ok(/e\.worshipRecordId != null[\s\S]*?worshipRecord\.findFirst/.test(src), "優先以 worshipRecordId 對應永久牌位");
  // 只寫 yangshangNames/yangshangName，不動其他欄位（不覆蓋手動輸入的其他資料）。
  assert.ok(/data: \{ yangshangNames: names, yangshangName: names\[0\] \}/.test(src), "只補陽上人欄位");
});

test("確認驗證＝伺服器 DB（listRegisteredItems），非 editor state；完整度回復原 active 過濾、無診斷", () => {
  const confirm = readSrc("src/app/api/registrations/[ritualRecordId]/confirm/route.ts");
  assert.ok(/checkRitualRecordCompleteness\(ritualRecordId\)/.test(confirm), "確認預檢用 record 完整度（DB）");
  const gate = readSrc("src/lib/completenessGate.ts");
  assert.ok(/const items = await listRegisteredItems\(ritualRecordId\)/.test(gate), "完整度讀 DB items，不讀 editor state");
  assert.ok(!/DEBUG_CONFIRM/.test(gate) && !/DEBUG_COMPLETENESS/.test(gate), "所有 DEBUG 診斷已移除");
  // active 過濾回復原狀（僅排除已取消/唯讀相容；軟刪除於查詢層濾除）——無額外佔位過濾。
  assert.ok(/const active = items\.filter\(\(it\) => it\.status !== "CANCELLED" && !it\.readOnlyLegacy\)/.test(gate), "回復原 active 過濾");
  assert.ok(!/UNFILLED_TABLET_SENTINELS/.test(gate), "已移除先前的佔位哨兵過濾");
});

test("US_YUANQIN 規則差異：不再要求陽上人；US_ANCESTOR/US_ZHENGHUN 仍要求", () => {
  const rules = readSrc("src/lib/dataCompleteness.ts");
  assert.ok(/case "US_YUANQIN":[\s\S]*?return build\(\[\]\);/.test(rules), "US_YUANQIN 無必填欄位（不要求陽上人）");
  assert.ok(/case "US_ANCESTOR":[\s\S]*?case "US_ZHENGHUN":[\s\S]*?has\(d\.yangshangNames\), "yangshang"/.test(rules), "US_ANCESTOR/US_ZHENGHUN 仍要求陽上人");
});

test("Bug 1：軟刪除 entry 不顯示——server 只回 deletedAt:null、client 全取代、畫面再加防線", () => {
  const lib = readSrc("src/lib/ritual.ts");
  assert.ok(/entries: \{\s*where: \{ deletedAt: null \}/.test(lib), "getUniversalSalvationRecord entries 只回 deletedAt:null");
  const screen = readSrc("src/components/ritual/UniversalSalvationScreen.tsx");
  assert.ok(/detail\.entries\.filter\(\(e\) => e\.category === section\.category && !e\.deletedAt\)/.test(screen), "畫面再加 deletedAt 防線");
  // client 以新 response 全取代（setRecord），不 merge 舊 entries。
  assert.ok(/setRecord\(data\.record \?\? data\)/.test(screen) && /setRecord\(nextRecord\)/.test(screen), "收到新 response 全取代，不 merge");
});

test("GET [year]：保持純讀取——不在載入時執行 backfill/repair/reconcile/create/update", () => {
  const route = readSrc("src/app/api/households/[id]/rituals/universal-salvation/[year]/route.ts");
  assert.ok(!/backfillYearAncestorYangshangFromHousehold/.test(route), "GET 不觸發陽上人 backfill");
  // V27.5：GET 絕不呼叫牌位 item 自癒（reconcile）；不變式改由正式寫入交易保證。
  assert.ok(!/reconcileTabletItemsForRecord/.test(route), "GET 不觸發 reconcile 寫入");
  assert.ok(/GET 保持純讀取[\s\S]*?const record = await getUniversalSalvationRecord/.test(route), "GET 僅 getUniversalSalvationRecord 讀取");
});

// ── V27.1 item repair 已回退：確認程式與觸發點皆已移除 ──
test("item repair 已回退：repairTabletEntryItemsForRecord 與 GET 觸發皆不存在", () => {
  const lib = readSrc("src/lib/registrationItemRegistration.ts");
  const route = readSrc("src/app/api/registrations/[ritualRecordId]/items/route.ts");
  assert.ok(!/repairTabletEntryItemsForRecord/.test(lib), "lib 內已無 repair 函式");
  assert.ok(!/repairTabletEntryItemsForRecord/.test(route), "items route 已無 repair 觸發");
});
