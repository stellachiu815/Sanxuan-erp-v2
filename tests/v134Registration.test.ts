import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  resolveRegistrationFormType,
  suggestRegistrationFormType,
  isLanternActivityType,
  isHouseholdLevelLantern,
  requiresActivitySpecificContent,
  REGISTRATION_FORM_TYPES,
} from "../src/lib/registrationFormTypes";
import {
  computeLanternAmountDue,
  DEFAULT_LANTERN_UNIT_PRICE,
} from "../src/lib/lanternRegistration";
import {
  buildActivityPrintProfile,
  toParticipantSnapshot,
  renderSnapshotTexts,
} from "../src/lib/activityPrintProfile";
import {
  canRitualRegistration,
  RITUAL_REGISTRATION_PERMISSION_MATRIX,
  type Role,
} from "../src/lib/permissions";
import { formatIsoDateToMinguoLong } from "../src/lib/minguoDate";
import { mapWithConcurrency, runWithConcurrency } from "../src/lib/concurrency";

/**
 * V13.4：信眾詳情 × 全活動報名 × 年度沿用 測試。
 */

const ROOT = process.cwd();

// ============================================================
// 一、列印生日與歲數（指令二、九）
// ============================================================

test("1. 所有活動列印一律使用農曆生日，不使用國曆生日", () => {
  const profile = buildActivityPrintProfile({
    activityMinguoYear: 116,
    solarBirthDate: new Date(Date.UTC(1990, 3, 25)),
    lunarBirthYear: null,
    lunarBirthMonth: null,
    lunarBirthDay: null,
    lunarIsLeapMonth: false,
    gender: "男",
    referenceDate: new Date(Date.UTC(2027, 1, 15)),
  });
  // 農曆生日欄位算得出來
  assert.notEqual(profile.lunarBirthYear, null);
  assert.equal(profile.lunarBirthText.includes("農曆"), true);
  // 列印文字不得出現國曆日期格式
  assert.equal(profile.lunarBirthText.includes("1990-04-25"), false);
});

test("2. 歲數依活動年度計算，不依系統目前日期", () => {
  const base = {
    solarBirthDate: new Date(Date.UTC(1990, 3, 25)),
    lunarBirthYear: null,
    lunarBirthMonth: null,
    lunarBirthDay: null,
    lunarIsLeapMonth: false,
    gender: "男" as string | null,
    referenceDate: null,
  };
  const y115 = buildActivityPrintProfile({ ...base, activityMinguoYear: 115 });
  const y116 = buildActivityPrintProfile({ ...base, activityMinguoYear: 116 });
  assert.notEqual(y115.nominalAge, null);
  assert.equal((y116.nominalAge ?? 0) - (y115.nominalAge ?? 0), 1);
});

test("3. 年底提前列印隔年活動時，虛歲正確加一（不會少算）", () => {
  /**
   * 民國 115 年底建立 116 年度年度燈，即使尚未過農曆年，
   * 列印一律使用 116 年度的虛歲。
   */
  const base = {
    solarBirthDate: new Date(Date.UTC(1990, 3, 25)),
    lunarBirthYear: null,
    lunarBirthMonth: null,
    lunarBirthDay: null,
    lunarIsLeapMonth: false,
    gender: "女" as string | null,
    referenceDate: null,
  };
  const thisYear = buildActivityPrintProfile({ ...base, activityMinguoYear: 115 });
  const nextYear = buildActivityPrintProfile({ ...base, activityMinguoYear: 116 });
  assert.equal((nextYear.nominalAge ?? 0) > (thisYear.nominalAge ?? 0), true);
  assert.equal(nextYear.activityYearText.includes("一百一十六"), true);
});

test("4. 舊年度重新列印不受目前生日修改影響（讀快照）", () => {
  const profile = buildActivityPrintProfile({
    activityMinguoYear: 115,
    solarBirthDate: new Date(Date.UTC(1990, 3, 25)),
    lunarBirthYear: null,
    lunarBirthMonth: null,
    lunarBirthDay: null,
    lunarIsLeapMonth: false,
    gender: "男",
    referenceDate: null,
  });
  const snapshot = toParticipantSnapshot(profile);
  const texts = renderSnapshotTexts(snapshot);

  // 快照獨立於 Member：即使之後改生日，這組文字仍由快照決定
  assert.equal(texts.lunarBirthText, profile.lunarBirthText);
  assert.equal(texts.nominalAgeText, profile.nominalAgeText);
  assert.notEqual(snapshot.lunarBirthYearSnapshot, null);
  assert.notEqual(snapshot.printProfileSnapshotAt, null);
});

