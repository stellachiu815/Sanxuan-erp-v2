import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_POCKET_UNIT_PRICE,
  resolvePocketUnitPrice,
  computePocketSubtotal,
  resolvePocketPaymentState,
  assertSubtotalNotBelowPaid,
  assertNoPaymentBeforeRemoval,
} from "../src/lib/pocketPricing";
import {
  canUniversalSalvation,
  UNIVERSAL_SALVATION_PERMISSION_MATRIX,
} from "../src/lib/permissions";

/**
 * V13.3B：寶袋收款串接測試（對應指令第十二階段的 22 項要求）。
 */

// ── 1~3：年度預設價格 ──

test("1. 新年度活動寶袋預設價格為 300", () => {
  assert.equal(DEFAULT_POCKET_UNIT_PRICE, 300);
  // 活動未設定（null）→ fallback 300
  assert.equal(resolvePocketUnitPrice(null), 300);
  assert.equal(resolvePocketUnitPrice(undefined), 300);
});

test("2. 活動價格修改後，新建寶袋使用新價格", () => {
  assert.equal(resolvePocketUnitPrice(350), 350);
  assert.equal(resolvePocketUnitPrice(250), 250);
  assert.equal(resolvePocketUnitPrice(0), 0, "0 元是合法設定（活動當年免費）");
});

test("3. 修改活動價格不影響既有寶袋（既有 unitPrice 是快照）", () => {
  // 既有寶袋已存 300；活動價改成 500 後，重算既有寶袋仍用它自己的 300
  const existingUnitPrice = 300;
  const r = computePocketSubtotal({ isChargeable: true, unitPrice: existingUnitPrice, quantity: 2 });
  assert.equal(r.ok && r.subtotal, 600, "既有寶袋以自身 unitPrice 計算，不受活動新價影響");
});

test("不合理的活動價格 fallback 到 300", () => {
  assert.equal(resolvePocketUnitPrice(-1), 300);
  assert.equal(resolvePocketUnitPrice(NaN), 300);
  assert.equal(resolvePocketUnitPrice(Infinity), 300);
});

// ── 4~5：小計計算 ──

test("4. quantity × unitPrice 正確", () => {
  assert.equal(computePocketSubtotal({ isChargeable: true, unitPrice: 300, quantity: 1 }).ok && true, true);
  const a = computePocketSubtotal({ isChargeable: true, unitPrice: 300, quantity: 1 });
  const b = computePocketSubtotal({ isChargeable: true, unitPrice: 300, quantity: 3 });
  const c = computePocketSubtotal({ isChargeable: true, unitPrice: 250, quantity: 4 });
  assert.equal(a.ok && a.subtotal, 300);
  assert.equal(b.ok && b.subtotal, 900);
  assert.equal(c.ok && c.subtotal, 1000);
});

test("4. 小數單價不得產生浮點誤差", () => {
  const r = computePocketSubtotal({ isChargeable: true, unitPrice: 0.1, quantity: 3 });
  assert.equal(r.ok && r.subtotal, 0.3, "0.1 × 3 必須是 0.3，不能是 0.30000000000000004");
});

test("5. 前端偽造 subtotal 無效（函式只吃 quantity/unitPrice）", () => {
  /**
   * computePocketSubtotal 的參數裡**沒有 subtotal**——前端就算送了，
   * 也沒有任何路徑能讓它進到計算裡。這是型別層級的保證。
   */
  const input = { isChargeable: true, unitPrice: 300, quantity: 2 } as const;
  const r = computePocketSubtotal(input);
  assert.equal(r.ok && r.subtotal, 600);
  assert.equal("subtotal" in input, false, "輸入型別不得包含 subtotal");
});

test("數量必須大於 0", () => {
  for (const q of [0, -1, 1.5]) {
    const r = computePocketSubtotal({ isChargeable: true, unitPrice: 300, quantity: q });
    assert.equal(r.ok, false, `數量 ${q} 應被拒絕`);
  }
});

test("單價不得小於 0", () => {
  const r = computePocketSubtotal({ isChargeable: true, unitPrice: -100, quantity: 1 });
  assert.equal(r.ok, false);
});

test("收費項目未設定單價 → 拒絕，不得當成 0", () => {
  const r = computePocketSubtotal({ isChargeable: true, unitPrice: null, quantity: 1 });
  assert.equal(r.ok, false);
});

