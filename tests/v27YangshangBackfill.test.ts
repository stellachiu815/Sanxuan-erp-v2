import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkUniversalSalvationItem } from "../src/lib/dataCompleteness";
import { resolveYangshangNames, normalizeYangshangNames } from "../src/lib/yangshang";

const readSrc = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * V27：普渡牌位陽上人回填與確認阻擋修正。
 *
 * 根因：completenessGate 讀 listRegisteredItems 的 it.yangshangNames 判斷「缺陽上人」，
 * 但 listRegisteredItems 只在 TABLET_NAME_ITEM_CATEGORY（US_ANCESTOR／US_ZHENGHUN／
 * US_WUYUAN）分支帶出連結 entry 的 yangshangNames；US_YUANQIN（累世冤親債主）分支漏了，
 * 導致其 yangshangNames 恆為空 → 明明 entry 已存陽上人，確認報名卻被誤判「缺陽上人」。
 * 修正：US_YUANQIN 分支一律 yangshangNames = linkedYangshang、tabletAddress = 連結 entry 地址。
 */

// ── 完整度規則（純函式，沙盒可跑）：四種牌位對陽上人的要求 ──
test("US_YUANQIN：有陽上人→可確認；真的沒有→仍應阻擋（不誤放行）", () => {
  assert.equal(checkUniversalSalvationItem("US_YUANQIN", { yangshangNames: ["周財寶"] }).complete, true);
  const empty = checkUniversalSalvationItem("US_YUANQIN", { yangshangNames: [] });
  assert.equal(empty.complete, false);
  assert.deepEqual(empty.missing.map((m) => m.field), ["yangshang"]);
});

test("US_ANCESTOR／US_ZHENGHUN：陽上人齊全即可確認（回填後不再擋）", () => {
  assert.equal(
    checkUniversalSalvationItem("US_ANCESTOR", { yangshangNames: ["周財寶"], tabletAddress: "台北市A路" }).complete,
    true
  );
  assert.equal(
    checkUniversalSalvationItem("US_ZHENGHUN", { yangshangNames: ["周財寶"], tabletAddress: "台北市A路" }).complete,
    true
  );
});

// ── 相容與不遺失（需求六.4、六.10）──
test("多位陽上人：順序與內容保留、去重不遺失", () => {
  assert.deepEqual(normalizeYangshangNames(["周財寶", "王大明", "周財寶", " 李小華 "]), ["周財寶", "王大明", "李小華"]);
});

test("舊單一 yangshangName 相容：陣列為空時退回單一姓名，不遺失", () => {
  assert.deepEqual(resolveYangshangNames([], "周財寶"), ["周財寶"]);
  assert.deepEqual(resolveYangshangNames(["周財寶", "王大明"], "忽略"), ["周財寶", "王大明"]); // 陣列優先
  assert.deepEqual(resolveYangshangNames([], null), []);
});

// ── 四種牌位一致（需求四）：listRegisteredItems 四類都從連結 entry 帶出陽上人 ──
test("listRegisteredItems：US_YUANQIN 已與其他三種牌位一致帶出 yangshangNames／tabletAddress", () => {
  const src = readSrc("src/lib/registrationItemRegistration.ts");
  // TABLET_NAME_ITEM_CATEGORY 分支（US_ANCESTOR／US_ZHENGHUN／US_WUYUAN）本就帶出。
  assert.ok(/if \(key in TABLET_NAME_ITEM_CATEGORY\)[\s\S]*?yangshangNames = linkedYangshang;[\s\S]*?tabletAddress = linked\?\.tabletAddress \?\? null;/.test(src),
    "三種牌位分支帶出陽上人/地址");
  // V27：US_YUANQIN 分支也帶出（本次修正）。
  assert.ok(/key === "US_YUANQIN"[\s\S]*?yangshangNames = linkedYangshang;[\s\S]*?tabletAddress = linked\?\.tabletAddress \?\? null;/.test(src),
    "US_YUANQIN 分支已補上帶出陽上人/地址");
  // linkedYangshang 來源＝連結 entry 的 yangshangNames（相容舊 yangshangName）。
  assert.ok(/linkedYangshang = linked \? resolveYangshangNames\(linked\.yangshangNames, linked\.yangshangName\) : \[\]/.test(src),
    "陽上人一律讀連結 entry（陣列優先、相容舊欄位）");
});

