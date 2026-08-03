import { test } from "node:test";
import assert from "node:assert/strict";
import { needsReprint, latestIso } from "../src/lib/tabletPrintFields";

/**
 * V32 §5 需補印偵測：以「內容最後變更時間（latestIso 彙整多來源）vs 最後列印時間」判定。
 *  - 首次列印後改 workOrder／printMainText／地址／陽上／牌位名稱／寶袋名稱 → 需補印
 *  - 預覽不改 lastPrintedAt → 不解除
 *  - 確認補印把 lastPrintedAt 推到編輯之後 → 解除
 */

test("latestIso 取最晚時間，忽略 null", () => {
  assert.equal(
    latestIso(null, "2026-08-01T00:00:00Z", undefined, "2026-08-03T00:00:00Z"),
    "2026-08-03T00:00:00Z"
  );
  assert.equal(latestIso(null, undefined), null);
});

test("列印後改內容（entry/RRI/item 任一較晚）→ 需補印", () => {
  const lastPrinted = "2026-08-02T00:00:00Z";
  const edited = latestIso("2026-08-01T00:00:00Z", "2026-08-03T09:00:00Z", null); // item 改在列印後
  assert.equal(needsReprint(1, lastPrinted, edited), true);
});

test("預覽不改 lastPrintedAt → 仍需補印（不因預覽解除）", () => {
  // 預覽不會更新 lastPrintedAt；edited 仍晚於 lastPrinted
  const lastPrinted = "2026-08-02T00:00:00Z";
  const edited = "2026-08-03T00:00:00Z";
  assert.equal(needsReprint(1, lastPrinted, edited), true);
});

test("確認補印後 lastPrintedAt 晚於編輯 → 解除需補印", () => {
  const editedThenReprinted = "2026-08-03T00:00:00Z";
  const lastPrinted = "2026-08-03T10:00:00Z"; // 補印在編輯之後
  assert.equal(needsReprint(2, lastPrinted, editedThenReprinted), false);
});

test("未列印 → 永不需補印", () => {
  assert.equal(needsReprint(0, null, "2026-08-03T00:00:00Z"), false);
});