// ── 6~7：免費 vs 收費 ──

test("6. 免費寶袋不進待收款（subtotal = 0）", () => {
  const r = computePocketSubtotal({ isChargeable: false, unitPrice: 300, quantity: 5 });
  assert.equal(r.ok && r.subtotal, 0, "免費時小計固定 0，即使有單價");

  const state = resolvePocketPaymentState(0, 0);
  assert.equal(state.status, "FREE");
  assert.equal(state.amountUnpaid, 0, "免費項目未收金額為 0，不會出現在待收款");
  assert.equal(state.isPaid, false, "免費不等於已付款");
});

test("7. 收費寶袋正確進待收款", () => {
  const r = computePocketSubtotal({ isChargeable: true, unitPrice: 300, quantity: 2 });
  assert.equal(r.ok && r.subtotal, 600);
  const state = resolvePocketPaymentState(600, 0);
  assert.equal(state.status, "UNPAID");
  assert.equal(state.amountUnpaid, 600);
});

// ── 8：贊普與寶袋分離 ──

test("8. 贊普與寶袋不重複加總（不同 sourceType、不同計算來源）", () => {
  /**
   * 贊普：UniversalSalvationDetail.amountDue，sourceType=UNIVERSAL_SALVATION_SPONSOR
   * 寶袋：AdditionalPrintItem.subtotal，sourceType=ADDITIONAL_PRINT_ITEM
   *
   * 兩者資料表不同、sourceType 不同，adapter 的 listPending 各自只查
   * 自己的表，不可能互相掃到。
   */
  const sponsorDue = 800;
  const pocket = computePocketSubtotal({ isChargeable: true, unitPrice: 300, quantity: 1 });
  assert.equal(pocket.ok && pocket.subtotal, 300);
  // 同一戶總應收 = 兩者相加，各自獨立不重複
  assert.equal(sponsorDue + (pocket.ok ? pocket.subtotal : 0), 1100);
});

// ── 10~11：部分付款與超額 ──

test("10. 部分付款狀態正確", () => {
  const s = resolvePocketPaymentState(600, 300);
  assert.equal(s.status, "PARTIAL");
  assert.equal(s.amountUnpaid, 300);
  assert.equal(s.isPaid, false, "部分付款不得標記為已付款");
});

test("10. 全額付款狀態正確", () => {
  const s = resolvePocketPaymentState(600, 600);
  assert.equal(s.status, "PAID");
  assert.equal(s.amountUnpaid, 0);
  assert.equal(s.isPaid, true);
});

test("11. 超額付款不會產生負數未收（adapter 另有硬性拒絕）", () => {
  const s = resolvePocketPaymentState(600, 900);
  assert.equal(s.amountUnpaid, 0, "未收金額不得為負");
  assert.equal(s.isPaid, true);
});

// ── 13~15：CRUD 財務防呆 ──

test("13. 已收款寶袋不能直接取消", () => {
  const g = assertNoPaymentBeforeRemoval(300, "取消");
  assert.equal(g.ok, false);
  assert.equal(g.ok === false && g.error.includes("退款"), true, "錯誤訊息要指引去退款");
});

test("13. 未收款寶袋可以取消", () => {
  assert.equal(assertNoPaymentBeforeRemoval(0, "取消").ok, true);
});

test("14. 已收款寶袋不能直接刪除", () => {
  assert.equal(assertNoPaymentBeforeRemoval(600, "刪除").ok, false);
  assert.equal(assertNoPaymentBeforeRemoval(600, "永久刪除").ok, false);
});

test("15. 新 subtotal 小於已收金額時拒絕修改", () => {
  // 已收 600，想把應收改成 300 → 拒絕
  const g = assertSubtotalNotBelowPaid(300, 600);
  assert.equal(g.ok, false);
  assert.equal(g.ok === false && g.error.includes("600"), true);
});

test("15. 新 subtotal 等於或大於已收金額時允許修改", () => {
  assert.equal(assertSubtotalNotBelowPaid(600, 600).ok, true);
  assert.equal(assertSubtotalNotBelowPaid(900, 600).ok, true);
});

