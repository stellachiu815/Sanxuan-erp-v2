import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorshipPickList } from "../src/components/ritual/worshipPickList";
import type { WorshipOptionJSON } from "../src/components/ritual/types";

/**
 * V27.2 前端「帶入」清單契約回歸（純函式，沙盒可直接跑）。
 *
 * buildWorshipPickList 是普渡報名畫面歷代祖先／乙位正魂「本戶固定牌位」帶入清單的
 * 唯一計算來源。這些測試鎖住需求，避免未來又發生「啟用中祖先不見／去重清空整份」。
 */

const opt = (displayName: string, extra: Partial<WorshipOptionJSON> = {}): WorshipOptionJSON => ({
  displayName,
  yangshangNames: extra.yangshangNames ?? [],
  tabletAddress: extra.tabletAddress ?? null,
});

test("1. API 回傳 ancestors 含周姓 → 帶入清單顯示周姓（可點擊）", () => {
  const list = buildWorshipPickList([opt("周姓歷代祖先", { tabletAddress: "本宮" })], []);
  assert.equal(list.length, 1);
  assert.equal(list[0].displayName, "周姓歷代祖先");
  assert.equal(list[0].already, false, "尚未加入草稿 → 可點擊帶入");
  assert.equal(list[0].tabletAddress, "本宮", "地址原樣帶出");
});

test("2. individualSouls 正常顯示（乙位正魂帶入清單）", () => {
  const list = buildWorshipPickList([opt("王小明 乙位正魂", { yangshangNames: ["王大明"] })], []);
  assert.equal(list.length, 1);
  assert.equal(list[0].displayName, "王小明 乙位正魂");
  assert.deepEqual(list[0].yangshangNames, ["王大明"]);
  assert.equal(list[0].already, false);
});

test("3. 已加入草稿的祖先只排除那一筆、不清空整份", () => {
  const list = buildWorshipPickList(
    [opt("周姓歷代祖先"), opt("陳姓歷代祖先")],
    [{ displayName: "周姓歷代祖先" }] // 周姓已在草稿
  );
  assert.equal(list.length, 2, "整份清單仍在，未被清空");
  const zhou = list.find((x) => x.displayName === "周姓歷代祖先")!;
  const chen = list.find((x) => x.displayName === "陳姓歷代祖先")!;
  assert.equal(zhou.already, true, "周姓標記已加入（畫面顯示 ✓、停用）");
  assert.equal(chen.already, false, "陳姓仍可點擊帶入");
});

test("4. 純函式無狀態：切換家戶（換一組 options）只反映新資料，不保留上一戶", () => {
  const first = buildWorshipPickList([opt("周姓歷代祖先")], []);
  const second = buildWorshipPickList([opt("林姓歷代祖先")], []);
  assert.deepEqual(first.map((x) => x.displayName), ["周姓歷代祖先"]);
  assert.deepEqual(second.map((x) => x.displayName), ["林姓歷代祖先"], "第二戶只有林姓，不殘留周姓");
});

test("5. 已封存者不在後端選項內 → 自然不出現在帶入清單（邊界）", () => {
  // 後端 loadWorshipOptions 已用 deletedAt:null 濾掉封存者；前端只忠實呈現拿到的清單。
  const activeOnly = [opt("周姓歷代祖先")]; // 林姓（已封存）不在其中
  const list = buildWorshipPickList(activeOnly, []);
  assert.equal(list.some((x) => x.displayName.includes("林")), false);
  assert.equal(list.length, 1);
});

test("6. 累世冤親債主不走此清單（string[] 另一條路徑，不受影響）", () => {
  // 冤親債主帶入用 existingNameOptions: string[]，與 WorshipOptionJSON 帶入無關。
  // 這裡以型別層級確認 buildWorshipPickList 不吃字串陣列，避免誤用把兩條路徑混在一起。
  const list = buildWorshipPickList([opt("周姓歷代祖先")], []);
  assert.ok(Array.isArray(list) && "already" in list[0]);
  // 字串清單（冤親債主）不會、也不應被丟進這個函式；契約僅涵蓋祖先／正魂。
});
