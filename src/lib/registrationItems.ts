import { prisma } from "@/lib/prisma";
import type { ActivityType, Prisma } from "@prisma/client";

/**
 * V14「活動報名多項目架構」的項目設定查詢層。
 *
 * ── 定位 ────────────────────────────────────────────────────
 * 這一支取代舊的「一活動一 registrationFormType」單一分派：改為讀
 * RegistrationItemType（種子資料建立普渡 7／年度燈 4／宮慶 3／補庫／龍鳳燈）。
 * 一個「主活動（activityGroup）」底下有多個報名項目，各自對應報名內容
 * （contentKind）、收費方式（feeMode）與列印品（printDocumentKeys）。
 *
 * ⚠️ 不寫死任何數量／單價／項目清單——全部從資料庫讀。程式只認得
 * contentKind／feeMode 這些「型態字串」，實際項目與數字都是資料。
 */

/** 報名內容型態（決定編輯器與指回哪個既有明細）。 */
export type RegistrationContentKind =
  | "TABLET" // 牌位（普渡四類 → UniversalSalvationEntry）
  | "POCKET" // 寶袋（AdditionalPrintItem）
  | "SPONSOR" // 贊普（UniversalSalvationDetail.isSponsor）
  | "RICE" // 白米登記
  | "LANTERN" // 年度燈／龍鳳燈（LanternRegistration / RitualRegistrationItem）
  | "PURIFICATION" // 祭改（PurificationEntry）
  | "TURTLE" // 福壽龜（OfferingClaim / 既有供品流程）
  | "TABLE" // 宮慶訂桌
  | "STOVE" // 爐主／副爐主（StoveMasterRegistration）
  | "ROSTER" // 純名單（補庫等）
  | "GENERIC"; // 一般參加

/** 收費方式。 */
export type RegistrationFeeMode =
  | "NONE" // 不收費
  | "FIXED" // 固定費用（讀 defaultUnitPrice）
  | "CUSTOM" // 自訂金額
  | "PER_UNIT" // 單價 × 數量
  | "FIXED_OR_CUSTOM"; // 二選一（贊普）

export const REGISTRATION_CONTENT_KINDS: readonly RegistrationContentKind[] = [
  "TABLET", "POCKET", "SPONSOR", "RICE", "LANTERN", "PURIFICATION",
  "TURTLE", "TABLE", "STOVE", "ROSTER", "GENERIC",
];

export const REGISTRATION_FEE_MODES: readonly RegistrationFeeMode[] = [
  "NONE", "FIXED", "CUSTOM", "PER_UNIT", "FIXED_OR_CUSTOM",
];

export type RegistrationItemView = {
  id: string;
  key: string;
  name: string;
  activityType: ActivityType;
  activityGroup: string;
  activityGroupName: string;
  contentKind: RegistrationContentKind;
  feeMode: RegistrationFeeMode;
  defaultUnitPrice: number | null;
  defaultQuantity: number;
  allowMultiplePerMember: boolean;
  printDocumentKeys: string[];
  metadata: Prisma.JsonValue | null;
  sortOrder: number;
};

export type ActivityGroupView = {
  activityGroup: string;
  activityGroupName: string;
  items: RegistrationItemView[];
};

function toView(row: {
  id: string; key: string; name: string; activityType: ActivityType;
  activityGroup: string; activityGroupName: string; contentKind: string;
  feeMode: string; defaultUnitPrice: Prisma.Decimal | null; defaultQuantity: number;
  allowMultiplePerMember: boolean; printDocumentKeys: string[];
  metadataJson: Prisma.JsonValue | null; sortOrder: number;
}): RegistrationItemView {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    activityType: row.activityType,
    activityGroup: row.activityGroup,
    activityGroupName: row.activityGroupName,
    contentKind: row.contentKind as RegistrationContentKind,
    feeMode: row.feeMode as RegistrationFeeMode,
    defaultUnitPrice: row.defaultUnitPrice === null ? null : Number(row.defaultUnitPrice),
    defaultQuantity: row.defaultQuantity,
    allowMultiplePerMember: row.allowMultiplePerMember,
    printDocumentKeys: row.printDocumentKeys,
    metadata: row.metadataJson,
    sortOrder: row.sortOrder,
  };
}

