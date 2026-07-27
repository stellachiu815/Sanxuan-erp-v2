import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isSyncableWorshipCategory } from "../src/lib/householdWorshipSync";

/**
 * V15R6.1 普渡新增牌位同步家戶永久名單——單元 + 來源掃描（不需 DB）。
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("isSyncableWorshipCategory：只有祖先／正魂可同步永久名單", () => {
  assert.equal(isSyncableWorshipCategory("ANCESTOR_LINE"), true);
  assert.equal(isSyncableWorshipCategory("INDIVIDUAL_SOUL"), true);
  assert.equal(isSyncableWorshipCategory("DEBT_CREDITOR"), false);
  assert.equal(isSyncableWorshipCategory("UNBORN_CHILD"), false);
});

test("同步服務：防重複依 來源ID → type＋標準化姓名＋標準化地址（不只用姓名）", () => {
  const src = read("src/lib/householdWorshipSync.ts");
  assert.ok(src.includes("existingWorshipRecordId"), "優先用來源 ID");
  assert.ok(src.includes("normalizeTabletText"), "姓名/地址標準化比對");
  assert.ok(/type: worshipType/.test(src), "以 worshipType 限定");
  assert.ok(src.includes("worshipRecord.update") && src.includes("worshipRecord.create"), "既有則更新、否則新增");
});

test("ritual.create：連結 worshipRecordId 或依 syncToHousehold 同步；於同一交易回填", () => {
  const src = read("src/lib/ritual.ts");
  assert.ok(src.includes("syncEntryToHouseholdWorshipRecord"), "create 呼叫同步服務");
  assert.ok(src.includes("worshipRecordId: linkedWorshipRecordId"), "回填 entry.worshipRecordId");
  // 更新流程也支援同步。
  assert.ok(/input\.syncToHousehold && isSyncableWorshipCategory\(after\.category\)/.test(src), "update 依 syncToHousehold 同步");
});

test("刪除活動牌位不得刪除／改動家戶永久名單（WorshipRecord）", () => {
  const src = read("src/lib/ritual.ts");
  const del = src.slice(src.indexOf("export async function deleteUniversalSalvationEntry"), src.indexOf("export async function", src.indexOf("export async function deleteUniversalSalvationEntry") + 1));
  assert.ok(!/worshipRecord\.(delete|update|create)/.test(del), "刪除流程不得動 WorshipRecord");
});

test("路由：POST 預設同步、PATCH 接受 syncToHousehold", () => {
  const post = read("src/app/api/households/[id]/rituals/universal-salvation/[year]/entries/route.ts");
  assert.ok(post.includes("syncToHousehold"), "POST 帶 syncToHousehold");
  assert.ok(/=== undefined \? true/.test(post), "POST 預設 true");
  const patch = read("src/app/api/households/[id]/rituals/universal-salvation/[year]/entries/[entryId]/route.ts");
  assert.ok(patch.includes("syncToHousehold"), "PATCH 接受 syncToHousehold");
});

test("UI：新增/編輯有同步勾選、缺欄位改列表、必填未完成 disabled、依成員分組", () => {
  const section = read("src/components/ritual/EntryCategorySection.tsx");
  assert.ok(section.includes("加入家戶永久名單"), "新增顯示是否同步永久名單");
  assert.ok(/disabled=\{submitting \|\| !surname\.trim\(\)\}/.test(section), "祖先必填未完成 disabled");
  assert.ok(/disabled=\{submitting \|\| !name\.trim\(\)\}/.test(section), "正魂必填未完成 disabled");
  const row = read("src/components/ritual/EntryRow.tsx");
  assert.ok(row.includes("同步更新家戶永久名單"), "編輯顯示是否同步永久名單");
  assert.ok(row.includes("list-disc") && row.includes("尚缺欄位"), "缺欄位改為清楚列表");
  assert.ok(!/rounded-full bg-yolk-100 px-2 py-0\.5 text-xs text-ink">\s*尚缺/.test(row), "不再是黃色圓圈");
  const panel = read("src/components/registration/RegisteredItemsPanel.tsx");
  assert.ok(panel.includes("groupByRegistrant"), "已報名項目依成員分組");
  const ys = read("src/components/ritual/YangshangEditor.tsx");
  assert.ok(ys.includes("搜尋陽上人") || ys.includes("收合"), "陽上人快速加入支援搜尋或收合");
});

test("財務隔離維持：同步只動 WorshipRecord／entry，不寫 amountPaid", () => {
  const src = read("src/lib/householdWorshipSync.ts");
  assert.ok(!src.includes("amountPaid"), "同步服務不碰 amountPaid");
});