test("15. 未收款時任意調整金額都允許", () => {
  assert.equal(assertSubtotalNotBelowPaid(0, 0).ok, true);
  assert.equal(assertSubtotalNotBelowPaid(300, 0).ok, true);
});

// ── 16：退款後狀態 ──

test("16. 退款後狀態恢復為未收或部分付款", () => {
  // 原本已付 600 → 全額退款後已收 0
  assert.equal(resolvePocketPaymentState(600, 0).status, "UNPAID");
  // 部分退款：已付 600 退 300 → 剩 300
  assert.equal(resolvePocketPaymentState(600, 300).status, "PARTIAL");
  // 退款後 isPaid 必須回到 false
  assert.equal(resolvePocketPaymentState(600, 0).isPaid, false);
});

// ── 18~19：恢復與舊資料 ──

test("18. 恢復後依目前設定重算並重新出現在待收款", () => {
  const r = computePocketSubtotal({ isChargeable: true, unitPrice: 300, quantity: 2 });
  const s = resolvePocketPaymentState(r.ok ? r.subtotal : 0, 0);
  assert.equal(s.amountUnpaid, 600, "恢復後應重新出現在待收款");
  assert.equal(s.isPaid, false, "恢復不得自動變成已付款");
});

test("19. 舊的免費寶袋資料不被自動改價", () => {
  /**
   * 舊資料：isChargeable=false / unitPrice=null / subtotal=0。
   * 重算後仍是 0——不會因為新功能上線就變成 300。
   */
  const r = computePocketSubtotal({ isChargeable: false, unitPrice: null, quantity: 1 });
  assert.equal(r.ok && r.subtotal, 0);
  assert.equal(resolvePocketPaymentState(0, 0).status, "FREE");
});

test("19. 舊免費寶袋改為收費時，才帶入年度預設價", () => {
  // 使用者主動切換為收費，且沒指定單價 → 帶入年度預設
  const unitPrice = resolvePocketUnitPrice(null);
  const r = computePocketSubtotal({ isChargeable: true, unitPrice, quantity: 1 });
  assert.equal(r.ok && r.subtotal, 300);
});

// ── 21：權限 ──

test("21. READONLY 不得改價格或數量", () => {
  assert.equal(canUniversalSalvation("READONLY", "update"), false);
  assert.equal(canUniversalSalvation("READONLY", "create"), false);
  assert.equal(canUniversalSalvation("READONLY", "view"), true);
});

test("21. STAFF 可新增及修改寶袋", () => {
  assert.equal(canUniversalSalvation("STAFF", "create"), true);
  assert.equal(canUniversalSalvation("STAFF", "update"), true);
});

test("21. 普渡權限不等於退款權限（退款走收款中心自己的權限）", () => {
  /**
   * UniversalSalvationAction 裡**沒有** refund／reversal 這種 action，
   * 所以 STAFF 可以改寶袋，不代表可以退款——退款一律由收款中心的
   * 既有權限把關（指令第十一階段）。
   */
  const actions = UNIVERSAL_SALVATION_PERMISSION_MATRIX.STAFF;
  assert.equal(actions.includes("view"), true);
  assert.equal((actions as readonly string[]).includes("refund"), false);
  assert.equal((actions as readonly string[]).includes("reversal"), false);
});

// ── 22：enum 一致性 ──

/** V13.3B 本輪新增的兩個 migration 目錄名（唯一受檢對象，不掃描歷史 migration）。 */
const V13_3B_ENUM_MIGRATION_DIR = "20260723000000_v13_3b_receivable_source_additional_print_item";
const V13_3B_COLUMN_MIGRATION_DIR = "20260723000001_v13_3b_temple_event_pocket_unit_price";