/**
 * 報名項目種子定義（**唯一權威來源**）。
 *
 * prisma/migrations 的種子 SQL 依此建立；`ensureRegistrationItemTypesSeeded()`
 * 也依此冪等 upsert。數量／單價都是資料、可由管理者事後調整，程式不寫死。
 */
export type RegistrationItemSeed = {
  key: string;
  name: string;
  activityType: ActivityType;
  activityGroup: string;
  activityGroupName: string;
  contentKind: RegistrationContentKind;
  feeMode: RegistrationFeeMode;
  defaultUnitPrice: number | null;
  defaultQuantity: number;
  allowMultiplePerMember: boolean;
  printDocumentKeys: string[];
  metadata?: Record<string, unknown> | null;
  sortOrder: number;
};

export const REGISTRATION_ITEM_SEED: readonly RegistrationItemSeed[] = [
  // 中元普渡：七項
  { key: "US_ANCESTOR", name: "超拔祖先", activityType: "UNIVERSAL_SALVATION", activityGroup: "UNIVERSAL_SALVATION", activityGroupName: "中元普渡", contentKind: "TABLET", feeMode: "NONE", defaultUnitPrice: null, defaultQuantity: 1, allowMultiplePerMember: true, printDocumentKeys: ["US_ANCESTOR_TABLET", "US_BASIC_POCKET"], sortOrder: 1 },
  { key: "US_ZHENGHUN", name: "乙位正魂", activityType: "UNIVERSAL_SALVATION", activityGroup: "UNIVERSAL_SALVATION", activityGroupName: "中元普渡", contentKind: "TABLET", feeMode: "NONE", defaultUnitPrice: null, defaultQuantity: 1, allowMultiplePerMember: true, printDocumentKeys: ["US_ZHENGHUN_TABLET"], sortOrder: 2 },
  { key: "US_YUANQIN", name: "累世冤親債主", activityType: "UNIVERSAL_SALVATION", activityGroup: "UNIVERSAL_SALVATION", activityGroupName: "中元普渡", contentKind: "TABLET", feeMode: "NONE", defaultUnitPrice: null, defaultQuantity: 1, allowMultiplePerMember: true, printDocumentKeys: ["US_YUANQIN_TABLET", "US_BASIC_POCKET"], sortOrder: 3 },
  { key: "US_WUYUAN", name: "無緣子女", activityType: "UNIVERSAL_SALVATION", activityGroup: "UNIVERSAL_SALVATION", activityGroupName: "中元普渡", contentKind: "TABLET", feeMode: "NONE", defaultUnitPrice: null, defaultQuantity: 1, allowMultiplePerMember: true, printDocumentKeys: ["US_WUYUAN_TABLET", "US_BASIC_POCKET"], sortOrder: 4 },
  { key: "US_POCKET_EXTRA", name: "增加寶袋", activityType: "UNIVERSAL_SALVATION", activityGroup: "UNIVERSAL_SALVATION", activityGroupName: "中元普渡", contentKind: "POCKET", feeMode: "PER_UNIT", defaultUnitPrice: 300, defaultQuantity: 1, allowMultiplePerMember: true, printDocumentKeys: ["US_EXTRA_POCKET"], sortOrder: 5 },
  { key: "US_RICE", name: "白米登記", activityType: "UNIVERSAL_SALVATION", activityGroup: "UNIVERSAL_SALVATION", activityGroupName: "中元普渡", contentKind: "RICE", feeMode: "NONE", defaultUnitPrice: null, defaultQuantity: 1, allowMultiplePerMember: false, printDocumentKeys: ["US_RICE_ROSTER"], sortOrder: 6 },
  // 贊普（固定單價）：可多份、每份獨立子明細、各自顯示名稱。
  // ⚠️ 不寫死金額——單價一律讀既有中元普渡活動的贊普價格設定；未設定時
  // 顯示「尚未設定價格」，由具權限人員設定，程式不給任何預設值（V14.1 指令一）。
  { key: "US_SPONSOR", name: "贊普", activityType: "UNIVERSAL_SALVATION", activityGroup: "UNIVERSAL_SALVATION", activityGroupName: "中元普渡", contentKind: "SPONSOR", feeMode: "FIXED", defaultUnitPrice: null, defaultQuantity: 1, allowMultiplePerMember: true, printDocumentKeys: ["US_SPONSOR_ROSTER"], sortOrder: 7 },
  // 隨喜贊普（自訂金額）：與「贊普」為同一「贊普大類」下的兩個可同時勾選、
  // 分開保存／顯示／計價／列印的獨立選項（V14.1 指令二）。每份金額 > 0。
  { key: "US_SPONSOR_DONATION", name: "隨喜贊普", activityType: "UNIVERSAL_SALVATION", activityGroup: "UNIVERSAL_SALVATION", activityGroupName: "中元普渡", contentKind: "SPONSOR", feeMode: "CUSTOM", defaultUnitPrice: null, defaultQuantity: 1, allowMultiplePerMember: true, printDocumentKeys: ["US_SPONSOR_ROSTER"], sortOrder: 8 },

  // 年度燈：四項
  { key: "LANTERN_GUANGMING", name: "光明燈", activityType: "GUANGMING_LANTERN", activityGroup: "ANNUAL_LANTERN", activityGroupName: "年度燈", contentKind: "LANTERN", feeMode: "PER_UNIT", defaultUnitPrice: 500, defaultQuantity: 1, allowMultiplePerMember: true, printDocumentKeys: ["GUANGMING_LANTERN_TABLET", "GUANGMING_LANTERN_PETITION"], sortOrder: 1 },
  { key: "LANTERN_TAISUI", name: "太歲燈", activityType: "TAISUI_LANTERN", activityGroup: "ANNUAL_LANTERN", activityGroupName: "年度燈", contentKind: "LANTERN", feeMode: "PER_UNIT", defaultUnitPrice: 500, defaultQuantity: 1, allowMultiplePerMember: true, printDocumentKeys: ["TAISUI_LANTERN_TABLET", "TAISUI_LANTERN_PETITION"], sortOrder: 2 },
  { key: "LANTERN_FAMILY", name: "全家燈", activityType: "FAMILY_LANTERN", activityGroup: "ANNUAL_LANTERN", activityGroupName: "年度燈", contentKind: "LANTERN", feeMode: "FIXED", defaultUnitPrice: null, defaultQuantity: 1, allowMultiplePerMember: false, printDocumentKeys: ["FAMILY_LANTERN_TABLET", "FAMILY_LANTERN_PETITION"], sortOrder: 3 },
  { key: "LANTERN_PURIFICATION", name: "祭改", activityType: "PURIFICATION", activityGroup: "ANNUAL_LANTERN", activityGroupName: "年度燈", contentKind: "PURIFICATION", feeMode: "NONE", defaultUnitPrice: null, defaultQuantity: 1, allowMultiplePerMember: true, printDocumentKeys: ["PURIFICATION_STICKER"], sortOrder: 4 },

  // 宮慶：三項（福壽龜大龜/中龜數量存 metadata，可改）
  { key: "CELEBRATION_TABLE", name: "訂桌名單", activityType: "TEMPLE_CELEBRATION", activityGroup: "TEMPLE_CELEBRATION", activityGroupName: "宮慶", contentKind: "TABLE", feeMode: "PER_UNIT", defaultUnitPrice: null, defaultQuantity: 1, allowMultiplePerMember: true, printDocumentKeys: ["CELEBRATION_TABLE_ROSTER"], metadata: { tableKinds: [{ key: "DEVOTEE", name: "信眾訂桌" }, { key: "ALLIED_TEMPLE", name: "友宮訂桌" }] }, sortOrder: 1 },
  { key: "CELEBRATION_TURTLE", name: "福壽龜", activityType: "TEMPLE_CELEBRATION", activityGroup: "TEMPLE_CELEBRATION", activityGroupName: "宮慶", contentKind: "TURTLE", feeMode: "PER_UNIT", defaultUnitPrice: null, defaultQuantity: 1, allowMultiplePerMember: true, printDocumentKeys: ["CELEBRATION_TURTLE_ROSTER"], metadata: { sizes: [{ key: "BIG", name: "福壽大龜", defaultQuantity: 1 }, { key: "MID", name: "福壽中龜", defaultQuantity: 6 }] }, sortOrder: 2 },
  { key: "CELEBRATION_STOVE", name: "爐主／副爐主名單", activityType: "TEMPLE_CELEBRATION", activityGroup: "TEMPLE_CELEBRATION", activityGroupName: "宮慶", contentKind: "STOVE", feeMode: "NONE", defaultUnitPrice: null, defaultQuantity: 1, allowMultiplePerMember: false, printDocumentKeys: ["CELEBRATION_STOVE_ROSTER"], sortOrder: 3 },

  // 補庫（對外文字一律「補庫」；內部 key／enum 沿用 STORAGE_TROUSERS 不動，避免破壞既有資料）
  { key: "STORAGE_TROUSERS", name: "補庫報名", activityType: "STORAGE_REPAYMENT", activityGroup: "STORAGE_REPAYMENT", activityGroupName: "補庫", contentKind: "ROSTER", feeMode: "CUSTOM", defaultUnitPrice: null, defaultQuantity: 1, allowMultiplePerMember: false, printDocumentKeys: ["STORAGE_TROUSERS_ROSTER"], sortOrder: 1 },

  // 龍鳳燈
  { key: "DRAGON_PHOENIX", name: "龍鳳燈報名", activityType: "DRAGON_PHOENIX_LANTERN", activityGroup: "DRAGON_PHOENIX_LANTERN", activityGroupName: "龍鳳燈", contentKind: "LANTERN", feeMode: "PER_UNIT", defaultUnitPrice: null, defaultQuantity: 1, allowMultiplePerMember: true, printDocumentKeys: ["DRAGON_PHOENIX_LANTERN_TABLET", "DRAGON_PHOENIX_LANTERN_ROSTER"], sortOrder: 1 },
];