test("生日資料不完整時，列印欄位保持空白，不猜測", () => {
  const profile = buildActivityPrintProfile({
    activityMinguoYear: 116,
    solarBirthDate: null,
    lunarBirthYear: null,
    lunarBirthMonth: null,
    lunarBirthDay: null,
    lunarIsLeapMonth: false,
    gender: null,
    referenceDate: null,
  });
  assert.equal(profile.lunarBirthText, "");
  assert.equal(profile.nominalAgeText, "");
  assert.equal(profile.nominalAge, null);
  assert.equal(profile.issues.length > 0, true);
});

// ============================================================
// 二、報名表型態分派（指令四、五）
// ============================================================

test("5. 未設定 registrationFormType 的活動禁止確認報名，不得降級成通用", () => {
  const nullResult = resolveRegistrationFormType(null);
  assert.equal(nullResult.supported, false);
  assert.equal(nullResult.supported === false && nullResult.reason.includes("尚未完成報名表設定"), true);

  const emptyResult = resolveRegistrationFormType("");
  assert.equal(emptyResult.supported, false);
});

test("5. 未支援的表單型態同樣禁止，不降級", () => {
  const r = resolveRegistrationFormType("SOME_FUTURE_ACTIVITY");
  assert.equal(r.supported, false);
  // 絕不回傳 GENERIC
  assert.equal(JSON.stringify(r).includes("GENERIC"), false);
});

test("已支援的四種表單型態可正確解析", () => {
  for (const t of REGISTRATION_FORM_TYPES) {
    const r = resolveRegistrationFormType(t);
    assert.equal(r.supported, true);
    assert.equal(r.supported && r.formType, t);
  }
});

test("活動類型 → 表單型態建議正確", () => {
  assert.equal(suggestRegistrationFormType("UNIVERSAL_SALVATION"), "UNIVERSAL_SALVATION");
  assert.equal(suggestRegistrationFormType("PURIFICATION"), "PURIFICATION");
  assert.equal(suggestRegistrationFormType("GUANGMING_LANTERN"), "LANTERN");
  assert.equal(suggestRegistrationFormType("TAISUI_LANTERN"), "LANTERN");
  assert.equal(suggestRegistrationFormType("FAMILY_LANTERN"), "LANTERN");
  assert.equal(suggestRegistrationFormType("TEMPLE_CELEBRATION"), "GENERIC");
});

test("只有 GENERIC 不需要專屬子表內容", () => {
  assert.equal(requiresActivitySpecificContent("GENERIC"), false);
  assert.equal(requiresActivitySpecificContent("UNIVERSAL_SALVATION"), true);
  assert.equal(requiresActivitySpecificContent("PURIFICATION"), true);
  assert.equal(requiresActivitySpecificContent("LANTERN"), true);
});

// ============================================================
// 三、年度燈計價（指令十）
// ============================================================

test("6. 個人燈：應收 = 單價 × 人數", () => {
  const r = computeLanternAmountDue({
    activityType: "GUANGMING_LANTERN",
    participantCount: 3,
    unitPrice: 500,
  });
  assert.equal(r.ok && r.amountDue, 1500);
});

test("6. 全家燈：整戶一筆，與人數無關", () => {
  const one = computeLanternAmountDue({
    activityType: "FAMILY_LANTERN",
    participantCount: 1,
    unitPrice: 2000,
  });
  const five = computeLanternAmountDue({
    activityType: "FAMILY_LANTERN",
    participantCount: 5,
    unitPrice: 2000,
  });
  assert.equal(one.ok && one.amountDue, 2000);
  assert.equal(five.ok && five.amountDue, 2000, "全家燈不因人數增加而變貴");
});

test("年度燈未設定單價時使用預設價", () => {
  const r = computeLanternAmountDue({
    activityType: "TAISUI_LANTERN",
    participantCount: 2,
    unitPrice: null,
  });
  assert.equal(r.ok && r.amountDue, DEFAULT_LANTERN_UNIT_PRICE * 2);
});

