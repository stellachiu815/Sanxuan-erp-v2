import { prisma } from "@/lib/prisma";
import { REGISTRATION_ITEM_SEED } from "@/lib/registrationItems";
import { activityTypeLabel } from "@/lib/labels";

/**
 * V19「ERP 驗收／健康檢查中心」——只讀資料完整性掃描器。
 *
 * 固定原則：
 *  - 只讀：所有規則僅執行 read（count／groupBy／findMany select），
 *    絕不 update／delete／upsert／寫入任何欄位、金額、列印次數、updatedAt 或交易狀態。
 *  - 規則集中在此 registry，每條規則有固定代碼（模組前綴＋序號），代碼不變。
 *  - 避免 N+1：共用資料（報名項目金額／列印欄位）在 buildContext() 一次載入；
 *    明細列（rows）以「單一 findMany（id in …）」批次補齊，不做逐列查詢。
 *  - 可理解、可追查、可處理：每筆問題提供人可讀摘要、相關資料欄位、問題原因、
 *    可能影響、建議處理方式、可直接前往的處理入口；技術 ID 另放 techIds（折疊區）。
 *  - 不自動修復：只偵測、只回報，不刪除／取消／更新任何正式資料。
 *
 * 程式碼層級的檢查（READONLY 可寫入、API 缺 Session、operatorUserId 冒用、
 * schema／migration／API／UI 一致性、舊模組名稱／第二套流程）無法由「資料」判定，
 * 以 UNKNOWN（無法自動判斷）呈現並註明需程式碼審查，不偽裝成通過。
 */

export type Severity = "PASS" | "WARNING" | "ERROR" | "UNKNOWN";

export type ScanModule =
  | "ACTIVITY"
  | "REGISTRATION"
  | "RICE"
  | "FINANCE"
  | "PRINT"
  | "DEVOTEE"
  | "HOUSEHOLD"
  | "TRANSACTION"
  | "SECURITY"
  | "SYSTEM";

export type DetailField = { label: string; value: string };
export type DetailLink = { label: string; href: string };
/** 單筆（或單一重複群組）可理解的問題明細。 */
export type DetailRow = {
  /** 一句話人可讀摘要（含人名／活動／年度／項目與問題）。 */
  title: string;
  /** 只顯示該規則適用的欄位。 */
  fields: DetailField[];
  /** 可直接前往的處理入口。 */
  links: DetailLink[];
  /** 技術資料（內部 ID），前端放折疊區，不作為主要資訊。 */
  techIds: string[];
};

export type Finding = {
  code: string;
  name: string;
  module: ScanModule;
  severity: Severity;
  /** 人可讀規則層摘要（例：「發現 5 筆重複報名項目」）。 */
  summary: string;
  /** 問題原因：系統如何判定。 */
  cause: string;
  /** 可能影響。 */
  impact: string;
  /** 建議處理方式（一般操作語言；系統不自動處理）。 */
  recommendation: string;
  /** 影響筆數（0＝通過）。 */
  affectedCount: number;
  /** 逐筆明細（最多 50 筆；前端預設顯示前 10 筆並提供顯示更多）。 */
  rows: DetailRow[];
};

export type AcceptanceScanResult = {
  ranAt: string;
  findings: Finding[];
  summary: {
    total: number;
    bySeverity: Record<Severity, number>;
    byModule: Record<ScanModule, { pass: number; warning: number; error: number; unknown: number }>;
  };
};

type ItemLite = {
  id: string;
  status: string;
  amountDue: number;
  amountPaid: number;
  amountUnpaid: number;
  printedAt: Date | null;
  printCount: number;
};

type ScanContext = { now: Date; items: ItemLite[] };

type RuleOutcome = Pick<Finding, "severity" | "summary" | "cause" | "impact" | "recommendation" | "affectedCount" | "rows">;
type Rule = { code: string; name: string; module: ScanModule; run: (ctx: ScanContext) => Promise<RuleOutcome> };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const ROW_LIMIT = 50;

const STATUS_LABEL: Record<string, string> = { DRAFT: "草稿", CONFIRMED: "已確認", CANCELLED: "已取消" };
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;
const money = (n: number) => `${round2(n).toLocaleString("zh-Hant")} 元`;

// ── 處理入口連結（沿用現有路由） ─────────────────────────────
const linkDevotee = (id: string): DetailLink => ({ label: "查看信眾", href: `/devotee-center/${id}` });
const linkHousehold = (id: string): DetailLink => ({ label: "查看家戶", href: `/household/${id}` });
const linkRegistration = (recordId: string): DetailLink => ({ label: "查看報名", href: `/registration/${recordId}` });
const linkCollection = (): DetailLink => ({ label: "查看收款", href: `/collection-center` });
function linkActivity(templeEventId: string | null, activityType: string): DetailLink | null {
  if (!templeEventId) return null;
  return { label: "查看活動", href: activityType === "PURIFICATION" ? `/purification/${templeEventId}` : `/activities/${templeEventId}` };
}

// ── PASS 與 UNKNOWN 小工具 ───────────────────────────────────
function pass(summary: string): RuleOutcome {
  return { severity: "PASS", summary, cause: "", impact: "", recommendation: "", affectedCount: 0, rows: [] };
}
function unknown(cause: string, recommendation: string): RuleOutcome {
  return { severity: "UNKNOWN", summary: "此項無法由資料自動判斷，需程式碼／部署層審查。", cause, impact: "", recommendation, affectedCount: 0, rows: [] };
}

// ============================================================
// 明細列批次補齊（單一 findMany，不 N+1）
// ============================================================

type EnrichedItem = {
  id: string;
  quantity: number;
  amountDue: number;
  amountPaid: number;
  amountUnpaid: number;
  status: string;
  printCount: number;
  memberId: string | null;
  memberName: string | null;
  itemName: string;
  recordId: string;
  year: number;
  activityType: string;
  templeEventId: string | null;
  activityName: string;
  householdId: string;
  householdName: string;
};