/**
 * 冪等 upsert 種子項目（依 REGISTRATION_ITEM_SEED）。
 * 不覆蓋管理者事後調整（用 create-only：已存在的 key 略過更新設定值，
 * 只確保存在）。可安全重複呼叫。
 */
export async function ensureRegistrationItemTypesSeeded(): Promise<{ created: number }> {
  let created = 0;
  for (const s of REGISTRATION_ITEM_SEED) {
    const existing = await prisma.registrationItemType.findUnique({ where: { key: s.key }, select: { id: true } });
    if (existing) continue;
    await prisma.registrationItemType.create({
      data: {
        activityType: s.activityType,
        activityGroup: s.activityGroup,
        activityGroupName: s.activityGroupName,
        key: s.key,
        name: s.name,
        contentKind: s.contentKind,
        feeMode: s.feeMode,
        defaultUnitPrice: s.defaultUnitPrice ?? null,
        defaultQuantity: s.defaultQuantity,
        allowMultiplePerMember: s.allowMultiplePerMember,
        printDocumentKeys: s.printDocumentKeys,
        metadataJson: s.metadata ? (s.metadata as Prisma.InputJsonValue) : undefined,
        sortOrder: s.sortOrder,
        isActive: true,
      },
    });
    created += 1;
  }
  return { created };
}