test("年度燈：負數單價與零人數被拒絕", () => {
  assert.equal(
    computeLanternAmountDue({
      activityType: "GUANGMING_LANTERN",
      participantCount: 1,
      unitPrice: -1,
    }).ok,
    false
  );
  assert.equal(
    computeLanternAmountDue({
      activityType: "GUANGMING_LANTERN",
      participantCount: 0,
      unitPrice: 500,
    }).ok,
    false
  );
});

test("三種燈都被辨識為年度燈；只有全家燈是家戶型", () => {
  assert.equal(isLanternActivityType("GUANGMING_LANTERN"), true);
  assert.equal(isLanternActivityType("TAISUI_LANTERN"), true);
  assert.equal(isLanternActivityType("FAMILY_LANTERN"), true);
  assert.equal(isLanternActivityType("UNIVERSAL_SALVATION"), false);

  assert.equal(isHouseholdLevelLantern("FAMILY_LANTERN"), true);
  assert.equal(isHouseholdLevelLantern("GUANGMING_LANTERN"), false);
});

// ============================================================
// 四、權限（指令十二）
// ============================================================

const ALL_ACTIONS = [
  "view",
  "register",
  "manageParticipant",
  "carryOver",
  "createLantern",
  "cancel",
] as const;

test("7. SUPER_ADMIN／ADMIN／STAFF 可執行全部報名操作", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "STAFF"] as Role[]) {
    for (const a of ALL_ACTIONS) {
      assert.equal(canRitualRegistration(role, a), true, `${role} 應可 ${a}`);
    }
  }
});

test("7. READONLY 只能查看，所有寫入一律拒絕", () => {
  assert.equal(canRitualRegistration("READONLY", "view"), true);
  for (const a of ALL_ACTIONS.filter((x) => x !== "view")) {
    assert.equal(canRitualRegistration("READONLY", a), false, `READONLY 不得 ${a}`);
  }
});

test("7. FINANCE_CLERK 與未知角色一律拒絕", () => {
  for (const a of ALL_ACTIONS) {
    assert.equal(canRitualRegistration("FINANCE_CLERK", a), false);
    assert.equal(canRitualRegistration("NOT_A_ROLE" as Role, a), false);
  }
});

test("報名權限不含退款——退款走收款中心自己的權限", () => {
  const staff = RITUAL_REGISTRATION_PERMISSION_MATRIX.STAFF as readonly string[];
  assert.equal(staff.includes("refund"), false);
  assert.equal(staff.includes("reversal"), false);
});

// ============================================================
// 五、靜態掃描（結構性保證）
// ============================================================

function findRoutes(dir: string, filter: (p: string) => boolean, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) findRoutes(full, filter, acc);
    else if (name === "route.ts" && filter(full)) acc.push(full);
  }
  return acc;
}

test("8. 所有新增的報名 API 都有權限檢查", () => {
  /**
   * ⚠️ 只檢查 V13.4 **本輪新增**的 API。
   *
   * 路徑比對必須夠精確——`/registrations/` 這個片段也會命中既有的
   * 祭改 API（/api/purification/registrations/...），那些是 V9.0 的舊
   * 模組，有自己的權限機制，不在本輪範圍。
   */
  const V13_4_API_PREFIXES = [
    join(ROOT, "src/app/api/registrations"),
    join(ROOT, "src/app/api/devotee-center"),
  ];
  const targets = findRoutes(
    join(ROOT, "src/app/api"),
    (p) =>
      V13_4_API_PREFIXES.some((prefix) => p.startsWith(prefix)) &&
      (p.includes("/registrations/") ||
        p.includes("activity-registrations") ||
        p.includes("available-activities"))
  );
  assert.equal(targets.length > 0, true, "應該找得到新的報名 API");

  const missing: string[] = [];
  for (const file of targets) {
    const src = readFileSync(file, "utf-8");
    for (const m of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
      if (!new RegExp(`export async function ${m}\\(`).test(src)) continue;
      if (!src.includes("assertRitualRegistrationPermissionForOperator")) {
        missing.push(`${m} ${file.replace(ROOT, "")}`);
      }
    }
  }
  assert.deepEqual(missing, [], `以下 handler 缺少權限檢查：\n${missing.join("\n")}`);
});

