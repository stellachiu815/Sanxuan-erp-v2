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

// ── V27.1：新增牌位提交錯誤不得被吞掉（非 JSON/HTTP 狀態/缺 record 都要明確） ──
test("postEntry：非 JSON 回應安全解析、HTTP 狀態入錯誤訊息、缺 record 明確報錯、有診斷 log", () => {
  const src = readSrc("src/components/ritual/EntryCategorySection.tsx");
  assert.ok(/try \{\s*data = \(await res\.json\(\)\)[\s\S]*?\} catch \{/.test(src), "非 JSON 回應不讓 res.json() 例外吞掉狀態");
  assert.ok(/if \(!res\.ok\) \{[\s\S]*?HTTP \$\{res\.status\}/.test(src), "失敗訊息帶 HTTP 狀態");
  assert.ok(/if \(!data\.record\)[\s\S]*?回應資料異常/.test(src), "成功但缺 record 也明確報錯，不靜默");
  assert.ok(/console\.error\("\[V27\.1\] 新增牌位提交失敗"/.test(src), "暫時性可移除診斷 log（Console/Network 可查真正原因）");
});