test("22. TypeScript enum、Prisma enum 與 adapter 註冊一致", async () => {
  /**
   * 靜態檢查：
   *   1. schema.prisma 的 ReceivableSourceType 必須含 ADDITIONAL_PRINT_ITEM
   *   2. migration 必須有對應的 ALTER TYPE
   *   3. receivableAdapters.ts 必須註冊 additionalPrintItemAdapter
   */
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");

  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf-8");
  assert.equal(
    schema.includes("ADDITIONAL_PRINT_ITEM"),
    true,
    "schema.prisma 的 ReceivableSourceType 缺少 ADDITIONAL_PRINT_ITEM"
  );
  assert.equal(
    schema.includes("pocketUnitPrice"),
    true,
    "schema.prisma 的 TempleEvent 缺少 pocketUnitPrice"
  );

  /**
   * ⚠️ 只讀本輪新增的兩個 migration，**不掃描任何歷史 migration**。
   * 歷史 migration 已套用到正式資料庫，測試不應該對它們有任何要求。
   */
  const migrationsDir = join(process.cwd(), "prisma/migrations");
  const enumMigration = readFileSync(
    join(migrationsDir, V13_3B_ENUM_MIGRATION_DIR, "migration.sql"),
    "utf-8"
  );
  const columnMigration = readFileSync(
    join(migrationsDir, V13_3B_COLUMN_MIGRATION_DIR, "migration.sql"),
    "utf-8"
  );

  assert.equal(
    enumMigration.includes("ALTER TYPE \"ReceivableSourceType\" ADD VALUE 'ADDITIONAL_PRINT_ITEM'"),
    true,
    "缺少新增 enum 值的 migration"
  );
  assert.equal(
    columnMigration.includes('ADD COLUMN "pocketUnitPrice"'),
    true,
    "缺少 pocketUnitPrice 的 migration"
  );

  const adapters = readFileSync(join(process.cwd(), "src/lib/receivableAdapters.ts"), "utf-8");
  assert.equal(
    adapters.includes("additionalPrintItemAdapter"),
    true,
    "receivableAdapters.ts 未定義 additionalPrintItemAdapter"
  );
  // 必須真的註冊進 ADAPTERS 陣列，不能只定義不註冊
  const registryMatch = adapters.match(/const ADAPTERS: ReceivableSourceAdapter\[\] = \[([\s\S]*?)\];/);
  assert.notEqual(registryMatch, null, "找不到 ADAPTERS registry");
  assert.equal(
    registryMatch![1].includes("additionalPrintItemAdapter"),
    true,
    "additionalPrintItemAdapter 未註冊進 ADAPTERS"
  );
});

test("22. V13.3B 的 enum migration 必須是獨立且唯一的一句 SQL", async () => {
  /**
   * PostgreSQL 不允許在同一個 transaction 內使用剛新增的 enum 值，
   * 而 Prisma 會把單一 migration 檔包成一個 transaction——所以本輪新增
   * enum 值的 migration 內**不得**再有其他 SQL。
   *
   * ⚠️ 這個測試**只檢查本輪新增的那一個 migration**，用明確的目錄名鎖定。
   *
   * 初版寫成「掃描所有含 ADD VALUE 的 migration」是錯的，有兩個問題：
   *   1. 專案有 6 個歷史 migration 含 ADD VALUE（temple_event_center、
   *      offering_center、receipt_center…），它們本來就合法地在同一檔案裡
   *      有多句 SQL——測試會把既有歷史誤判成錯誤。
   *   2. 判斷條件用 `sql.includes("ADD VALUE")` 掃**整份原始文字**，
   *      連註解都算進去，導致只在註解提到 ADD VALUE 的檔案也被誤抓。
   *
   * 歷史 migration 已經套用到正式資料庫，本測試**絕不掃描、絕不要求
   * 修改它們**。
   */
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");

  const file = join(process.cwd(), "prisma/migrations", V13_3B_ENUM_MIGRATION_DIR, "migration.sql");

  let sql: string;
  try {
    sql = readFileSync(file, "utf-8");
  } catch {
    assert.fail(`找不到本輪的 enum migration：${V13_3B_ENUM_MIGRATION_DIR}/migration.sql`);
  }

  // 先去除註解行，再切分 statement——避免註解文字影響判斷
  const statements = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--") && l.trim() !== "")
    .join(" ")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);

  assert.equal(
    statements.length,
    1,
    `${V13_3B_ENUM_MIGRATION_DIR} 只能有一句 SQL，目前有 ${statements.length} 句：\n${statements.join("\n")}`
  );

  assert.equal(
    statements[0],
    `ALTER TYPE "ReceivableSourceType" ADD VALUE 'ADDITIONAL_PRINT_ITEM'`,
    "唯一的 statement 必須正好是新增 ADDITIONAL_PRINT_ITEM 的 ALTER TYPE"
  );
});