test("9. 報名相關前端一律透過 fetchRegistration 帶身分（不得有裸 fetch）", () => {
  /**
   * V13.3A 的教訓：後端加了權限、前端沒帶身分 → 整個模組 401。
   * 這個測試讓那種迴歸在 CI 就被抓到。
   */
  const files = [
    "src/components/registration/ParticipantSelector.tsx",
    "src/components/registration/LanternRegistrationEditor.tsx",
    "src/components/registration/RegistrationEditor.tsx",
    "src/components/devotee/NewActivityRegistrationDialog.tsx",
  ];
  const violations: string[] = [];
  for (const f of files) {
    const full = join(ROOT, f);
    if (!existsSync(full)) continue;
    const src = readFileSync(full, "utf-8");
    // 允許 fetchRegistration；不允許裸 fetch(
    const bare = src.match(/(?<!fetchRegistration|fetchUniversalSalvation)\bfetch\(/g);
    if (bare && bare.length > 0) violations.push(f);
  }
  assert.deepEqual(violations, [], `以下元件仍有未帶身分的 fetch：\n${violations.join("\n")}`);
});

test("10. 所有建立 RitualRecord 的入口都會寫入 RitualParticipant", () => {
  /**
   * 指令十八：V13.4 上線後不得再產生沒有 participant 的新活動資料。
   */
  const libFiles = [
    "src/lib/templeEvents.ts",
    "src/lib/purification.ts",
    "src/lib/soulTabletFlow.ts",
    "src/lib/activityRegistration.ts",
  ];
  const missing: string[] = [];
  for (const f of libFiles) {
    const full = join(ROOT, f);
    if (!existsSync(full)) continue;
    const src = readFileSync(full, "utf-8");
    if (!src.includes("ritualRecord.create")) continue;
    if (!src.includes("upsertParticipant")) missing.push(f);
  }
  assert.deepEqual(missing, [], `以下檔案建立 RitualRecord 但未寫 participant：\n${missing.join("\n")}`);
});

test("11. 三個既有收款 adapter 都已排除草稿（只收 CONFIRMED）", () => {
  const src = readFileSync(join(ROOT, "src/lib/receivableAdapters.ts"), "utf-8");
  const confirmedGuards = src.match(/status: "CONFIRMED"/g) ?? [];
  // 贊普 + 祭改 + 寶袋 + 年度燈 = 至少 4 處
  assert.equal(
    confirmedGuards.length >= 4,
    true,
    `應至少有 4 個 adapter 排除草稿，實際 ${confirmedGuards.length}`
  );
  assert.equal(src.includes("lanternRegistrationAdapter"), true, "年度燈 adapter 未定義");

  const registry = src.match(/const ADAPTERS: ReceivableSourceAdapter\[\] = \[([\s\S]*?)\];/);
  assert.notEqual(registry, null);
  assert.equal(
    registry![1].includes("lanternRegistrationAdapter"),
    true,
    "年度燈 adapter 未註冊進 ADAPTERS"
  );
});

test("12. 沿用去年不得複製付款、收據、列印與對帳狀態", () => {
  const src = readFileSync(join(ROOT, "src/lib/ritual.ts"), "utf-8");
  const copyFn = src.slice(src.indexOf("copyUniversalSalvationFromPreviousYear"));
  const forbidden = [
    "amountPaid: universalSalvation.amountPaid",
    "amountUnpaid: universalSalvation.amountUnpaid",
    "isPrinted",
    "printedQuantity",
    "printedAt",
    "reprintCount",
    "receiptNumber",
    "printBatchId",
  ];
  const found = forbidden.filter((f) => copyFn.includes(f));
  assert.deepEqual(found, [], `沿用去年複製了不該複製的狀態：${found.join("、")}`);

  // 桌號預設不沿用
  assert.equal(
    copyFn.includes("copyTableNumber ? universalSalvation.tableNumber : null"),
    true,
    "桌號應預設不沿用，只有明確勾選才帶入"
  );
  // amountDue 依沿用的贊普金額重算
  assert.equal(copyFn.includes("amountDue:"), true, "amountDue 應依本年度贊普金額重算");
});

test("13. Migration 為純附加，不含破壞性操作", () => {
  const dirs = [
    "20260724000000_v13_4_ritual_participants",
    "20260724000001_v13_4_lantern_and_form_type",
    "20260724000002_v13_4_receivable_source_lantern",
  ];
  /**
   * ⚠️ 破壞性操作只能由「敘述開頭」的關鍵字判定，不能用單純字串包含。
   *
   * 天真的 `sql.includes("UPDATE ")` 會誤判以下合法內容：
   *   - 外鍵子句 `ON DELETE RESTRICT ON UPDATE CASCADE`
   *   - 欄位名 `"updatedAt"`
   *   - constraint／index 名稱、註解內文
   *
   * 正確做法：先剝除 `--` 行註解 → 以 `;` 切成一句一句 → 每句去掉前導
   * 空白後，只看「這一句是不是以破壞性指令開頭」。
   * 對 UPDATE 另外要求 `UPDATE <table> SET` 的實際改資料語法，
   * 才不會被 `ON UPDATE CASCADE` 這種子句誤觸。
   */
  const DESTRUCTIVE_PREFIXES: RegExp[] = [
    /^DROP\s+TABLE\b/i,
    /^ALTER\s+TABLE\s+\S+\s+DROP\s+COLUMN\b/i, // 真正刪欄位
    /^DROP\s+COLUMN\b/i,
    /^TRUNCATE\b/i,
    /^DELETE\s+FROM\b/i,
    /^UPDATE\s+\S+\s+SET\b/i, // 只擋真正改資料的 UPDATE ... SET
  ];

  for (const d of dirs) {
    const file = join(ROOT, "prisma/migrations", d, "migration.sql");
    assert.equal(existsSync(file), true, `缺少 migration：${d}`);

    const statements = readFileSync(file, "utf-8")
      // ① 逐行剝除 `--` 行註解（保留行內 code 前段，雖然本專案 migration 皆為整行註解）
      .split("\n")
      .map((l) => {
        const i = l.indexOf("--");
        return i >= 0 ? l.slice(0, i) : l;
      })
      .join("\n")
      // ② 以分號切成一句一句（enum/CREATE/ALTER 每句自成一體）
      .split(";")
      // ③ 壓平換行與多餘空白，只留「這一句開頭」可判讀
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    for (const stmt of statements) {
      const hit = DESTRUCTIVE_PREFIXES.find((re) => re.test(stmt));
      assert.equal(
        hit,
        undefined,
        `${d} 含破壞性敘述：「${stmt.slice(0, 60)}…」`
      );
    }
  }
});

test("13. enum ADD VALUE 必須是獨立且唯一的一句 SQL", () => {
  const file = join(
    ROOT,
    "prisma/migrations/20260724000002_v13_4_receivable_source_lantern/migration.sql"
  );
  const statements = readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--") && l.trim() !== "")
    .join(" ")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
  assert.equal(statements.length, 1);
  assert.equal(
    statements[0],
    `ALTER TYPE "ReceivableSourceType" ADD VALUE 'LANTERN_REGISTRATION'`
  );
});

test("14. RitualParticipant 對 Member 使用 Restrict，保護歷史報名", () => {
  const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf-8");
  const model = schema.slice(
    schema.indexOf("model RitualParticipant"),
    schema.indexOf("model LanternRegistration")
  );
  assert.equal(
    model.includes("onDelete: Restrict"),
    true,
    "Member 會被永久刪除（recycleBin），必須用 Restrict 保護歷史報名"
  );
  // 個別成員不應有 status（避免三套狀態不一致）
  assert.equal(
    /^\s+status\s+RitualRecordStatus/m.test(model),
    false,
    "RitualParticipant 不應有 status——報名狀態由 RitualRecord 管理"
  );
});

test("15. RitualRecord.memberId 保留並標記 deprecated", () => {
  const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf-8");
  const model = schema.slice(
    schema.indexOf("model RitualRecord"),
    schema.indexOf("model RitualParticipant")
  );
  assert.equal(model.includes("memberId"), true, "memberId 不得移除");
  assert.equal(model.includes("@deprecated"), true, "memberId 應標記 deprecated");
});

// ============================================================
// 六、信眾詳情頁「正式 render tree」實際掛載活動報名入口（第一項驗收）
// ============================================================

/**
 * ⚠️ 這一節不是「檢查元件檔存在」，而是驗證正式路由
 * /devotee-center/[memberId] 的**預設畫面 render tree** 真的掛上了入口：
 *
 *   DevoteeDetailPage（export default）
 *     → DevoteeDetailInner            預設 tab = "總覽"
 *       → tab==="總覽" && <OverviewTab …/>
 *         → OverviewTab 內 render <NewActivityRegistrationDialog/>
 *
 * 只要其中一環斷掉（改了預設 tab、把入口搬去只在別的 tab、OverviewTab 不再
 * 引用對話框），這個測試就會紅，避免再次「功能有寫但正式畫面看不到」。
 */
const DEVOTEE_PAGE = readFileSync(
  join(ROOT, "src/app/devotee-center/[memberId]/page.tsx"),
  "utf-8"
);

/** 取出某個具名 function 的函式主體（到下一個 top-level `\nfunction ` 為止）。 */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return "";
  const after = src.indexOf("\nfunction ", start + 1);
  return src.slice(start, after < 0 ? undefined : after);
}