// ── 編輯器回填（需求二）：EntryRow 以既有 entry.yangshangNames 初始化，相容舊單一欄位 ──
test("EntryRow：重新進入以 entry.yangshangNames 回填（相容舊 yangshangName），不需重點成員", () => {
  const src = readSrc("src/components/ritual/EntryRow.tsx");
  assert.ok(/function initialNames\(entry: EntryJSON\): string\[\] \{[\s\S]*?entry\.yangshangNames && entry\.yangshangNames\.length > 0[\s\S]*?return entry\.yangshangNames;[\s\S]*?entry\.yangshangName \? \[entry\.yangshangName\] : \[\]/.test(src),
    "回填優先 yangshangNames，退回舊 yangshangName");
  assert.ok(/useState<string\[\]>\(initialNames\(entry\)\)/.test(src), "編輯器初始 state 直接用既有陽上人");
  // V27：YangshangEditor 由 showYangshang 控制，儲存仍寫回 yangshangNames。
  assert.ok(/\{showYangshang && \([\s\S]*?<YangshangEditor[\s\S]*?value=\{yangshangNames\}/.test(src), "showYangshang 控制陽上人編輯器顯示");
  assert.ok(/yangshangNames,\s*\n\s*tabletAddress:/.test(src) || /yangshangNames,/.test(src), "儲存送出 yangshangNames（寫回原欄位）");
  // 尚缺提示依 require 旗標（不再用單一 supportsYangshang），符合各牌位確認規則。
  assert.ok(/requireYangshang && names\.length === 0/.test(src), "陽上人提示依 requireYangshang");
  assert.ok(/requireTabletAddress && \(!entry\.tabletAddress/.test(src), "地址提示依 requireTabletAddress");
});

// ── 四類牌位一致（需求一、二、三、四）：四種都可查看／增修既有陽上人 ──
test("EntryCategorySection：四類牌位都 showYangshang（可回填/增修）；地址欄僅歷代祖先/乙位正魂", () => {
  const src = readSrc("src/components/ritual/EntryCategorySection.tsx");
  // 四種 case 都設 showYangshang: true。
  assert.ok(/ANCESTOR_LINE[\s\S]*?INDIVIDUAL_SOUL[\s\S]*?showYangshang: true, showTabletAddress: true, requireYangshang: true, requireTabletAddress: true/.test(src), "歷代祖先/乙位正魂：陽上人＋地址");
  assert.ok(/DEBT_CREDITOR[\s\S]*?showYangshang: true, showTabletAddress: false, requireYangshang: true, requireTabletAddress: false/.test(src), "累世冤親債主：可增修陽上人、需陽上人、不需地址");
  assert.ok(/UNBORN_CHILD[\s\S]*?showYangshang: true, showTabletAddress: false, requireYangshang: false, requireTabletAddress: false/.test(src), "無緣子女：可增修陽上人、不強制陽上人");
  // 傳入 EntryRow 的四個旗標。
  assert.ok(/showYangshang=\{yangshangConfig\.showYangshang\}/.test(src) && /requireYangshang=\{yangshangConfig\.requireYangshang\}/.test(src), "旗標傳入 EntryRow");
});

// ── Confirm 規則不變（需求五）：無緣子女無陽上人仍可確認；累世冤親債主有陽上人可確認 ──
test("Confirm 規則不變：US_WUYUAN 無陽上人仍完整；US_YUANQIN 有陽上人即完整", () => {
  assert.equal(checkUniversalSalvationItem("US_WUYUAN", { yangshangNames: [] }).complete, true, "無緣子女不強制陽上人");
  assert.equal(checkUniversalSalvationItem("US_WUYUAN", {}).complete, true, "無緣子女無任何資料仍不擋");
  assert.equal(checkUniversalSalvationItem("US_YUANQIN", { yangshangNames: ["周財寶"] }).complete, true, "累世冤親債主有陽上人可確認");
});