/**
 * V14.1 指令三：年度活動固定排序（全系統統一）。
 *   1 年度燈 → 2 宮慶 → 3 中元普渡 → 4 補庫（→ 其他）
 * 活動中心、報名入口、列印中心、查詢排序一律套用這個順序。
 */
export const ACTIVITY_GROUP_ORDER: readonly string[] = [
  "ANNUAL_LANTERN",
  "TEMPLE_CELEBRATION",
  "UNIVERSAL_SALVATION",
  "STORAGE_REPAYMENT",
  "DRAGON_PHOENIX_LANTERN",
];

/** 主活動分組的排序索引（未列出者排在最後、維持穩定）。 */
export function activityGroupOrderIndex(activityGroup: string): number {
  const i = ACTIVITY_GROUP_ORDER.indexOf(activityGroup);
  return i === -1 ? ACTIVITY_GROUP_ORDER.length : i;
}

/** 列出所有啟用中的報名項目（依固定主活動順序、項目排序）。 */
export async function listActivityGroups(): Promise<ActivityGroupView[]> {
  const rows = await prisma.registrationItemType.findMany({
    where: { isActive: true },
    orderBy: [{ activityGroup: "asc" }, { sortOrder: "asc" }],
  });
  const byGroup = new Map<string, ActivityGroupView>();
  for (const r of rows) {
    const view = toView(r);
    let g = byGroup.get(view.activityGroup);
    if (!g) {
      g = { activityGroup: view.activityGroup, activityGroupName: view.activityGroupName, items: [] };
      byGroup.set(view.activityGroup, g);
    }
    g.items.push(view);
  }
  // 套用固定年度活動順序（指令三）。
  return Array.from(byGroup.values()).sort(
    (a, b) => activityGroupOrderIndex(a.activityGroup) - activityGroupOrderIndex(b.activityGroup)
  );
}