test("16. 正式詳情頁預設 tab 是「總覽」，且總覽掛載 OverviewTab", () => {
  assert.equal(
    /useState<\(typeof TABS\)\[number\]>\("總覽"\)/.test(DEVOTEE_PAGE),
    true,
    "預設 tab 必須是總覽——若改掉，落地畫面就不是總覽了"
  );
  assert.equal(
    /tab === "總覽" &&\s*[\s\S]{0,80}<OverviewTab/.test(DEVOTEE_PAGE),
    true,
    "總覽 tab 必須渲染 OverviewTab"
  );
});

test("16. 落地的 OverviewTab render tree 確實掛載 NewActivityRegistrationDialog", () => {
  const body = fnBody(DEVOTEE_PAGE, "OverviewTab");
  assert.notEqual(body, "", "找不到 OverviewTab 函式");
  assert.equal(
    body.includes("<NewActivityRegistrationDialog"),
    true,
    "OverviewTab（正式落地畫面）必須實際 render NewActivityRegistrationDialog"
  );
  assert.equal(
    body.includes("＋新增活動報名"),
    true,
    "OverviewTab 必須有『＋新增活動報名』入口按鈕"
  );
});

test("16. 活動報名卡片不得整段被 canRegister 藏掉（載入中/唯讀仍要看得到區塊）", () => {
  const body = fnBody(DEVOTEE_PAGE, "OverviewTab");
  // 卡片本體（活動報名標題）不可被 `{canRegister && ...}` 包住；
  // 只有按鈕以 disabled 控制。用最直接的方式驗證：卡片標題出現在
  // 任何 `canRegister &&` 之前不足以證明，改為檢查按鈕使用 disabled 屬性。
  assert.equal(
    /disabled=\{!canRegister\}/.test(body),
    true,
    "＋新增活動報名 應以 disabled={!canRegister} 控制，而非把整張卡片藏掉"
  );
  // READONLY 仍需看到區塊：卡片標題「活動報名」必須存在於非條件區塊
  assert.equal(body.includes("活動報名"), true, "活動報名卡片標題必須存在");
});