async function loadItems(ids: string[]): Promise<EnrichedItem[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.ritualRegistrationItem.findMany({
    where: { id: { in: ids.slice(0, ROW_LIMIT) } },
    select: {
      id: true,
      quantity: true,
      amountDue: true,
      amountPaid: true,
      amountUnpaid: true,
      status: true,
      printCount: true,
      member: { select: { id: true, name: true } },
      registrationItemType: { select: { name: true } },
      ritualRecord: {
        select: {
          id: true,
          year: true,
          activityType: true,
          templeEventId: true,
          templeEvent: { select: { name: true } },
          household: { select: { id: true, name: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    quantity: r.quantity,
    amountDue: Number(r.amountDue ?? 0),
    amountPaid: Number(r.amountPaid ?? 0),
    amountUnpaid: Number(r.amountUnpaid ?? 0),
    status: r.status as string,
    printCount: r.printCount ?? 0,
    memberId: r.member?.id ?? null,
    memberName: r.member?.name ?? null,
    itemName: r.registrationItemType.name,
    recordId: r.ritualRecord.id,
    year: r.ritualRecord.year,
    activityType: r.ritualRecord.activityType as string,
    templeEventId: r.ritualRecord.templeEventId,
    activityName: r.ritualRecord.templeEvent?.name ?? (activityTypeLabel[r.ritualRecord.activityType as string] ?? (r.ritualRecord.activityType as string)),
    householdId: r.ritualRecord.household.id,
    householdName: r.ritualRecord.household.name,
  }));
}

function itemFields(it: EnrichedItem, opts?: { includeFinance?: boolean; includePrint?: boolean }): DetailField[] {
  const f: DetailField[] = [
    { label: "信眾", value: it.memberName ?? "（未指定成員／整戶）" },
    { label: "家戶", value: `${it.householdName}（${it.householdId}）` },
    { label: "活動", value: it.activityName },
    { label: "年度", value: `民國 ${it.year} 年` },
    { label: "報名項目", value: it.itemName },
    { label: "數量", value: String(it.quantity) },
    { label: "狀態", value: statusLabel(it.status) },
  ];
  if (opts?.includeFinance !== false) {
    f.push({ label: "應收", value: money(it.amountDue) }, { label: "已收", value: money(it.amountPaid) }, { label: "未收", value: money(it.amountUnpaid) });
  }
  if (opts?.includePrint) f.push({ label: "已列印", value: it.printCount > 0 ? `是（${it.printCount} 次）` : "否" });
  return f;
}

function itemLinks(it: EnrichedItem): DetailLink[] {
  const links: DetailLink[] = [];
  if (it.memberId) links.push(linkDevotee(it.memberId));
  links.push(linkHousehold(it.householdId));
  const act = linkActivity(it.templeEventId, it.activityType);
  if (act) links.push(act);
  links.push(linkRegistration(it.recordId), linkCollection());
  return links;
}

function itemRow(it: EnrichedItem, opts?: { includeFinance?: boolean; includePrint?: boolean }): DetailRow {
  return {
    title: `${it.memberName ?? "整戶"}・${it.activityName}（民國 ${it.year} 年）的「${it.itemName}」`,
    fields: itemFields(it, opts),
    links: itemLinks(it),
    techIds: [`item=${it.id}`, `record=${it.recordId}`],
  };
}

// ============================================================
// 規則 registry（固定代碼；rows 為可理解明細）
// ============================================================

const RULES: Rule[] = [
  // ── 活動 ACTIVITY ─────────────────────────────────────────
  {
    code: "ACT-001",
    name: "活動缺年度",
    module: "ACTIVITY",
    run: async () => {
      const rows = await prisma.templeEvent.findMany({ where: { year: { lte: 0 } }, select: { id: true, name: true, activityType: true }, take: ROW_LIMIT });
      if (rows.length === 0) return pass("所有活動皆有有效年度。");
      return {
        severity: "ERROR",
        summary: `有 ${rows.length} 個活動的年度無效（為 0 或負數）。`,
        cause: "活動的民國年度欄位為 0 或負數。",
        impact: "報名、收款、列印、報表都以年度為索引，年度錯誤會導致資料無法歸戶與統計錯亂。",
        recommendation: "請至活動精靈／活動設定補上正確民國年度；系統不會自動修改。",
        affectedCount: rows.length,
        rows: rows.map((e) => ({
          title: `活動「${e.name}」年度無效`,
          fields: [{ label: "活動", value: e.name }, { label: "類型", value: activityTypeLabel[e.activityType as string] ?? (e.activityType as string) }],
          links: [linkActivity(e.id, e.activityType as string)].filter((x): x is DetailLink => !!x),
          techIds: [`templeEvent=${e.id}`],
        })),
      };
    },
  },
  {
    code: "ACT-002",
    name: "開放報名活動無對應報名項目",
    module: "ACTIVITY",
    run: async () => {
      const events = await prisma.templeEvent.findMany({ where: { isArchived: false, isRegistrationOpen: true }, select: { id: true, name: true, year: true, activityType: true } });
      const groups = new Set(REGISTRATION_ITEM_SEED.map((s) => s.activityGroup));
      const bad = events.filter((e) => !groups.has(e.activityType as string)).slice(0, ROW_LIMIT);
      if (bad.length === 0) return pass("所有開放報名的活動都有對應的報名項目。");
      return {
        severity: "WARNING",
        summary: `有 ${bad.length} 個開放報名的活動找不到任何報名項目定義。`,
        cause: "活動類型不在報名項目定義（REGISTRATION_ITEM_SEED）涵蓋的主活動群組內（可能為舊版獨立燈別活動）。",
        impact: "使用者從報名首頁看到此活動卻沒有可報名的項目，或以獨立入口造成流程分歧。",
        recommendation: "確認活動是否為統一架構下的主活動；舊版獨立燈別活動不應開放為獨立報名入口。",
        affectedCount: bad.length,
        rows: bad.map((e) => ({
          title: `活動「${e.name}」（民國 ${e.year} 年）無對應報名項目`,
          fields: [{ label: "活動", value: e.name }, { label: "年度", value: `民國 ${e.year} 年` }, { label: "類型", value: activityTypeLabel[e.activityType as string] ?? (e.activityType as string) }],
          links: [linkActivity(e.id, e.activityType as string)].filter((x): x is DetailLink => !!x),
          techIds: [`templeEvent=${e.id}`],
        })),
      };
    },
  },
  {
    code: "ACT-003",
    name: "白米開放但未設定單價",
    module: "ACTIVITY",
    run: async () => {
      const rows = await prisma.templeEvent.findMany({ where: { riceOpen: true, riceUnitPrice: null }, select: { id: true, name: true, year: true, activityType: true }, take: ROW_LIMIT });
      if (rows.length === 0) return pass("所有開放白米認購的年度都已設定每斤單價。");
      return {
        severity: "ERROR",
        summary: `有 ${rows.length} 個年度已開放白米認購卻未設定每斤單價。`,
        cause: "TempleEvent.riceOpen 為開啟，但 riceUnitPrice 為空。",
        impact: "白米認購無法計價，或以 0 元誤計，造成應收錯誤。",
        recommendation: "請至該年度普渡 → 白米管理設定每斤金額後再開放認購。",
        affectedCount: rows.length,
        rows: rows.map((e) => ({
          title: `「${e.name}」（民國 ${e.year} 年）白米已開放但未設單價`,
          fields: [{ label: "活動", value: e.name }, { label: "年度", value: `民國 ${e.year} 年` }],
          links: [linkActivity(e.id, e.activityType as string)].filter((x): x is DetailLink => !!x),
          techIds: [`templeEvent=${e.id}`],
        })),
      };
    },
  },
  {
    code: "ACT-004",
    name: "活動缺活動日期",
    module: "ACTIVITY",
    run: async () => {
      const rows = await prisma.templeEvent.findMany({ where: { isArchived: false, solarDate: null, lunarDateMonth: null }, select: { id: true, name: true, year: true, activityType: true }, take: ROW_LIMIT });
      if (rows.length === 0) return pass("所有未封存活動都有國曆或農曆日期。");
      return {
        severity: "WARNING",
        summary: `有 ${rows.length} 個未封存活動未設定任何活動日期。`,
        cause: "活動同時缺國曆日期（solarDate）與農曆月份（lunarDateMonth）。",
        impact: "「今日活動」等以日期判斷的功能無法顯示；部分整年度登記型活動屬正常。",
        recommendation: "若為單日活動請補上國曆或農曆日期；整年度登記型活動可忽略。",
        affectedCount: rows.length,
        rows: rows.map((e) => ({
          title: `「${e.name}」（民國 ${e.year} 年）未設定活動日期`,
          fields: [{ label: "活動", value: e.name }, { label: "年度", value: `民國 ${e.year} 年` }],
          links: [linkActivity(e.id, e.activityType as string)].filter((x): x is DetailLink => !!x),
          techIds: [`templeEvent=${e.id}`],
        })),
      };
    },
  },

  // ── 報名 REGISTRATION ─────────────────────────────────────
  {
    code: "REG-001",
    name: "報名項目孤兒（主報名已刪除）",
    module: "REGISTRATION",
    run: async () => {
      const where = { deletedAt: null, ritualRecord: { deletedAt: { not: null } } };
      const count = await prisma.ritualRegistrationItem.count({ where });
      if (count === 0) return pass("沒有主報名已刪除卻殘留的報名項目。");
      const ids = (await prisma.ritualRegistrationItem.findMany({ where, select: { id: true }, take: ROW_LIMIT })).map((r) => r.id);
      const items = await loadItems(ids);
      return {
        severity: "ERROR",
        summary: `有 ${count} 筆報名項目，其主報名已被刪除卻仍殘留。`,
        cause: "報名項目未軟刪除，但其所屬主報名（RitualRecord）的 deletedAt 已設定（已刪除）。",
        impact: "殘留項目可能仍被收款、列印或報表計入，造成金額與名單錯誤。",
        recommendation: "請確認刪除流程是否遺漏連動；由管理員於回收區／報名頁確認後處理，系統不自動刪除。",
        affectedCount: count,
        rows: items.map((it) => itemRow(it, { includePrint: true })),
      };
    },
  },
  {
    code: "REG-002",
    name: "參加者孤兒（主報名已刪除）",
    module: "REGISTRATION",
    run: async () => {
      const where = { deletedAt: null, ritualRecord: { deletedAt: { not: null } } };
      const count = await prisma.ritualParticipant.count({ where });
      if (count === 0) return pass("沒有主報名已刪除卻殘留的參加者。");
      const rows = await prisma.ritualParticipant.findMany({ where, select: { id: true, nameSnapshot: true, ritualRecord: { select: { id: true, year: true, activityType: true, templeEventId: true, household: { select: { id: true, name: true } } } } }, take: ROW_LIMIT });
      return {
        severity: "ERROR",
        summary: `有 ${count} 位參加者，其主報名已被刪除卻仍殘留。`,
        cause: "參加者未軟刪除，但其所屬主報名已刪除。",
        impact: "殘留參加者可能出現在名單或列印中。",
        recommendation: "請確認刪除連動；由管理員確認後處理，系統不自動刪除。",
        affectedCount: count,
        rows: rows.map((p) => ({
          title: `參加者「${p.nameSnapshot ?? "（無姓名快照）"}」的主報名已刪除`,
          fields: [{ label: "參加者", value: p.nameSnapshot ?? "（無姓名快照）" }, { label: "家戶", value: `${p.ritualRecord.household.name}（${p.ritualRecord.household.id}）` }, { label: "年度", value: `民國 ${p.ritualRecord.year} 年` }],
          links: [linkHousehold(p.ritualRecord.household.id), linkRegistration(p.ritualRecord.id)],
          techIds: [`participant=${p.id}`, `record=${p.ritualRecord.id}`],
        })),
      };
    },
  },
  {
    code: "REG-003",
    name: "空殼主報名（無項目也無參加者）",
    module: "REGISTRATION",
    run: async () => {
      const where = { deletedAt: null, registrationItems: { none: {} }, participants: { none: {} } };
      const count = await prisma.ritualRecord.count({ where });
      if (count === 0) return pass("沒有空殼主報名。");
      const rows = await prisma.ritualRecord.findMany({ where, select: { id: true, year: true, activityType: true, templeEventId: true, household: { select: { id: true, name: true } } }, take: ROW_LIMIT });
      return {
        severity: "WARNING",
        summary: `有 ${count} 筆主報名底下既無報名項目也無參加者。`,
        cause: "RitualRecord 未刪除，但沒有任何報名項目與參加者。",
        impact: "可能為未完成報名或殘留資料；通常無金流影響，但會干擾統計。",
        recommendation: "確認是否為未完成報名；如為殘留可於回收區整理，系統不自動刪除。",
        affectedCount: count,
        rows: rows.map((r) => ({
          title: `${r.household.name}・民國 ${r.year} 年${activityTypeLabel[r.activityType as string] ?? ""}的空殼報名`,
          fields: [{ label: "家戶", value: `${r.household.name}（${r.household.id}）` }, { label: "年度", value: `民國 ${r.year} 年` }, { label: "活動類型", value: activityTypeLabel[r.activityType as string] ?? (r.activityType as string) }],
          links: [linkHousehold(r.household.id), linkRegistration(r.id)],
          techIds: [`record=${r.id}`],
        })),
      };
    },
  },
  {
    code: "REG-004",
    name: "重複報名項目",
    module: "REGISTRATION",
    run: async () => {
      // 1) groupBy 找出重複群組鍵（同主報名＋同成員＋同項目、未取消未刪除）。
      const groups = await prisma.ritualRegistrationItem.groupBy({
        by: ["ritualRecordId", "registrationItemTypeId", "memberId"],
        where: { deletedAt: null, status: { not: "CANCELLED" }, memberId: { not: null } },
        _count: { _all: true },
      });
      const dupGroups = groups.filter((g) => g._count._all > 1);
      if (dupGroups.length === 0) return pass("同一主報名同成員同項目沒有重複。");

      // 2) 一次撈出這些重複群組所在主報名的所有相關項目（單一 findMany，不 N+1）。
      const recordIds = [...new Set(dupGroups.map((g) => g.ritualRecordId))];
      const items = await loadItems(
        (
          await prisma.ritualRegistrationItem.findMany({
            where: { deletedAt: null, status: { not: "CANCELLED" }, memberId: { not: null }, ritualRecordId: { in: recordIds } },
            select: { id: true },
          })
        ).map((r) => r.id)
      );
      // 3) 在 JS 依「主報名＋項目＋成員」分群，只保留重複群組，組成可理解列。
      const byKey = new Map<string, EnrichedItem[]>();
      for (const it of items) {
        const key = `${it.recordId}::${it.itemName}::${it.memberId}`;
        (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(it);
      }
      const rows: DetailRow[] = [];
      for (const list of byKey.values()) {
        if (list.length < 2) continue;
        const head = list[0];
        rows.push({
          title: `${head.memberName ?? "整戶"}在民國 ${head.year} 年${head.activityName}的「${head.itemName}」有 ${list.length} 筆重複`,
          fields: [
            { label: "信眾", value: head.memberName ?? "（未指定成員）" },
            { label: "家戶", value: `${head.householdName}（${head.householdId}）` },
            { label: "活動", value: head.activityName },
            { label: "年度", value: `民國 ${head.year} 年` },
            { label: "重複項目", value: head.itemName },
            { label: "重複筆數", value: `${list.length} 筆` },
            ...list.map((it, i) => ({
              label: `第 ${i + 1} 筆`,
              value: `狀態 ${statusLabel(it.status)}｜應收 ${money(it.amountDue)}｜已收 ${money(it.amountPaid)}｜未收 ${money(it.amountUnpaid)}｜${it.printCount > 0 ? `已列印 ${it.printCount} 次` : "未列印"}｜${it.amountPaid > 0 ? "已建立交易/收款" : "尚未收款"}`,
            })),
          ],
          links: [
            ...(head.memberId ? [linkDevotee(head.memberId)] : []),
            linkHousehold(head.householdId),
            ...(linkActivity(head.templeEventId, head.activityType) ? [linkActivity(head.templeEventId, head.activityType)!] : []),
            linkRegistration(head.recordId),
            linkCollection(),
          ],
          techIds: list.map((it) => `item=${it.id}`).concat(`record=${head.recordId}`),
        });
      }
      return {
        severity: "ERROR",
        summary: `發現 ${rows.length} 組重複報名項目（同一信眾、同一活動、同一報名項目出現多筆未取消資料）。`,
        cause: "同一主報名＋同一信眾＋同一報名項目，存在超過一筆未取消（且未刪除）的項目。牌位多筆內容應以 UniversalSalvationEntry 表達，而非多列報名項目。",
        impact: "可能重複計價、重複列印、造成應收錯誤、報表重複計算，或使該報名無法正確確認。",
        recommendation: "此規則只偵測，不自動刪除。請進入該信眾（或家戶）該年度該活動的報名頁，人工確認應保留哪一筆，其餘取消。",
        affectedCount: rows.length,
        rows: rows.slice(0, ROW_LIMIT),
      };
    },
  },
  {
    code: "REG-005",
    name: "命名牌位項目未連結明細",
    module: "REGISTRATION",
    run: async () => {
      const where = { deletedAt: null, status: "CONFIRMED" as const, universalSalvationEntryId: null, registrationItemType: { key: { in: ["US_ANCESTOR", "US_ZHENGHUN", "US_WUYUAN"] } } };
      const count = await prisma.ritualRegistrationItem.count({ where });
      if (count === 0) return pass("已確認的命名牌位項目皆已連結普渡明細。");
      const ids = (await prisma.ritualRegistrationItem.findMany({ where, select: { id: true }, take: ROW_LIMIT })).map((r) => r.id);
      const items = await loadItems(ids);
      return {
        severity: "WARNING",
        summary: `有 ${count} 筆已確認的命名牌位項目未連結普渡明細。`,
        cause: "已確認的超拔祖先／乙位正魂／無緣子女項目其 universalSalvationEntryId 為空。",
        impact: "名稱、陽上人、地址與列印內容將取不到，牌位可能顯示不完整。",
        recommendation: "請確認建立流程有連結 entry；舊資料可依既有回填規則處理，系統不自動修改。",
        affectedCount: count,
        rows: items.map((it) => itemRow(it, { includePrint: true })),
      };
    },
  },

  // ── 白米 RICE ─────────────────────────────────────────────
  {
    code: "RICE-001",
    name: "白米總量未設定",
    module: "RICE",
    run: async () => {
      const rows = await prisma.templeEvent.findMany({ where: { riceOpen: true, riceTotalKg: null }, select: { id: true, name: true, year: true, activityType: true }, take: ROW_LIMIT });
      if (rows.length === 0) return pass("所有開放白米認購的年度都已設定白米總開放斤數。");
      return {
        severity: "ERROR",
        summary: `有 ${rows.length} 個年度已開放白米認購卻未設定白米總開放斤數。`,
        cause: "TempleEvent.riceOpen 為開啟，但 riceTotalKg（白米總開放斤數）為空。",
        impact: "無法計算剩餘斤數與超額判斷，認購失控。",
        recommendation: "請至該年度普渡→白米管理設定白米總開放斤數（必填）；系統不自動設定。",
        affectedCount: rows.length,
        rows: rows.map((e) => ({
          title: `「${e.name}」（民國 ${e.year} 年）白米已開放但未設總量`,
          fields: [{ label: "活動", value: e.name }, { label: "年度", value: `民國 ${e.year} 年` }],
          links: [linkActivity(e.id, e.activityType as string)].filter((x): x is DetailLink => !!x),
          techIds: [`templeEvent=${e.id}`],
        })),
      };
    },
  },
  {
    code: "RICE-002",
    name: "白米超額認購",
    module: "RICE",
    run: async () => {
      const events = await prisma.templeEvent.findMany({ where: { activityType: "UNIVERSAL_SALVATION", riceTotalKg: { not: null } }, select: { id: true, name: true, year: true, activityType: true, riceTotalKg: true, riceAllowOverbook: true } });
      const items = await prisma.ritualRegistrationItem.findMany({
        where: { deletedAt: null, status: "CONFIRMED", registrationItemType: { contentKind: "RICE" }, ritualRecord: { activityType: "UNIVERSAL_SALVATION" } },
        select: { quantity: true, ritualRecord: { select: { year: true } } },
      });
      const byYear = new Map<number, number>();
      for (const it of items) byYear.set(it.ritualRecord.year, (byYear.get(it.ritualRecord.year) ?? 0) + (it.quantity ?? 0));
      const bad = events.filter((e) => (byYear.get(e.year) ?? 0) > Number(e.riceTotalKg ?? 0)).slice(0, ROW_LIMIT);
      if (bad.length === 0) return pass("沒有白米超額認購的年度。");
      const anyNotAllowed = bad.some((e) => !e.riceAllowOverbook);
      return {
        severity: anyNotAllowed ? "ERROR" : "WARNING",
        summary: `有 ${bad.length} 個年度白米已超額認購（已認購斤數大於總開放斤數）。`,
        cause: "該年度有效認購斤數合計超過白米總開放斤數（riceTotalKg）。",
        impact: "超過原定總量；若該年度未開放超額，屬異常需人工確認。",
        recommendation: "請確認該年度是否應開放超額；未開放卻超額請人工檢查資料，系統不自動修正。",
        affectedCount: bad.length,
        rows: bad.map((e) => {
          const reg = byYear.get(e.year) ?? 0;
          const total = Number(e.riceTotalKg ?? 0);
          return {
            title: `「${e.name}」（民國 ${e.year} 年）超額 ${reg - total} 斤`,
            fields: [
              { label: "活動", value: e.name },
              { label: "年度", value: `民國 ${e.year} 年` },
              { label: "總開放斤數", value: `${total} 斤` },
              { label: "已認購斤數", value: `${reg} 斤` },
              { label: "超額斤數", value: `${reg - total} 斤` },
              { label: "是否允許超額", value: e.riceAllowOverbook ? "允許" : "不允許" },
            ],
            links: [linkActivity(e.id, e.activityType as string)].filter((x): x is DetailLink => !!x),
            techIds: [`templeEvent=${e.id}`],
          };
        }),
      };
    },
  },
  {
    code: "RICE-003",
    name: "白米斤數異常",
    module: "RICE",
    run: async () => {
      const where = { deletedAt: null, registrationItemType: { contentKind: "RICE" }, status: { not: "CANCELLED" as const }, quantity: { lte: 0 } };
      const count = await prisma.ritualRegistrationItem.count({ where });
      if (count === 0) return pass("沒有白米斤數異常（0 或負數）的報名。");
      const ids = (await prisma.ritualRegistrationItem.findMany({ where, select: { id: true }, take: ROW_LIMIT })).map((r) => r.id);
      const items = await loadItems(ids);
      return {
        severity: "ERROR",
        summary: `有 ${count} 筆白米報名斤數異常（0 或負數）。`,
        cause: "白米報名項目的斤數（quantity）小於或等於 0。",
        impact: "斤數統計、計價與剩餘量會錯亂。",
        recommendation: "請於該報名頁確認並修正斤數；系統不自動修正。",
        affectedCount: count,
        rows: items.map((it) => itemRow(it)),
      };
    },
  },
  {
    code: "RICE-004",
    name: "白米應收金額與認購斤數不一致",
    module: "RICE",
    run: async () => {
      const rows = await prisma.ritualRegistrationItem.findMany({
        where: { deletedAt: null, registrationItemType: { contentKind: "RICE" }, status: { not: "CANCELLED" }, lockedUnitPrice: { not: null } },
        select: { id: true, quantity: true, amountDue: true, lockedUnitPrice: true },
      });
      const bad = rows.filter((r) => round2(Number(r.amountDue ?? 0)) !== round2((r.quantity ?? 0) * Number(r.lockedUnitPrice ?? 0)));
      if (bad.length === 0) return pass("所有白米報名的應收金額都等於斤數 × 鎖定單價。");
      const items = await loadItems(bad.map((r) => r.id));
      return {
        severity: "ERROR",
        summary: `有 ${bad.length} 筆白米報名的應收金額與「斤數 × 鎖定單價」不一致。`,
        cause: "白米項目的應收金額（amountDue）不等於 斤數 × 建立當下鎖定的每斤單價（lockedUnitPrice）。",
        impact: "白米應收金額不可靠，收款與帳務對不起來。",
        recommendation: "僅提示，不自動修正；請人工確認該筆單價與斤數後，以既有流程重算。",
        affectedCount: bad.length,
        rows: items.map((it) => itemRow(it)),
      };
    },
  },

  // ── 財務 FINANCE ─────────────────────────────────────────
  {
    code: "FIN-001",
    name: "應收／已收／未收不一致",
    module: "FINANCE",
    run: async (ctx) => {
      const bad = ctx.items.filter((i) => round2(i.amountUnpaid) !== round2(i.amountDue - i.amountPaid));
      if (bad.length === 0) return pass("所有報名項目的未收＝應收−已收。");
      const items = await loadItems(bad.map((i) => i.id));
      return {
        severity: "ERROR",
        summary: `有 ${bad.length} 筆報名項目的未收金額 ≠ 應收 − 已收。`,
        cause: "amountUnpaid 不等於 amountDue − amountPaid。",
        impact: "待收金額顯示錯誤，收款與報表金額不可靠。",
        recommendation: "請以既有收款流程重算；系統不自動改金額。",
        affectedCount: bad.length,
        rows: items.map((it) => itemRow(it)),
      };
    },
  },
  {
    code: "FIN-002",
    name: "溢收（已收大於應收）",
    module: "FINANCE",
    run: async (ctx) => {
      const bad = ctx.items.filter((i) => round2(i.amountPaid) > round2(i.amountDue));
      if (bad.length === 0) return pass("沒有已收大於應收的項目。");
      const items = await loadItems(bad.map((i) => i.id));
      return {
        severity: "ERROR",
        summary: `有 ${bad.length} 筆報名項目已收金額大於應收（溢收）。`,
        cause: "amountPaid 大於 amountDue。",
        impact: "帳務出現溢收，可能需退款；直接改斤數／金額會被溢收保護阻擋。",
        recommendation: "請於收款中心辦理退款／沖銷；不可直接改金額。",
        affectedCount: bad.length,
        rows: items.map((it) => itemRow(it)),
      };
    },
  },
  {
    code: "FIN-003",
    name: "負數金額",
    module: "FINANCE",
    run: async (ctx) => {
      const bad = ctx.items.filter((i) => i.amountDue < 0 || i.amountPaid < 0 || i.amountUnpaid < 0);
      if (bad.length === 0) return pass("沒有負數金額項目。");
      const items = await loadItems(bad.map((i) => i.id));
      return {
        severity: "ERROR",
        summary: `有 ${bad.length} 筆報名項目金額出現負數。`,
        cause: "amountDue／amountPaid／amountUnpaid 其一為負。",
        impact: "帳務金額錯誤，報表加總失真。",
        recommendation: "請追查來源交易／退款流程；系統不自動修正。",
        affectedCount: bad.length,
        rows: items.map((it) => itemRow(it)),
      };
    },
  },
  {
    code: "FIN-004",
    name: "未確認卻已收款",
    module: "FINANCE",
    run: async (ctx) => {
      const bad = ctx.items.filter((i) => i.status === "DRAFT" && round2(i.amountPaid) > 0);
      if (bad.length === 0) return pass("沒有草稿項目已收款。");
      const items = await loadItems(bad.map((i) => i.id));
      return {
        severity: "ERROR",
        summary: `有 ${bad.length} 筆草稿（未確認）項目卻已有已收金額。`,
        cause: "報名項目狀態為 DRAFT，但 amountPaid 大於 0。",
        impact: "未確認報名不應進入實收與帳本，會造成帳務與確認流程不一致。",
        recommendation: "請確認收款隔離；草稿不得先收款。由管理員檢視該報名後處理。",
        affectedCount: bad.length,
        rows: items.map((it) => itemRow(it)),
      };
    },
  },

  // ── 交易／收據 TRANSACTION ────────────────────────────────
  {
    code: "TXN-001",
    name: "有效交易缺收據",
    module: "TRANSACTION",
    run: async () => {
      const where = { status: "COMPLETED" as const, receipts: { none: {} } };
      const count = await prisma.paymentTransaction.count({ where });
      if (count === 0) return pass("所有有效收款交易皆有對應收據。");
      const rows = await prisma.paymentTransaction.findMany({ where, select: { id: true, transactionNo: true, payerNameSnapshot: true, totalAmount: true, payerHouseholdId: true }, take: ROW_LIMIT });
      return {
        severity: "WARNING",
        summary: `有 ${count} 筆有效收款交易沒有任何對應收據。`,
        cause: "PaymentTransaction 狀態為 COMPLETED，但沒有連結任何 Receipt。",
        impact: "可能漏開收據；部分標記「不需開立」情形屬正常。",
        recommendation: "確認是否需補開收據；請至收款中心該交易處理。",
        affectedCount: count,
        rows: rows.map((t) => ({
          title: `${t.payerNameSnapshot ?? "（無付款人）"} 的收款交易缺收據（${money(Number(t.totalAmount ?? 0))}）`,
          fields: [{ label: "付款人", value: t.payerNameSnapshot ?? "（無）" }, { label: "交易單號", value: t.transactionNo }, { label: "金額", value: money(Number(t.totalAmount ?? 0)) }],
          links: [linkCollection(), ...(t.payerHouseholdId ? [linkHousehold(t.payerHouseholdId)] : [])],
          techIds: [`transaction=${t.id}`],
        })),
      };
    },
  },
  {
    code: "TXN-002",
    name: "交易已作廢但收據未作廢",
    module: "TRANSACTION",
    run: async () => {
      const where = { status: "ISSUED" as const, paymentTransaction: { status: "VOIDED" as const } };
      const count = await prisma.receipt.count({ where });
      if (count === 0) return pass("沒有交易已作廢但收據仍有效的情形。");
      const rows = await prisma.receipt.findMany({ where, select: { id: true, receiptNumber: true, payerName: true, totalAmount: true, householdId: true }, take: ROW_LIMIT });
      return {
        severity: "ERROR",
        summary: `有 ${count} 張收據其收款交易已作廢，但收據仍為已開立（有效）狀態。`,
        cause: "Receipt 狀態為 ISSUED，但其 PaymentTransaction 狀態為 VOIDED。",
        impact: "收據與交易狀態不一致，帳務與收據查核會對不起來。",
        recommendation: "請以既有作廢／換開流程同步收據狀態；系統不自動變更。",
        affectedCount: count,
        rows: rows.map((r) => ({
          title: `收據 ${r.receiptNumber ?? "（無號）"}（${r.payerName ?? "（無付款人）"}）對應交易已作廢`,
          fields: [{ label: "收據號", value: r.receiptNumber ?? "（無號）" }, { label: "付款人", value: r.payerName ?? "（無付款人）" }, { label: "金額", value: money(Number(r.totalAmount ?? 0)) }],
          links: [linkCollection(), ...(r.householdId ? [linkHousehold(r.householdId)] : [])],
          techIds: [`receipt=${r.id}`],
        })),
      };
    },
  },

  // ── 列印 PRINT ───────────────────────────────────────────
  {
    code: "PRN-001",
    name: "列印次數與列印時間不一致",
    module: "PRINT",
    run: async (ctx) => {
      const bad = ctx.items.filter((i) => i.printCount > 0 && i.printedAt === null);
      if (bad.length === 0) return pass("所有已列印項目都有首次列印時間。");
      const items = await loadItems(bad.map((i) => i.id));
      return {
        severity: "ERROR",
        summary: `有 ${bad.length} 筆項目列印次數大於 0 卻無首次列印時間。`,
        cause: "printCount 大於 0，但 printedAt 為空。",
        impact: "列印稽核紀錄不完整，無法追溯首次列印時間。",
        recommendation: "請檢查列印中心首印時間寫入邏輯；由管理員複核該項目。",
        affectedCount: bad.length,
        rows: items.map((it) => itemRow(it, { includePrint: true })),
      };
    },
  },
  {
    code: "PRN-002",
    name: "有列印時間但列印次數為零",
    module: "PRINT",
    run: async (ctx) => {
      const bad = ctx.items.filter((i) => i.printedAt !== null && i.printCount === 0);
      if (bad.length === 0) return pass("沒有有列印時間卻次數為零的項目。");
      const items = await loadItems(bad.map((i) => i.id));
      return {
        severity: "WARNING",
        summary: `有 ${bad.length} 筆項目有首次列印時間卻列印次數為 0。`,
        cause: "printedAt 有值，但 printCount 為 0（可能為舊資料）。",
        impact: "列印次數統計偏低；若為舊資料可忽略。",
        recommendation: "確認列印次數計數；如為舊資料可忽略。",
        affectedCount: bad.length,
        rows: items.map((it) => itemRow(it, { includePrint: true })),
      };
    },
  },
  {
    code: "PRN-003",
    name: "未確認項目卻有列印紀錄",
    module: "PRINT",
    run: async (ctx) => {
      const bad = ctx.items.filter((i) => i.status !== "CONFIRMED" && i.printCount > 0);
      if (bad.length === 0) return pass("沒有未確認項目被列印。");
      const items = await loadItems(bad.map((i) => i.id));
      return {
        severity: "ERROR",
        summary: `有 ${bad.length} 筆草稿／已取消項目卻有列印次數。`,
        cause: "報名項目狀態非 CONFIRMED，但 printCount 大於 0（可能為預覽誤寫列印紀錄或未確認即列印）。",
        impact: "列印紀錄可能被污染，補印次數與稽核失真。",
        recommendation: "列印一律只針對已確認項目；請檢查預覽是否誤寫 printCount，由管理員複核。",
        affectedCount: bad.length,
        rows: items.map((it) => itemRow(it, { includePrint: true })),
      };
    },
  },

  // ── 信眾 DEVOTEE ─────────────────────────────────────────
  {
    code: "DEV-001",
    name: "成員所屬家戶已刪除",
    module: "DEVOTEE",
    run: async () => {
      const where = { deletedAt: null, household: { deletedAt: { not: null } } };
      const count = await prisma.member.count({ where });
      if (count === 0) return pass("沒有成員的所屬家戶已刪除卻殘留。");
      const rows = await prisma.member.findMany({ where, select: { id: true, name: true, household: { select: { id: true, name: true } } }, take: ROW_LIMIT });
      return {
        severity: "ERROR",
        summary: `有 ${count} 位成員其所屬家戶已被刪除卻仍殘留（孤兒成員）。`,
        cause: "成員未刪除，但其所屬家戶的 deletedAt 已設定。",
        impact: "成員無有效家戶歸屬，報名／收款／地址帶入會出錯。",
        recommendation: "請隨家戶刪除連動，或將成員改派至有效家戶，系統不自動處理。",
        affectedCount: count,
        rows: rows.map((m) => ({
          title: `成員「${m.name}」的所屬家戶已刪除`,
          fields: [{ label: "信眾", value: m.name }, { label: "原家戶", value: `${m.household.name}（${m.household.id}）` }],
          links: [linkDevotee(m.id), linkHousehold(m.household.id)],
          techIds: [`member=${m.id}`, `household=${m.household.id}`],
        })),
      };
    },
  },
  {
    code: "DEV-002",
    name: "缺生日資料",
    module: "DEVOTEE",
    run: async () => {
      const where = { deletedAt: null, isDeceased: false, solarBirthDate: null, lunarBirthMonth: null };
      const count = await prisma.member.count({ where });
      if (count === 0) return pass("所有在世成員都有生日資料。");
      const rows = await prisma.member.findMany({ where, select: { id: true, name: true, householdId: true, household: { select: { name: true } } }, take: ROW_LIMIT });
      return {
        severity: "WARNING",
        summary: `有 ${count} 位在世成員未填任何生日資料。`,
        cause: "成員未往生，但國曆生日與農曆月份皆為空。",
        impact: "虛歲、生肖、太歲等由生日計算的資料無法產生，列印疏文可能缺欄位。",
        recommendation: "請補齊生日；此為資料完整度提醒，非錯誤。",
        affectedCount: count,
        rows: rows.map((m) => ({
          title: `成員「${m.name}」缺生日`,
          fields: [{ label: "信眾", value: m.name }, { label: "家戶", value: m.household?.name ?? "" }],
          links: [linkDevotee(m.id), ...(m.householdId ? [linkHousehold(m.householdId)] : [])],
          techIds: [`member=${m.id}`],
        })),
      };
    },
  },

  // ── 家戶 HOUSEHOLD ───────────────────────────────────────
  {
    code: "HH-001",
    name: "家戶無成員",
    module: "HOUSEHOLD",
    run: async () => {
      const where = { deletedAt: null, members: { none: { deletedAt: null } } };
      const count = await prisma.household.count({ where });
      if (count === 0) return pass("所有家戶都至少有一位有效成員。");
      const rows = await prisma.household.findMany({ where, select: { id: true, name: true }, take: ROW_LIMIT });
      return {
        severity: "WARNING",
        summary: `有 ${count} 個家戶沒有任何有效成員（空戶）。`,
        cause: "家戶未刪除，但底下沒有任何未刪除的成員。",
        impact: "空戶無法報名或收款，可能為建立後未加入成員或成員都已刪除。",
        recommendation: "確認是否需併戶或補入成員；系統不自動處理。",
        affectedCount: count,
        rows: rows.map((h) => ({
          title: `家戶「${h.name}（${h.id}）」沒有有效成員`,
          fields: [{ label: "家戶", value: `${h.name}（${h.id}）` }],
          links: [linkHousehold(h.id)],
          techIds: [`household=${h.id}`],
        })),
      };
    },
  },
  {
    code: "HH-002",
    name: "家戶缺地址",
    module: "HOUSEHOLD",
    run: async () => {
      const where = { deletedAt: null, OR: [{ address: null }, { address: "" }] };
      const count = await prisma.household.count({ where });
      if (count === 0) return pass("所有家戶都有地址。");
      const rows = await prisma.household.findMany({ where, select: { id: true, name: true }, take: ROW_LIMIT });
      return {
        severity: "WARNING",
        summary: `有 ${count} 個家戶未填地址。`,
        cause: "家戶 address 為空。",
        impact: "牌位地址預設帶入家戶地址時會缺，列印可能缺地址。",
        recommendation: "請補齊家戶地址。",
        affectedCount: count,
        rows: rows.map((h) => ({
          title: `家戶「${h.name}（${h.id}）」缺地址`,
          fields: [{ label: "家戶", value: `${h.name}（${h.id}）` }],
          links: [linkHousehold(h.id)],
          techIds: [`household=${h.id}`],
        })),
      };
    },
  },

  // ── 帳號權限 SECURITY ────────────────────────────────────
  {
    code: "SEC-001",
    name: "無啟用中的最高管理員",
    module: "SECURITY",
    run: async () => {
      const count = await prisma.user.count({ where: { role: "SUPER_ADMIN", isActive: true } });
      if (count > 0) return pass("至少有一位啟用中的最高管理員。");
      return {
        severity: "ERROR",
        summary: "目前沒有任何啟用中的最高管理員（SUPER_ADMIN），有帳號鎖死風險。",
        cause: "User 中沒有 role=SUPER_ADMIN 且 isActive=true 的帳號。",
        impact: "無人可執行備份／還原／帳號管理等最高權限操作，系統可能被鎖死。",
        recommendation: "請立即啟用或建立一位 SUPER_ADMIN。",
        affectedCount: 1,
        rows: [{ title: "系統無啟用中的最高管理員", fields: [], links: [{ label: "使用者帳號管理", href: "/system-center/users" }], techIds: [] }],
      };
    },
  },
  {
    code: "SEC-002",
    name: "啟用帳號缺密碼",
    module: "SECURITY",
    run: async () => {
      const where = { isActive: true, passwordHash: null };
      const count = await prisma.user.count({ where });
      if (count === 0) return pass("所有啟用帳號都已設定密碼。");
      const rows = await prisma.user.findMany({ where, select: { id: true, name: true, loginId: true }, take: ROW_LIMIT });
      return {
        severity: "WARNING",
        summary: `有 ${count} 個啟用中的帳號未設定密碼。`,
        cause: "User isActive=true 但 passwordHash 為空。",
        impact: "帳號可能無法登入或走舊登入方式，存在安全與可用性風險。",
        recommendation: "請於帳號管理設定密碼。",
        affectedCount: count,
        rows: rows.map((u) => ({
          title: `帳號「${u.name}」（${u.loginId ?? "無登入帳號"}）未設定密碼`,
          fields: [{ label: "姓名", value: u.name }, { label: "登入帳號", value: u.loginId ?? "（未設定）" }],
          links: [{ label: "使用者帳號管理", href: "/system-center/users" }],
          techIds: [`user=${u.id}`],
        })),
      };
    },
  },
  {
    code: "SEC-003",
    name: "程式碼層權限稽核（需人工審查）",
    module: "SECURITY",
    run: async () =>
      unknown(
        "READONLY 可寫入、API 缺 Session／權限驗證、operatorUserId 可由前端冒用等屬程式碼層級問題，無法由資料自動判定。",
        "這些於 V14.3／V15 權限層已收斂（operator 一律取自 Session、寫入路由皆 assert 權限）；如需再確認請執行程式碼審查與權限測試矩陣。"
      ),
  },

  // ── 系統設定 SYSTEM ──────────────────────────────────────
  {
    code: "SYS-001",
    name: "Schema／Migration／API／UI 一致性（需人工審查）",
    module: "SYSTEM",
    run: async () =>
      unknown(
        "Schema、Migration、API、UI、模板與環境設定之間的一致性屬程式碼／部署層級，無法由資料自動判定。",
        "請於 Mac 執行 prisma migrate status／validate／generate 與 tsc／build 確認；系統健康檢查頁另有基礎設施檢查。"
      ),
  },
  {
    code: "SYS-002",
    name: "舊模組名稱／第二套重複流程（需人工審查）",
    module: "SYSTEM",
    run: async () =>
      unknown(
        "是否殘留舊模組名稱或第二套重複流程屬程式碼結構問題，無法由資料自動判定。",
        "V13→V18 已統一命名與流程（單一報名／收款／列印／活動整合導覽）；如需再確認請以來源掃描比對。"
      ),
  },
];

// ============================================================
// 掃描執行（共用資料一次載入，避免 N+1；錯誤優先排序）
// ============================================================

async function buildContext(): Promise<ScanContext> {
  const rows = await prisma.ritualRegistrationItem.findMany({
    where: { deletedAt: null },
    select: { id: true, status: true, amountDue: true, amountPaid: true, amountUnpaid: true, printedAt: true, printCount: true },
  });
  const items: ItemLite[] = rows.map((r) => ({
    id: r.id,
    status: r.status as string,
    amountDue: Number(r.amountDue ?? 0),
    amountPaid: Number(r.amountPaid ?? 0),
    amountUnpaid: Number(r.amountUnpaid ?? 0),
    printedAt: r.printedAt ?? null,
    printCount: r.printCount ?? 0,
  }));
  return { now: new Date(), items };
}

const MODULES: ScanModule[] = ["ACTIVITY", "REGISTRATION", "RICE", "FINANCE", "PRINT", "DEVOTEE", "HOUSEHOLD", "TRANSACTION", "SECURITY", "SYSTEM"];
const SEVERITY_ORDER: Record<Severity, number> = { ERROR: 0, WARNING: 1, UNKNOWN: 2, PASS: 3 };

/** 執行完整驗收掃描（只讀）。回傳所有規則結果（錯誤優先）與統計摘要。 */
export async function runAcceptanceScan(): Promise<AcceptanceScanResult> {
  const ctx = await buildContext();

  const findings: Finding[] = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < RULES.length; i += CONCURRENCY) {
    const batch = RULES.slice(i, i + CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map(async (rule): Promise<Finding> => {
        try {
          const o = await rule.run(ctx);
          return { code: rule.code, name: rule.name, module: rule.module, ...o };
        } catch (e) {
          return {
            code: rule.code,
            name: rule.name,
            module: rule.module,
            severity: "UNKNOWN",
            summary: "此規則執行時發生錯誤，無法判定。",
            cause: `執行錯誤：${e instanceof Error ? e.message : "未知錯誤"}`,
            impact: "",
            recommendation: "請檢查資料庫連線或此規則的查詢條件。",
            affectedCount: 0,
            rows: [],
          };
        }
      })
    );
    findings.push(...outcomes);
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.code.localeCompare(b.code));

  const bySeverity: Record<Severity, number> = { PASS: 0, WARNING: 0, ERROR: 0, UNKNOWN: 0 };
  const byModule = Object.fromEntries(MODULES.map((m) => [m, { pass: 0, warning: 0, error: 0, unknown: 0 }])) as AcceptanceScanResult["summary"]["byModule"];
  for (const f of findings) {
    bySeverity[f.severity] += 1;
    const bucket = byModule[f.module];
    if (f.severity === "PASS") bucket.pass += 1;
    else if (f.severity === "WARNING") bucket.warning += 1;
    else if (f.severity === "ERROR") bucket.error += 1;
    else bucket.unknown += 1;
  }

  return { ranAt: new Date().toISOString(), findings, summary: { total: findings.length, bySeverity, byModule } };
}

export const ACCEPTANCE_MODULE_LABEL: Record<ScanModule, string> = {
  ACTIVITY: "活動",
  REGISTRATION: "報名",
  RICE: "白米",
  FINANCE: "財務",
  PRINT: "列印",
  DEVOTEE: "信眾",
  HOUSEHOLD: "家戶",
  TRANSACTION: "交易收據",
  SECURITY: "帳號權限",
  SYSTEM: "系統設定",
};

export const ACCEPTANCE_SEVERITY_LABEL: Record<Severity, string> = {
  PASS: "通過",
  WARNING: "警告",
  ERROR: "錯誤",
  UNKNOWN: "無法自動判斷",
};