/** 某個主活動（activityGroup）底下的報名項目。 */
export async function listItemsForActivityGroup(activityGroup: string): Promise<RegistrationItemView[]> {
  const rows = await prisma.registrationItemType.findMany({
    where: { isActive: true, activityGroup },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map(toView);
}

/** 依 key 取單一項目設定。 */
export async function getRegistrationItemTypeByKey(key: string): Promise<RegistrationItemView | null> {
  const row = await prisma.registrationItemType.findUnique({ where: { key } });
  return row ? toView(row) : null;
}

/** 依 id 取單一項目設定。 */
export async function getRegistrationItemTypeById(id: string): Promise<RegistrationItemView | null> {
  const row = await prisma.registrationItemType.findUnique({ where: { id } });
  return row ? toView(row) : null;
}

/**
 * 計算某項目某筆報名的應收金額。純函式（不查 DB），方便單元測試。
 *
 * - NONE：0
 * - FIXED：固定單價（defaultUnitPrice，缺則 0）
 * - PER_UNIT：單價 × 數量
 * - CUSTOM：使用者輸入的自訂金額
 * - FIXED_OR_CUSTOM：feeChoice=FIXED → 固定單價；=CUSTOM → 自訂金額
 */
export function computeItemAmountDue(input: {
  feeMode: RegistrationFeeMode;
  defaultUnitPrice: number | null;
  quantity: number;
  customAmount?: number | null;
  feeChoice?: "FIXED" | "CUSTOM" | null;
}): { ok: true; amountDue: number } | { ok: false; reason: string } {
  const { feeMode, defaultUnitPrice, quantity, customAmount, feeChoice } = input;
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, reason: "數量必須是 1 以上的整數" };
  }
  const unit = defaultUnitPrice ?? 0;
  switch (feeMode) {
    case "NONE":
      return { ok: true, amountDue: 0 };
    case "FIXED":
      return { ok: true, amountDue: round2(unit) };
    case "PER_UNIT":
      if (unit < 0) return { ok: false, reason: "單價不得為負" };
      return { ok: true, amountDue: round2(unit * quantity) };
    case "CUSTOM": {
      const amt = customAmount ?? null;
      if (amt === null || !Number.isFinite(amt) || amt < 0) {
        return { ok: false, reason: "請輸入有效的自訂金額" };
      }
      return { ok: true, amountDue: round2(amt) };
    }
    case "FIXED_OR_CUSTOM": {
      if (feeChoice === "FIXED") return { ok: true, amountDue: round2(unit) };
      if (feeChoice === "CUSTOM") {
        const amt = customAmount ?? null;
        if (amt === null || !Number.isFinite(amt) || amt < 0) {
          return { ok: false, reason: "自訂金額無效" };
        }
        return { ok: true, amountDue: round2(amt) };
      }
      return { ok: false, reason: "贊普必須選擇固定費用或自訂金額" };
    }
    default:
      return { ok: false, reason: `未知的收費方式：${feeMode}` };
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * 福壽龜大龜／中龜的預設數量（存 metadataJson，可由管理者編輯）。
 * 讀不到就回空陣列，呼叫端不得寫死數字。
 */
export type TurtleSizeConfig = { key: string; name: string; defaultQuantity: number };

export function readTurtleSizes(metadata: unknown): TurtleSizeConfig[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const sizes = (metadata as Record<string, unknown>).sizes;
  if (!Array.isArray(sizes)) return [];
  const out: TurtleSizeConfig[] = [];
  for (const s of sizes) {
    if (s && typeof s === "object") {
      const o = s as Record<string, unknown>;
      if (typeof o.key === "string" && typeof o.name === "string" && Number.isInteger(o.defaultQuantity)) {
        out.push({ key: o.key, name: o.name, defaultQuantity: o.defaultQuantity as number });
      }
    }
  }
  return out;
}