test("16. 使用既有 NewActivityRegistrationDialog，未建立第二套對話框", () => {
  // 全 repo 只能有一個 NewActivityRegistrationDialog 元件定義。
  const dialog = join(ROOT, "src/components/devotee/NewActivityRegistrationDialog.tsx");
  assert.equal(existsSync(dialog), true);
  // page.tsx 以 import 使用它，不是在頁面內重新定義一個對話框。
  assert.equal(
    /import NewActivityRegistrationDialog from "@\/components\/devotee\/NewActivityRegistrationDialog"/.test(
      DEVOTEE_PAGE
    ),
    true
  );
});

// ============================================================
// 七、國曆生日以民國格式顯示（第二項驗收）
// ============================================================

test("17. 1972-08-15 → 民國61年8月15日", () => {
  assert.equal(formatIsoDateToMinguoLong("1972-08-15"), "民國61年8月15日");
});

test("17. 1912-01-01 → 民國1年1月1日（民國元年）", () => {
  assert.equal(formatIsoDateToMinguoLong("1912-01-01"), "民國1年1月1日");
});

test("17. 空值 / null / undefined → 空字串（畫面留白）", () => {
  assert.equal(formatIsoDateToMinguoLong(""), "");
  assert.equal(formatIsoDateToMinguoLong(null), "");
  assert.equal(formatIsoDateToMinguoLong(undefined), "");
});

