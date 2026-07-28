import { test } from "node:test";
import assert from "node:assert/strict";
import { matchIncomingMember, type IncomingMember, type ExistingMemberForMatch } from "../src/lib/devoteeImportMemberMatch";

/**
 * V25.1 正式匯入預檢修正——家戶編號（HouseholdCode）優先權最高：
 * 同一家戶編號內、姓名相同且唯一 → 直接更新（SKIP_SAME_PERSON），不進人工確認。
 * 只有「跨戶同名」或「同戶多位同名」才 NEEDS_REVIEW。
 */

const incoming = (name: string, address: string | null = null): IncomingMember => ({
  name,
  mobile: null,
  phone: null,
  solarBirthDate: null,
  lunarBirthYear: null,
  lunarBirthMonth: null,
  lunarBirthDay: null,
  lunarIsLeapMonth: false,
  address,
  gender: null,
  role: null,
  nationalId: null,
  tabletAddress: null,
});

const existing = (id: string, name: string, householdId: string, householdAddress: string | null = null): ExistingMemberForMatch => ({
  id,
  name,
  householdId,
  gender: null,
  householdName: `${householdId} 戶`,
  mobile: null,
  householdPhone: null,
  householdAddress,
  solarBirthDate: null,
  lunarBirthYear: null,
  lunarBirthMonth: null,
  lunarBirthDay: null,
  lunarIsLeapMonth: false,
});

// ── 核心案例：同 HouseholdCode、同名、同地址、無電話/生日 → 直接更新，不需人工確認 ──
test("同家戶編號＋同名（同地址、無電話生日）→ SKIP_SAME_PERSON，不進人工確認", () => {
  const addr = "台北市中山區一號";
  const r = matchIncomingMember(
    incoming("周財寶", addr),
    "F00001",
    [existing("m1", "周財寶", "F00001", addr)]
  );
  assert.equal(r.suggestion, "SKIP_SAME_PERSON");
  assert.ok(/家戶編號/.test(r.reason));
});

test("同家戶編號＋同名，連地址都沒有（僅姓名相同）→ 仍直接更新（HouseholdCode 已是唯一識別）", () => {
  const r = matchIncomingMember(
    incoming("陳秀珍", null),
    "F00001",
    [existing("m2", "陳秀珍", "F00001", null)]
  );
  assert.equal(r.suggestion, "SKIP_SAME_PERSON");
});

// ── 仍需人工確認：跨戶同名 ──
test("同名但在其他家戶（HouseholdCode 不同）→ NEEDS_REVIEW，不自動轉戶", () => {
  const r = matchIncomingMember(
    incoming("周財寶"),
    "F00001",
    [existing("mX", "周財寶", "F09999")]
  );
  assert.equal(r.suggestion, "NEEDS_REVIEW");
  assert.ok(/其他家戶|不會自動轉戶/.test(r.reason));
});

// ── 仍需人工確認：同戶多位同名（多個候選） ──
test("同家戶編號內有多位同名 → NEEDS_REVIEW（不知道要更新哪一位）", () => {
  const r = matchIncomingMember(
    incoming("周晉萬"),
    "F00001",
    [existing("a", "周晉萬", "F00001"), existing("b", "周晉萬", "F00001")]
  );
  assert.equal(r.suggestion, "NEEDS_REVIEW");
  assert.ok(/多位同名/.test(r.reason));
});

// ── 無候選 → 新增 ──
test("查無同名 → CREATE", () => {
  const r = matchIncomingMember(incoming("新來的人"), "F00001", []);
  assert.equal(r.suggestion, "CREATE");
});

// ── 同戶唯一 + 跨戶也有同名：以本戶為準（HouseholdCode 優先），直接更新 ──
test("同戶有唯一同名、且別戶也有同名 → 以本戶為準直接更新（不因跨戶而 REVIEW）", () => {
  const r = matchIncomingMember(
    incoming("周財寶"),
    "F00001",
    [existing("home", "周財寶", "F00001"), existing("away", "周財寶", "F09999")]
  );
  assert.equal(r.suggestion, "SKIP_SAME_PERSON");
});

// ── 來源掃描：預檢狀態分類仍以 REVIEW 決定 SUSPECTED_DUPLICATE（未動流程） ──
test("預檢流程未改：REVIEW 才會使該列成為 SUSPECTED_DUPLICATE", () => {
  const batch = require("node:fs").readFileSync("src/lib/devoteeImportBatch.ts", "utf8") as string;
  assert.ok(/plan\.members\.some\(\(m\) => m\.action === "REVIEW"\)/.test(batch), "仍以 REVIEW 判定疑似重複");
  assert.ok(/status = "SUSPECTED_DUPLICATE"/.test(batch), "疑似重複狀態沿用");
});