test("17. 無效日期不得顯示 Invalid Date（回空字串）", () => {
  for (const bad of ["1972-13-40", "not-a-date", "1972/08/15", "19720815", "2000-02-30"]) {
    const out = formatIsoDateToMinguoLong(bad);
    assert.equal(out.includes("Invalid"), false, `「${bad}」不得產生 Invalid Date`);
    assert.equal(out.includes("NaN"), false, `「${bad}」不得產生 NaN`);
  }
});

test("17. 詳情頁國曆欄位改用民國共用函式，不再直接印 ISO 字串", () => {
  assert.equal(
    DEVOTEE_PAGE.includes("formatIsoDateToMinguoLong(b.solarBirthDate)"),
    true,
    "國曆顯示必須經過 formatIsoDateToMinguoLong"
  );
  // 舊寫法（直接印 b.solarBirthDate）不得殘留在國曆欄位
  assert.equal(
    /國曆：<span[^>]*>\{b\.solarBirthDate \?\? "未填寫"\}/.test(DEVOTEE_PAGE),
    false,
    "國曆欄位不得再直接輸出西元 ISO 字串"
  );
});

test("17. 編輯表單國曆預覽（convert API）也回民國格式，不回西元", () => {
  const convert = readFileSync(
    join(ROOT, "src/app/api/birthday/convert/route.ts"),
    "utf-8"
  );
  assert.equal(
    convert.includes("solarFormatted: formatMinguoDateLong(solarDate)"),
    true,
    "國曆預覽 solarFormatted 必須用民國長格式"
  );
});

test("17. 列印流程不受畫面格式修改影響（仍走農曆生日）", () => {
  // 這次只動「畫面國曆顯示」；列印一律走 activityPrintProfile 的農曆生日。
  const profile = buildActivityPrintProfile({
    activityMinguoYear: 116,
    solarBirthDate: new Date(Date.UTC(1972, 7, 15)),
    lunarBirthYear: null,
    lunarBirthMonth: null,
    lunarBirthDay: null,
    lunarIsLeapMonth: false,
    gender: "男",
    referenceDate: null,
  });
  // 列印用的是農曆生日文字，與畫面的民國國曆顯示是兩條路。
  assert.equal(profile.lunarBirthText.includes("農曆"), true);
});

// ============================================================
// 八、連線池 P2024 修正：受控並行、去重、批次查詢
// ============================================================

test("18. mapWithConcurrency 尖峰並行不超過上限，且結果順序正確", async () => {
  let active = 0;
  let peak = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);
  const out = await mapWithConcurrency(items, 3, async (n) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    return n * 2;
  });
  assert.equal(peak <= 3, true, `尖峰並行 ${peak} 不得超過 3`);
  assert.deepEqual(out, items.map((n) => n * 2), "結果需與輸入順序一致");
});

test("18. runWithConcurrency 同樣受控，且任一失敗會往上拋（不吞錯回 0）", async () => {
  let active = 0;
  let peak = 0;
  const mk = (n: number) => async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 3));
    active -= 1;
    return n;
  };
  const res = await runWithConcurrency([mk(1), mk(2), mk(3), mk(4), mk(5)], 2);
  assert.deepEqual(res, [1, 2, 3, 4, 5]);
  assert.equal(peak <= 2, true);

  // 失敗必須傳遞，不得被默默當成 0（指令八）。
  await assert.rejects(
    runWithConcurrency(
      [async () => 1, async () => { throw new Error("boom"); }, async () => 3],
      2
    ),
    /boom/
  );
});

test("18. limit 非法值直接報錯（避免無限或零並行）", () => {
  assert.throws(() => mapWithConcurrency([1], 0, async (x) => x));
  assert.throws(() => mapWithConcurrency([1], -1, async (x) => x));
});

const DEVOTEE360 = readFileSync(join(ROOT, "src/lib/devotee360.ts"), "utf-8");
const COLLECTION_CENTER = readFileSync(join(ROOT, "src/lib/collectionCenter.ts"), "utf-8");

test("19. 信眾 360° 總覽不得一次 Promise.all 啟動過多平行查詢", () => {
  /**
   * 不用「數逗號」估算（多行物件參數會誤判），改為：掃描每個
   * Promise.all([...]) 區塊，數其中出現幾個「昂貴讀取函式」的呼叫。
   * 舊版一次把 9 個放進同一個 Promise.all，正是 P2024 主因；修正後每個
   * 區塊最多 3 個。
   */
  const EXPENSIVE = [
    "getRitualRecordHistory",
    "getPurificationHistory",
    "getOfferingHistory",
    "getPaymentHistory",
    "getReceiptHistory",
    "getDevoteeTagsForMember",
    "listDevoteeInteractions",
    "getDonationStats",
    "getActivityStats",
  ];
  const MAX_PARALLEL = 3;
  const blocks = DEVOTEE360.match(/Promise\.all\(\[[\s\S]*?\]\)/g) ?? [];
  const offenders: string[] = [];
  for (const block of blocks) {
    const count = EXPENSIVE.filter((fn) => block.includes(`${fn}(`)).length;
    if (count > MAX_PARALLEL) offenders.push(`${count} 個昂貴查詢在同一 Promise.all`);
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
  // 明確保證舊的 9 合一寫法已消失：ritual 與 payment 兩支歷史不得同框。
  const nineInOne = blocks.some(
    (b) => b.includes("getRitualRecordHistory(") && b.includes("getReceiptHistory(")
  );
  assert.equal(nineInOne, false, "舊的 9 合一 Promise.all 必須拆開");
});

test("19. 逐筆收據查詢已改為批次（消除 N+1）", () => {
  // 批次解析器存在，且三個歷史查詢都改用它，不再於迴圈內逐筆查 allocation。
  assert.equal(DEVOTEE360.includes("async function getReceiptNumbersForSources"), true);
  assert.equal(
    /getReceiptNumbersForSource\(/.test(DEVOTEE360.replace(/getReceiptNumbersForSources/g, "")),
    false,
    "不得再殘留單筆 getReceiptNumbersForSource 呼叫（已被批次版取代）"
  );
});

test("19. ritual／purification 統計改用共用查詢，不在同一 request 重複查", () => {
  // donation 與 activity 都接收共用資料參數，不再各自 findMany。
  assert.equal(DEVOTEE360.includes("sharedRituals: MemberRitualForStats[]"), true);
  assert.equal(DEVOTEE360.includes("sharedPurifications: MemberPurificationForStats[]"), true);
  // getActivityStats 不再自行查 DB（純計算）。
  const actStart = DEVOTEE360.indexOf("function getActivityStats");
  const actBody = DEVOTEE360.slice(actStart, DEVOTEE360.indexOf("\nfunction ", actStart + 1));
  assert.equal(
    actBody.includes("prisma."),
    false,
    "getActivityStats 應純計算，不得再自行查資料庫"
  );
});

test("19. 收款中心 adapter 以受控並行執行，非一次全部 Promise.all", () => {
  assert.equal(COLLECTION_CENTER.includes("mapWithConcurrency"), true);
  assert.equal(
    /Promise\.all\(\s*sourceTypes\.map/.test(COLLECTION_CENTER),
    false,
    "不得再用 Promise.all 一次啟動全部 adapter"
  );
});

test("19. 統計函式不得吞掉錯誤後回傳 0（避免財務數字錯誤顯示為零）", () => {
  // 掃描 donation/activity 區塊不得出現 catch 後 return 0 的樣式。
  const donStart = DEVOTEE360.indexOf("function getDonationStats");
  const donBody = DEVOTEE360.slice(donStart, DEVOTEE360.indexOf("\nfunction ", donStart + 1));
  assert.equal(/catch[\s\S]{0,120}return\s+0/.test(donBody), false);
  assert.equal(/catch[\s\S]{0,120}P2024/.test(DEVOTEE360), false, "不得針對 P2024 吞錯回 0");
});

test("19. 全專案僅一個 PrismaClient 實例（singleton）", () => {
  function walk(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, acc);
      else if (/\.(ts|tsx)$/.test(name)) acc.push(full);
    }
    return acc;
  }
  const hits = walk(join(ROOT, "src")).filter((f) =>
    readFileSync(f, "utf-8").includes("new PrismaClient")
  );
  assert.deepEqual(
    hits.map((f) => f.replace(ROOT, "")),
    ["/src/lib/prisma.ts"],
    "只允許 src/lib/prisma.ts 建立 PrismaClient"
  );
});
