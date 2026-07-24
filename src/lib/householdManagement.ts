import { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";
import {
  syncMemberHouseholdReferences,
  countMemberHouseholdReferences,
  describeSyncCounts,
  type HouseholdReferenceSyncCounts,
} from "@/lib/householdReferenceSync";
import {
  setPrimaryContact,
  clearPrimaryContact,
  resolvePrimaryContactAfterRemoval,
  clearIncomingPrimaryContactFlags,
  describePrimaryContact,
} from "@/lib/householdPrimaryContact";
import {
  findDuplicateMatches,
  type DuplicateCandidate,
  type DuplicateMatch,
} from "@/lib/devoteeDuplicateMatcher";

/**
 * V12.1「家戶管理中心」核心邏輯。
 *
 * 設計原則（對應這輪指令「二十、共用程式與型別」）：
 * 1. 沿用既有 Household／Member／WorshipRecord 資料表，不建立第二套家戶
 *    系統，不新增 Prisma schema／migration（逐項確認見下方各函式註解）：
 *    - 戶長：沿用既有 Member.role 的 HOUSEHOLD_HEAD 這個既有 enum 值，
 *      不新增 headMemberId 欄位。
 *    - 封存：沿用既有 Household.deletedAt／deletedByName（V8.0「刪除
 *      保護」已經建立、src/lib/recycleBin.ts 也已經支援 Household 的
 *      清單／還原／永久刪除），不新增 isArchived 等欄位。封存後的家戶會
 *      自動出現在既有回收區畫面，可以直接用既有還原功能復原，不需要另外
 *      開發「取消封存」功能。
 *    - 操作紀錄：沿用既有 src/lib/recordVersion.ts（entityType/entityId/
 *      action/beforeData/afterData/operatorName/changeNote 通用格式），
 *      不新增 HouseholdOperationLog 資料表。合併/拆分/轉移這類牽涉多個
 *      家戶或多位成員的操作，來源/目標家戶編號與受影響成員清單記錄在
 *      changeNote 文字裡（可從任一方的版本紀錄查到完整脈絡）。
 * 2. 所有會修改多筆資料的操作都在 prisma.$transaction 裡完成，任一步驟
 *    失敗就整筆回復（對應指令「二、10」「十一/十二/十三」的 Transaction
 *    要求）。
 * 3. 只搬動「家戶成員」「歷代祖先」「乙位正魂」，其餘關聯資料（活動紀錄、
 *    普渡登記、收款、收據、供品認捐、附加列印項目等）刻意不搬動——這些
 *    紀錄仍然透過 householdId 指向原本的家戶列（家戶合併後只是被軟刪除／
 *    封存，資料列本身沒有被刪除，仍然可以被查到，只是不會出現在一般
 *    家戶列表），這是刻意保守的設計，避免大規模改動十幾張關聯表、增加
 *    出錯風險。這一點在合併/拆分預覽與交付報告都會清楚說明。
 */

export class HouseholdManagementError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "HouseholdManagementError";
    this.status = status;
  }
}

// ============================================================
// 共用小工具
// ============================================================

function toNullableString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
}

/** 家戶編號正規化：去除前後空白（對應指令「新增家戶」「二.2」）。 */
export function normalizeHouseholdCode(raw: string): string {
  return raw.trim();
}

/**
 * 檢查家戶編號是否可用（對應指令「三.1/3.2」「九.1」「新增家戶.1-3」）。
 * excludeHouseholdId：修改既有家戶時，允許「維持原編號不變」，不算重複。
 */
export async function validateHouseholdCode(
  code: string,
  excludeHouseholdId?: string
): Promise<string | null> {
  const trimmed = normalizeHouseholdCode(code);
  if (!trimmed) return "家戶編號不可空白";
  if (trimmed.length > 10) return "家戶編號長度不可超過 10 個字元";

  // ⚠️ V12.3 指令二：**曾使用過的家戶編號一律不可回收。**
  //
  // 這裡刻意用 findUnique（不加 deletedAt: null 條件）——被軟刪除或被合併的
  // 家戶，它的編號仍然是歷史識別碼，不可以讓別的家戶重新使用，否則舊單據、
  // 舊 Excel、回收區還原都會對到錯誤的一戶。V12.3 之前這裡就是這樣寫，
  // 行為維持不變，這次只是把理由寫清楚。
  const existing = await prisma.household.findUnique({ where: { id: trimmed } });
  if (existing && existing.id !== excludeHouseholdId) {
    return existing.deletedAt
      ? "這個家戶編號屬於已封存或已合併的家戶，不可重複使用"
      : "家戶編號已被其他家戶使用";
  }

  // V12.3 指令二：同時檢查歷史別名。某一戶把編號從 F00009 改成 F00123 之後，
  // F00009 仍然指向那一戶（供 Excel 匯入與搜尋對照），不可以被第三戶拿去用。
  const alias = await prisma.householdCodeAlias.findUnique({ where: { oldCode: trimmed } });
  if (alias && alias.householdId !== excludeHouseholdId) {
    return `這個家戶編號是家戶 ${alias.householdId} 使用過的舊編號，不可重複使用`;
  }

  return null;
}

/**
 * 依家戶編號解析出「目前正式的家戶」——先查現行編號，再查歷史別名。
 * V12.3 指令七：Excel 匯入與搜尋都必須能用舊編號命中目前這一戶。
 */
export async function resolveHouseholdByAnyCode(code: string): Promise<{
  household: { id: string; name: string; deletedAt: Date | null; mergedIntoHouseholdId: string | null } | null;
  matchedVia: "CURRENT" | "ALIAS" | "NONE";
  aliasOldCode: string | null;
}> {
  const trimmed = normalizeHouseholdCode(code);
  if (!trimmed) return { household: null, matchedVia: "NONE", aliasOldCode: null };

  const direct = await prisma.household.findUnique({
    where: { id: trimmed },
    select: { id: true, name: true, deletedAt: true, mergedIntoHouseholdId: true },
  });
  if (direct) return { household: direct, matchedVia: "CURRENT", aliasOldCode: null };

  const alias = await prisma.householdCodeAlias.findUnique({
    where: { oldCode: trimmed },
    include: {
      household: { select: { id: true, name: true, deletedAt: true, mergedIntoHouseholdId: true } },
    },
  });
  if (alias?.household) {
    return { household: alias.household, matchedVia: "ALIAS", aliasOldCode: alias.oldCode };
  }

  return { household: null, matchedVia: "NONE", aliasOldCode: null };
}

/**
 * V12.3：已經被合併掉的家戶不可以再被操作，也不可以再當合併目標
 * （指令二：不可建立循環合併；已合併的來源戶不可再當目標戶或再次操作）。
 */
export async function assertHouseholdNotMerged(householdId: string): Promise<void> {
  const h = await prisma.household.findUnique({
    where: { id: householdId },
    select: { mergedIntoHouseholdId: true },
  });
  if (h?.mergedIntoHouseholdId) {
    throw new HouseholdManagementError(
      `這個家戶已經合併至 ${h.mergedIntoHouseholdId}，不可再次操作。請改為操作合併後的家戶。`,
      409
    );
  }
}

async function requireActiveHousehold(id: string) {
  const household = await prisma.household.findFirst({ where: { id, deletedAt: null } });
  if (!household) throw new HouseholdManagementError("找不到這個家戶", 404);
  return household;
}

async function requireActiveMember(id: string) {
  const member = await prisma.member.findFirst({ where: { id, deletedAt: null } });
  if (!member) throw new HouseholdManagementError("找不到這位信眾", 404);
  return member;
}

// ============================================================
// 家戶基本資料：新增／修改（對應指令「八、新增家戶」「九、修改家戶」）
// ============================================================

export type HouseholdBasicInput = {
  id?: string; // 家戶編號（新增時必填；修改時不填代表不更動）
  name?: string; // 戶名（可空白，見指令「三.4」）
  contactName?: string | null;
  address?: string | null;
  phone?: string | null;
  mobile?: string | null;
  companyName?: string | null;
  notes?: string | null;
};

export function normalizeHouseholdBasicInput(input: HouseholdBasicInput): HouseholdBasicInput {
  const out: HouseholdBasicInput = {};
  if (input.id !== undefined) out.id = normalizeHouseholdCode(input.id);
  if (input.name !== undefined) out.name = input.name.trim();
  if (input.contactName !== undefined) out.contactName = toNullableString(input.contactName);
  if (input.address !== undefined) out.address = toNullableString(input.address);
  if (input.phone !== undefined) out.phone = toNullableString(input.phone);
  if (input.mobile !== undefined) out.mobile = toNullableString(input.mobile);
  if (input.companyName !== undefined) out.companyName = toNullableString(input.companyName);
  if (input.notes !== undefined) out.notes = toNullableString(input.notes);
  return out;
}

/**
 * 修改家戶基本資料（含家戶編號、戶名——這兩個欄位過去版本刻意不開放
 * 修改，這次指令「一/三」明確要求開放，見下方家戶編號修改的安全說明）。
 *
 * ⚠️ 家戶編號修改安全性：Household.id 是主鍵，被 Member／WorshipRecord／
 * Activity／RitualRecord／PaymentTransaction／Receipt 等十幾張表引用。
 * 這次逐一檢查全部 migration 檔案，確認每一個引用 households.id 的外鍵
 * 都已經是 `ON UPDATE CASCADE`（Prisma 對必要關聯的預設行為），所以用
 * Prisma 的 `update({ data: { id: 新編號 } })` 修改主鍵時，PostgreSQL 會
 * 在同一個 UPDATE 陳述式裡自動把所有關聯表的 householdId 一併更新，不會
 * 產生外鍵衝突、也不需要額外手動同步十幾張表。這跟先前 V12 信眾資料中心
 * 那一輪「不開放修改家戶編號」的決定不同——先前是因為沒有逐一確認到
 * ON UPDATE CASCADE 這件事，這次已經完整確認過了。
 */
export async function updateHouseholdBasic(
  currentId: string,
  rawInput: HouseholdBasicInput,
  operatorName: string | null,
  /** V12.3 指令八：異動紀錄要能追到帳號，不只是自由文字姓名。 */
  operatorUserId?: string | null
) {
  const existing = await requireActiveHousehold(currentId);
  // V12.3：已合併的家戶不可再被修改（指令二）。
  await assertHouseholdNotMerged(currentId);
  const input = normalizeHouseholdBasicInput(rawInput);

  let newId: string | undefined;
  if (input.id !== undefined && input.id !== existing.id) {
    const codeError = await validateHouseholdCode(input.id, existing.id);
    if (codeError) throw new HouseholdManagementError(codeError);
    newId = input.id;
  }

  const data: Prisma.HouseholdUpdateInput = {};
  if (newId) data.id = newId;
  if (input.name !== undefined) data.name = input.name; // 可為空字串，戶名允許空白
  if (input.contactName !== undefined) data.contactName = input.contactName;
  if (input.address !== undefined) data.address = input.address;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.mobile !== undefined) data.mobile = input.mobile;
  if (input.companyName !== undefined) data.companyName = input.companyName;
  if (input.notes !== undefined) data.notes = input.notes;

  if (Object.keys(data).length === 0) {
    return { household: existing };
  }

  const household = await prisma.$transaction(async (tx) => {
    const updated = await tx.household.update({ where: { id: existing.id }, data });

    // V12.3 指令二：改編號時保留舊編號對照。
    //
    // 一定要放在 household.update 之後：household_code_aliases.householdId 的
    // 外鍵是 ON UPDATE CASCADE，先前既有的別名會在主鍵變更時自動跟著指向新
    // 編號；這裡再補上「這一次被換掉的舊編號」那一筆。整段都在同一個
    // transaction 內，改編號與寫別名要嘛都成功、要嘛一起 rollback。
    if (newId) {
      await tx.householdCodeAlias.create({
        data: {
          oldCode: existing.id,
          householdId: updated.id,
          reason: "家戶編號變更",
          operatorUserId,
          operatorName,
        },
      });
    }

    // V12.3 指令三.5：不可只改 contactName 而不處理 isPrimaryContact。
    // 這裡只做「校正到一致」——若指定的 contactName 剛好對得上該戶某位成員，
    // 就把旗標同步過去；對不上（例如填的是外部聯絡人）則維持文字即可，
    // 不擅自把某位成員設成主要聯絡人。
    if (input.contactName !== undefined && input.contactName) {
      const matched = await tx.member.findFirst({
        where: { householdId: updated.id, name: input.contactName, deletedAt: null },
        select: { id: true },
      });
      if (matched) {
        await tx.member.updateMany({
          where: { householdId: updated.id, isPrimaryContact: true, NOT: { id: matched.id } },
          data: { isPrimaryContact: false },
        });
        await tx.member.update({ where: { id: matched.id }, data: { isPrimaryContact: true } });
      }
    }

    await recordVersion(
      {
        entityType: "Household",
        entityId: updated.id,
        action: "UPDATE",
        beforeData: existing,
        afterData: updated,
        operatorName,
        changeNote: newId
          ? `家戶管理中心：修改家戶基本資料（家戶編號由 ${existing.id} 修改為 ${newId}；舊編號已保留對照，Excel 匯入與搜尋仍可用舊編號找到本戶）｜操作人 userId=${operatorUserId ?? "（未記錄）"}`
          : `家戶管理中心：修改家戶基本資料｜操作人 userId=${operatorUserId ?? "（未記錄）"}`,
      },
      tx
    );
    return updated;
  });

  return { household };
}

/**
 * 家戶編號格式沿用既有種子/實際資料的慣例（見 F00009 王家範例）：
 * 字母 F ＋ 5 位數字，例如 F00010。這裡只在「自動產生」時使用這個格式
 * 當作預設建議值，使用者仍然可以自行輸入任何 ≤10 字元的編號（既有
 * validateHouseholdCode() 的規則不變，不因為有自動產生功能而收緊）。
 */
const AUTO_HOUSEHOLD_CODE_PATTERN = /^F(\d{5})$/;

async function findNextAutoHouseholdCode(): Promise<string> {
  const rows = await prisma.household.findMany({
    where: { id: { startsWith: "F" } },
    select: { id: true },
  });
  let maxNum = 0;
  for (const row of rows) {
    const match = AUTO_HOUSEHOLD_CODE_PATTERN.exec(row.id);
    if (match) {
      const n = Number(match[1]);
      if (n > maxNum) maxNum = n;
    }
  }
  return `F${String(maxNum + 1).padStart(5, "0")}`;
}

/**
 * 新增家戶（對應指令「八、新增家戶」及「驗收修正-1」新增的自動產生編號
 * 需求）。只建立 Household 本身；家戶成員由呼叫端另外用既有的「新增
 * 家人」流程（src/app/api/households/[id]/members/route.ts，本次沒有
 * 修改）逐一加入，避免這裡重複實作一套加入成員的邏輯。
 *
 * 家戶編號留空時自動產生（見 findNextAutoHouseholdCode()）；有填寫時
 * 沿用既有 validateHouseholdCode() 檢查唯一性，行為不變。自動產生的
 * 編號理論上不會跟既有資料重複，但為了保守起見（例如極少數同時新增的
 * 情況），若寫入時真的撞到唯一鍵衝突，會自動往下一個號碼重試，最多
 * 重試 5 次，仍失敗才回報錯誤，不會讓使用者看到原始 Prisma 錯誤。
 */
export async function createHousehold(rawInput: HouseholdBasicInput, operatorName: string | null, db?: DbClient) {
  const input = normalizeHouseholdBasicInput(rawInput);

  const autoGenerate = !input.id;
  if (!autoGenerate) {
    const codeError = await validateHouseholdCode(input.id!);
    if (codeError) throw new HouseholdManagementError(codeError);
  }

  // 有外部 tx（Excel 匯入單列 confirm）：不能在同一 tx 內重試（P2002 會中止交易），
  // 故單次嘗試；撞號時往上拋，由呼叫端整列 rollback＋標 FAILED，重試時取新號。
  if (db) {
    const id = autoGenerate ? await findNextAutoHouseholdCode() : input.id!;
    const created = await db.household.create({
      data: {
        id, name: input.name ?? "", contactName: input.contactName ?? null, address: input.address ?? null,
        phone: input.phone ?? null, mobile: input.mobile ?? null, companyName: input.companyName ?? null, notes: input.notes ?? null,
      },
    });
    await recordVersion(
      { entityType: "Household", entityId: created.id, action: "CREATE", afterData: created, operatorName, changeNote: "Excel 匯入：新增家戶" },
      db
    );
    return { household: created };
  }

  const maxAttempts = autoGenerate ? 5 : 1;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = autoGenerate ? await findNextAutoHouseholdCode() : input.id!;
    try {
      const household = await prisma.$transaction(async (tx) => {
        const created = await tx.household.create({
          data: {
            id,
            name: input.name ?? "",
            contactName: input.contactName ?? null,
            address: input.address ?? null,
            phone: input.phone ?? null,
            mobile: input.mobile ?? null,
            companyName: input.companyName ?? null,
            notes: input.notes ?? null,
          },
        });
        await recordVersion(
          {
            entityType: "Household",
            entityId: created.id,
            action: "CREATE",
            afterData: created,
            operatorName,
            changeNote: autoGenerate ? "家戶管理中心：新增家戶（自動產生編號）" : "家戶管理中心：新增家戶",
          },
          tx
        );
        return created;
      });
      return { household };
    } catch (e) {
      lastError = e;
      const isUniqueConflict = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
      if (!autoGenerate || !isUniqueConflict) throw e;
      // 自動產生的編號撞到唯一鍵衝突：往下一個號碼重試。
    }
  }

  throw lastError instanceof Error ? lastError : new HouseholdManagementError("自動產生家戶編號失敗，請稍後再試一次或自行輸入編號", 500);
}

// ============================================================
// 戶長（對應指令「十、戶長設計」）
// ============================================================

/**
 * 指定戶長。沿用既有 Member.role 的 HOUSEHOLD_HEAD 值，不新增欄位。
 * 每戶最多一位戶長：指定新戶長前，先把這一戶目前其他戶長（正常情況下
 * 最多一位，但保守起見用 findMany 涵蓋既有資料可能不一致的情況）降級為
 * 「其他」，避免出現兩位戶長。
 */
export async function assignHouseholdHead(
  householdId: string,
  memberId: string,
  operatorName: string | null
) {
  const household = await requireActiveHousehold(householdId);
  const member = await requireActiveMember(memberId);
  if (member.householdId !== household.id) {
    throw new HouseholdManagementError("這位信眾不屬於這個家戶，無法指定為戶長");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const currentHeads = await tx.member.findMany({
      where: { householdId: household.id, role: "HOUSEHOLD_HEAD", deletedAt: null, NOT: { id: member.id } },
    });
    for (const head of currentHeads) {
      const after = await tx.member.update({ where: { id: head.id }, data: { role: "OTHER" } });
      await recordVersion(
        {
          entityType: "Member",
          entityId: head.id,
          action: "UPDATE",
          beforeData: head,
          afterData: after,
          operatorName,
          changeNote: `家戶管理中心：改指定 ${member.name} 為戶長，原戶長身份改為「其他」（家戶維持最多一位戶長）`,
        },
        tx
      );
    }

    const after = await tx.member.update({ where: { id: member.id }, data: { role: "HOUSEHOLD_HEAD" } });
    await recordVersion(
      {
        entityType: "Member",
        entityId: member.id,
        action: "UPDATE",
        beforeData: member,
        afterData: after,
        operatorName,
        changeNote: `家戶管理中心：指定為戶長（家戶 ${household.id}）`,
      },
      tx
    );
    return after;
  });

  return { member: updated };
}

// ============================================================
// 家戶列表與搜尋（對應指令「六、家戶列表」「七、家戶搜尋」）
// ============================================================

export type HouseholdListItem = {
  id: string;
  name: string;
  headMemberId: string | null;
  headName: string | null;
  contactName: string | null;
  phone: string | null;
  mobile: string | null;
  address: string | null;
  memberCount: number;
  ancestorCount: number;
  individualCount: number;
  updatedAt: Date;
};

export type HouseholdSearchResult = {
  items: HouseholdListItem[];
  total: number;
  page: number;
  pageSize: number;
};

/** 電話搜尋忽略常見的空格與連字號差異（對應指令「七、搜尋規則.3」）。 */
function normalizePhoneQuery(q: string): string {
  return q.replace(/[\s-]/g, "");
}

export async function searchHouseholds(params: {
  query?: string;
  page?: number;
  pageSize?: number;
  includeArchived?: boolean;
}): Promise<HouseholdSearchResult> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 20)));
  const q = (params.query ?? "").trim();

  const where: Prisma.HouseholdWhereInput = params.includeArchived
    ? {}
    : { deletedAt: null };

  if (q) {
    const phoneQuery = normalizePhoneQuery(q);
    const or: Prisma.HouseholdWhereInput[] = [
      { id: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { contactName: { contains: q, mode: "insensitive" } },
      { address: { contains: q, mode: "insensitive" } },
      {
        members: {
          some: { deletedAt: null, name: { contains: q, mode: "insensitive" } },
        },
      },
      {
        worshipRecords: { some: { displayName: { contains: q, mode: "insensitive" } } },
      },
    ];
    if (phoneQuery) {
      or.push({ phone: { contains: phoneQuery } });
      or.push({ mobile: { contains: phoneQuery } });
    }
    where.OR = or;
  }

  const [total, rows] = await Promise.all([
    prisma.household.count({ where }),
    prisma.household.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        members: { where: { deletedAt: null }, select: { id: true, name: true, role: true } },
        worshipRecords: { select: { type: true } },
      },
    }),
  ]);

  const items: HouseholdListItem[] = rows.map((h) => {
    const head = h.members.find((m) => m.role === "HOUSEHOLD_HEAD");
    return {
      id: h.id,
      name: h.name,
      headMemberId: head?.id ?? null,
      headName: head?.name ?? null,
      contactName: h.contactName,
      phone: h.phone,
      mobile: h.mobile,
      address: h.address,
      memberCount: h.members.length,
      ancestorCount: h.worshipRecords.filter((w) => w.type === "ANCESTOR_LINE").length,
      individualCount: h.worshipRecords.filter((w) => w.type === "INDIVIDUAL").length,
      updatedAt: h.updatedAt,
    };
  });

  return { items, total, page, pageSize };
}

// ============================================================
// 疑似重複人物提示（沿用既有 devoteeDuplicateMatcher.ts，只提示不自動處理）
// ============================================================

function birthdayKeyOf(m: {
  solarBirthDate: Date | null;
  lunarBirthYear: number | null;
  lunarBirthMonth: number | null;
  lunarBirthDay: number | null;
  lunarIsLeapMonth: boolean;
}): string | null {
  if (m.solarBirthDate) return `solar:${m.solarBirthDate.toISOString().slice(0, 10)}`;
  if (m.lunarBirthYear && m.lunarBirthMonth && m.lunarBirthDay) {
    return `lunar:${m.lunarBirthYear}-${m.lunarBirthMonth}-${m.lunarBirthDay}-${m.lunarIsLeapMonth}`;
  }
  return null;
}

export async function findSuspectedDuplicatesAcross(memberIdsOrHouseholdIds: {
  memberIds?: string[];
  householdIds?: string[];
}): Promise<DuplicateMatch[]> {
  const members = await prisma.member.findMany({
    where: {
      deletedAt: null,
      OR: [
        memberIdsOrHouseholdIds.memberIds?.length ? { id: { in: memberIdsOrHouseholdIds.memberIds } } : undefined,
        memberIdsOrHouseholdIds.householdIds?.length
          ? { householdId: { in: memberIdsOrHouseholdIds.householdIds } }
          : undefined,
      ].filter(Boolean) as Prisma.MemberWhereInput[],
    },
    include: { household: { select: { phone: true, mobile: true, address: true } } },
  });

  const candidates: DuplicateCandidate[] = members.map((m) => ({
    memberId: m.id,
    name: m.name,
    phone: m.household.mobile ?? m.household.phone ?? null,
    address: m.household.address ?? null,
    birthdayKey: birthdayKeyOf(m),
    householdId: m.householdId,
  }));

  return findDuplicateMatches(candidates);
}

// ============================================================
// 家戶合併（對應指令「十一、家戶合併」）
// ============================================================

const MERGEABLE_FIELDS = ["name", "contactName", "address", "phone", "mobile", "notes"] as const;
export type MergeableField = (typeof MERGEABLE_FIELDS)[number];

export type HouseholdMergeFieldConflict = {
  field: MergeableField;
  targetValue: string | null;
  sourceValue: string | null;
};

export type HouseholdMergePreview = {
  target: { id: string; name: string; contactName: string | null; address: string | null; phone: string | null; mobile: string | null; notes: string | null; headMemberId: string | null; headName: string | null };
  source: { id: string; name: string; contactName: string | null; address: string | null; phone: string | null; mobile: string | null; notes: string | null; headMemberId: string | null; headName: string | null };
  conflicts: HouseholdMergeFieldConflict[];
  membersToMove: { id: string; name: string; role: string }[];
  suspectedDuplicates: DuplicateMatch[];
  ancestorsToMerge: { id: string; displayName: string; duplicate: boolean }[];
  individualsToMerge: { id: string; displayName: string; duplicate: boolean }[];
  affectedCounts: {
    activities: number;
    ritualRecords: number;
    paymentTransactions: number;
    receipts: number;
    additionalPrintItems: number;
    offeringClaims: number;
  };
  /**
   * V12.3 指令五：這次會「跟著成員一起同步 householdId」的六張去正規化表的筆數。
   * 跟 affectedCounts 不同——affectedCounts 是來源戶名下的全部紀錄數，
   * 這裡是實際會被 UPDATE 的筆數（已經在目標戶的不重複計算）。
   */
  syncCounts: HouseholdReferenceSyncCounts;
  /**
   * V12.3 指令一.B：不會搬移、但合併後會在目標戶歷史頁一併顯示的家戶層級紀錄。
   * 這些紀錄的 householdId 維持在來源戶（保留歷史發生時的原始家戶），
   * 畫面上會標示「原家戶：Fxxxxx／戶名」。
   */
  householdLevelHistory: {
    activities: number;
    ritualRecords: number;
    /** RitualRecord 有 @@unique([householdId, year, activityType])，這是實際會衝突的組合 */
    ritualUniqueConflicts: { year: number; activityType: string }[];
  };
  /** V12.3 指令三.4：兩戶的主要聯絡人，兩者都有且不同時必須由使用者選擇。 */
  primaryContact: {
    target: { memberId: string | null; name: string | null };
    source: { memberId: string | null; name: string | null };
    needsChoice: boolean;
  };
  willBecomeEmpty: false; // 合併一定會清空來源家戶（成員全部移走），保留欄位是為了跟拆分/轉移的預覽型別呼應
};

async function loadHouseholdForMerge(id: string) {
  const household = await prisma.household.findFirst({
    where: { id, deletedAt: null },
    include: { members: { where: { deletedAt: null } }, worshipRecords: true },
  });
  if (!household) throw new HouseholdManagementError(`找不到家戶 ${id}`, 404);
  return household;
}

function fieldConflicts(
  target: { name: string; contactName: string | null; address: string | null; phone: string | null; mobile: string | null; notes: string | null },
  source: { name: string; contactName: string | null; address: string | null; phone: string | null; mobile: string | null; notes: string | null }
): HouseholdMergeFieldConflict[] {
  const conflicts: HouseholdMergeFieldConflict[] = [];
  for (const field of MERGEABLE_FIELDS) {
    const t = target[field] ?? null;
    const s = source[field] ?? null;
    if (s !== null && s !== "" && t !== s) {
      conflicts.push({ field, targetValue: t, sourceValue: s });
    }
  }
  return conflicts;
}

export async function previewHouseholdMerge(targetId: string, sourceId: string): Promise<HouseholdMergePreview> {
  if (targetId === sourceId) throw new HouseholdManagementError("目標家戶與來源家戶不可相同");
  const [target, source] = await Promise.all([loadHouseholdForMerge(targetId), loadHouseholdForMerge(sourceId)]);

  const targetHead = target.members.find((m) => m.role === "HOUSEHOLD_HEAD");
  const sourceHead = source.members.find((m) => m.role === "HOUSEHOLD_HEAD");

  const conflicts = fieldConflicts(target, source);

  const membersToMove = source.members.map((m) => ({ id: m.id, name: m.name, role: m.role }));

  const suspectedDuplicates = await findSuspectedDuplicatesAcross({ householdIds: [targetId, sourceId] });

  const targetAncestorNames = new Set(
    target.worshipRecords.filter((w) => w.type === "ANCESTOR_LINE").map((w) => w.displayName)
  );
  const targetIndividualNames = new Set(
    target.worshipRecords.filter((w) => w.type === "INDIVIDUAL").map((w) => w.displayName)
  );
  const ancestorsToMerge = source.worshipRecords
    .filter((w) => w.type === "ANCESTOR_LINE")
    .map((w) => ({ id: w.id, displayName: w.displayName, duplicate: targetAncestorNames.has(w.displayName) }));
  const individualsToMerge = source.worshipRecords
    .filter((w) => w.type === "INDIVIDUAL")
    .map((w) => ({ id: w.id, displayName: w.displayName, duplicate: targetIndividualNames.has(w.displayName) }));

  const [activities, ritualRecords, paymentTransactions, receipts, additionalPrintItems, offeringClaims] =
    await Promise.all([
      prisma.activity.count({ where: { householdId: sourceId } }),
      prisma.ritualRecord.count({ where: { householdId: sourceId } }),
      prisma.paymentTransaction.count({ where: { payerHouseholdId: sourceId } }),
      prisma.receipt.count({ where: { householdId: sourceId } }),
      prisma.additionalPrintItem.count({ where: { householdId: sourceId } }),
      prisma.offeringClaim.count({ where: { sponsorHouseholdId: sourceId } }),
    ]);

  // V12.3 指令五：實際會被同步的六張表筆數（跟著成員走）。
  const syncCounts = await countMemberHouseholdReferences(
    prisma,
    source.members.map((m) => m.id),
    targetId
  );

  // V12.3 指令一.B：RitualRecord 有 @@unique([householdId, year, activityType])。
  // 這也正是「純家戶層級歷史不搬移」的技術原因——先算出兩戶實際會撞到的組合，
  // 在 preview 明白告訴使用者哪些年度/類型重疊。
  const [targetRituals, sourceRituals] = await Promise.all([
    prisma.ritualRecord.findMany({
      where: { householdId: targetId },
      select: { year: true, activityType: true },
    }),
    prisma.ritualRecord.findMany({
      where: { householdId: sourceId },
      select: { year: true, activityType: true },
    }),
  ]);
  const targetRitualKeys = new Set(targetRituals.map((r) => `${r.year}|${r.activityType}`));
  const ritualUniqueConflicts = sourceRituals
    .filter((r) => targetRitualKeys.has(`${r.year}|${r.activityType}`))
    .map((r) => ({ year: r.year, activityType: String(r.activityType) }));

  // V12.3 指令三.4：主要聯絡人衝突。
  const [targetContact, sourceContact] = await Promise.all([
    describePrimaryContact(prisma, targetId),
    describePrimaryContact(prisma, sourceId),
  ]);

  return {
    target: {
      id: target.id,
      name: target.name,
      contactName: target.contactName,
      address: target.address,
      phone: target.phone,
      mobile: target.mobile,
      notes: target.notes,
      headMemberId: targetHead?.id ?? null,
      headName: targetHead?.name ?? null,
    },
    source: {
      id: source.id,
      name: source.name,
      contactName: source.contactName,
      address: source.address,
      phone: source.phone,
      mobile: source.mobile,
      notes: source.notes,
      headMemberId: sourceHead?.id ?? null,
      headName: sourceHead?.name ?? null,
    },
    conflicts,
    membersToMove,
    suspectedDuplicates,
    ancestorsToMerge,
    individualsToMerge,
    affectedCounts: { activities, ritualRecords, paymentTransactions, receipts, additionalPrintItems, offeringClaims },
    syncCounts,
    householdLevelHistory: { activities, ritualRecords, ritualUniqueConflicts },
    primaryContact: {
      target: targetContact,
      source: sourceContact,
      needsChoice: Boolean(
        targetContact.name && sourceContact.name && targetContact.name !== sourceContact.name
      ),
    },
    willBecomeEmpty: false,
  };
}

export type HouseholdMergeFieldResolutionEntry =
  | { use: "target" }
  | { use: "source" }
  | { use: "custom"; value: string | null };

export type HouseholdMergeFieldResolution = Partial<Record<MergeableField, HouseholdMergeFieldResolutionEntry>>;

export async function mergeHouseholds(params: {
  targetId: string;
  sourceId: string;
  fieldResolution?: HouseholdMergeFieldResolution;
  keepHeadMemberId?: string | null;
  /** V12.3 指令三.4：兩戶都有主要聯絡人時，合併後要保留的那一位。 */
  keepPrimaryContactMemberId?: string | null;
  operatorName: string | null;
  operatorUserId?: string | null;
}) {
  const {
    targetId,
    sourceId,
    fieldResolution,
    keepHeadMemberId,
    keepPrimaryContactMemberId,
    operatorName,
    operatorUserId,
  } = params;
  if (targetId === sourceId) throw new HouseholdManagementError("不可將家戶與自己合併");

  // V12.3 指令二：不可循環合併——已經被併走的家戶，既不能當來源也不能當目標。
  await assertHouseholdNotMerged(targetId);
  await assertHouseholdNotMerged(sourceId);

  const target = await loadHouseholdForMerge(targetId);
  const source = await loadHouseholdForMerge(sourceId);

  // V12.3 指令三.4：兩戶都有主要聯絡人時，必須由使用者明確選擇保留哪一位。
  const targetContact = await describePrimaryContact(prisma, targetId);
  const sourceContact = await describePrimaryContact(prisma, sourceId);
  if (targetContact.name && sourceContact.name && targetContact.name !== sourceContact.name) {
    if (!keepPrimaryContactMemberId) {
      throw new HouseholdManagementError(
        `兩戶都有主要聯絡人（${targetContact.name}／${sourceContact.name}），請先選擇合併後要保留哪一位`
      );
    }
  }
  if (
    keepPrimaryContactMemberId &&
    !target.members.some((m) => m.id === keepPrimaryContactMemberId) &&
    !source.members.some((m) => m.id === keepPrimaryContactMemberId)
  ) {
    throw new HouseholdManagementError("指定的主要聯絡人不屬於這兩個家戶");
  }

  // 欄位衝突必須由使用者明確選擇，不能靜默覆蓋（指令「十一、欄位衝突處理」）。
  const conflicts = fieldConflicts(target, source);
  for (const c of conflicts) {
    if (!fieldResolution?.[c.field]) {
      throw new HouseholdManagementError(
        `「${MERGE_FIELD_LABEL[c.field]}」欄位兩戶內容不同，請先選擇合併後要保留的值`
      );
    }
  }

  // 戶長防呆：兩戶合計若有一位以上戶長，必須指定合併後保留哪一位。
  const targetHead = target.members.find((m) => m.role === "HOUSEHOLD_HEAD");
  const sourceHead = source.members.find((m) => m.role === "HOUSEHOLD_HEAD");
  const candidateHeads = [targetHead, sourceHead].filter(Boolean) as { id: string }[];
  if (candidateHeads.length > 1 && !keepHeadMemberId) {
    throw new HouseholdManagementError("兩戶都有戶長，請先選擇合併後保留哪一位戶長");
  }
  if (
    keepHeadMemberId &&
    !target.members.some((m) => m.id === keepHeadMemberId) &&
    !source.members.some((m) => m.id === keepHeadMemberId)
  ) {
    throw new HouseholdManagementError("指定的戶長不屬於這兩個家戶");
  }

  const movingMemberIds = source.members.map((m) => m.id);

  const result = await prisma.$transaction(async (tx) => {
    // 1) 搬動家戶成員 → 目標家戶
    await tx.member.updateMany({ where: { householdId: sourceId, deletedAt: null }, data: { householdId: targetId } });

    // 1b) V12.3 指令一.A：六張同時存 memberId 與 householdId 的表，
    //     householdId 必須跟著成員一起同步到目標家戶，否則會出現
    //     「人在 B 戶、收款收據卻掛在 A 戶」。跟成員搬動在同一個
    //     transaction 內，任一步失敗會連 Member.householdId 一起 rollback。
    const syncCounts = await syncMemberHouseholdReferences(tx, movingMemberIds, targetId);

    // 1c) V12.3 指令三：搬進來的成員身上若還帶著來源戶的主要聯絡人旗標，
    //     必須先清掉，避免目標戶出現兩位主要聯絡人。
    await clearIncomingPrimaryContactFlags(tx, movingMemberIds);

    // 2) 戶長：依需要降級，確保合併後最多一位戶長
    if (keepHeadMemberId) {
      const others = [targetHead, sourceHead].filter((h) => h && h.id !== keepHeadMemberId) as { id: string }[];
      for (const h of others) {
        await tx.member.update({ where: { id: h.id }, data: { role: "OTHER" } });
      }
      await tx.member.update({ where: { id: keepHeadMemberId }, data: { role: "HOUSEHOLD_HEAD" } });
    }

    // 3) 歷代祖先／乙位正魂：完全相同（type + displayName）的不重複建立，
    //    其餘搬到目標家戶（對應指令「十一、名單型資料處理」）。
    const targetAncestorNames = new Set(
      target.worshipRecords.filter((w) => w.type === "ANCESTOR_LINE").map((w) => w.displayName)
    );
    const targetIndividualNames = new Set(
      target.worshipRecords.filter((w) => w.type === "INDIVIDUAL").map((w) => w.displayName)
    );
    for (const w of source.worshipRecords) {
      const dupNames = w.type === "ANCESTOR_LINE" ? targetAncestorNames : targetIndividualNames;
      if (dupNames.has(w.displayName)) continue; // 完全相同，跳過，留在（已封存的）來源家戶
      await tx.worshipRecord.update({ where: { id: w.id }, data: { householdId: targetId } });
    }

    // 4) 套用欄位衝突的解決方式到目標家戶
    const data: Prisma.HouseholdUpdateInput = {};
    for (const field of MERGEABLE_FIELDS) {
      const resolution = fieldResolution?.[field];
      if (!resolution) continue;
      if (resolution.use === "source") (data as Record<string, unknown>)[field] = source[field];
      else if (resolution.use === "custom") (data as Record<string, unknown>)[field] = resolution.value ?? null;
      // use === "target"：維持目標家戶原值，不需要寫入
    }
    const updatedTarget =
      Object.keys(data).length > 0
        ? await tx.household.update({ where: { id: targetId }, data })
        : target;

    // 4b) V12.3 指令三.4：合併後的主要聯絡人。
    let finalContactName: string | null = null;
    if (keepPrimaryContactMemberId) {
      finalContactName = await setPrimaryContact(tx, targetId, keepPrimaryContactMemberId);
    } else if (targetContact.memberId) {
      // 目標戶原本就有，維持不變，只校正 contactName 文字一致。
      finalContactName = await setPrimaryContact(tx, targetId, targetContact.memberId);
    } else if (sourceContact.memberId) {
      // 只有來源戶有主要聯絡人，該成員已搬進目標戶，直接沿用。
      finalContactName = await setPrimaryContact(tx, targetId, sourceContact.memberId);
    }

    // 5) 來源家戶封存（沿用既有 deletedAt／deletedByName 軟刪除欄位，會
    //    自動出現在既有回收區畫面，可用既有還原功能復原），並記錄它被併入
    //    哪一戶（V12.3 指令一.B：純家戶層級歷史不改寫 householdId，改用
    //    mergedInto 關聯讓目標戶的歷史頁一併查得到）。
    const archivedSource = await tx.household.update({
      where: { id: sourceId },
      data: {
        deletedAt: new Date(),
        deletedByName: operatorName,
        mergedIntoHouseholdId: targetId,
        mergedAt: new Date(),
      },
    });

    // 5b) V12.3 指令二：來源戶的編號從此成為歷史識別碼，登記別名指向目標戶，
    //     Excel 再匯入來源戶舊編號時才會命中合併後的正式家戶，不會另開新戶。
    await tx.householdCodeAlias.create({
      data: {
        oldCode: sourceId,
        householdId: targetId,
        reason: `家戶合併：${sourceId} 併入 ${targetId}`,
        operatorUserId,
        operatorName,
      },
    });

    // 5c) 來源戶自己原有的歷史別名，也要一併改指向目標戶，避免斷鏈。
    await tx.householdCodeAlias.updateMany({
      where: { householdId: sourceId },
      data: { householdId: targetId },
    });

    await recordVersion(
      {
        entityType: "Household",
        entityId: targetId,
        action: "UPDATE",
        beforeData: target,
        afterData: updatedTarget,
        operatorName,
        changeNote:
          `家戶管理中心：合併家戶——併入來源家戶 ${sourceId}（${source.name}），移入 ${source.members.length} 位成員` +
          `｜同步關聯紀錄：${describeSyncCounts(syncCounts)}` +
          `｜主要聯絡人：${finalContactName ?? "（未指定）"}` +
          `｜移入成員：${source.members.map((m) => `${m.name}(${m.id})`).join("、") || "無"}` +
          `｜操作人 userId=${operatorUserId ?? "（未記錄）"}` +
          `｜來源戶的家戶層級歷史（祭祀/活動等）維持原家戶，於目標戶歷史頁合併顯示`,
      },
      tx
    );
    await recordVersion(
      {
        entityType: "Household",
        entityId: sourceId,
        action: "DELETE",
        beforeData: source,
        afterData: archivedSource,
        operatorName,
        changeNote:
          `家戶管理中心：家戶合併——本戶已合併至目標家戶 ${targetId}（${target.name}），資料已封存（可從回收區還原）` +
          `｜舊編號 ${sourceId} 已登記為目標戶的歷史別名` +
          `｜操作人 userId=${operatorUserId ?? "（未記錄）"}`,
      },
      tx
    );

    return { target: updatedTarget, source: archivedSource, syncCounts, finalContactName };
  });

  return result;
}

export const MERGE_FIELD_LABEL: Record<MergeableField, string> = {
  name: "戶名",
  contactName: "主要聯絡人",
  address: "地址",
  phone: "電話",
  mobile: "手機",
  notes: "備註",
};

// ============================================================
// 家戶拆分（對應指令「十二、家戶拆分」）
// ============================================================

export type WorshipHandling = "KEEP" | "MOVE" | "COPY";

export type HouseholdSplitPreview = {
  original: { id: string; name: string; headMemberId: string | null; headName: string | null };
  membersToMove: { id: string; name: string; role: string }[];
  remainingMembers: { id: string; name: string; role: string }[];
  originalHeadWillMove: boolean;
  willBecomeEmpty: boolean;
  ancestors: { id: string; displayName: string }[];
  individuals: { id: string; displayName: string }[];
  /** V12.3 指令五／六：會跟著移出成員同步 householdId 的紀錄筆數。 */
  syncCounts: HouseholdReferenceSyncCounts;
  /** V12.3 指令六：系統建議的新家戶編號（沿用既有自動編號服務）。 */
  suggestedNewCode: string;
  /** V12.3 指令三.3：原戶主要聯絡人是否會被移出，需要指定新的。 */
  primaryContact: {
    current: { memberId: string | null; name: string | null };
    willMove: boolean;
    needsChoice: boolean;
  };
  /** V12.3 指令一.B：不會跟著搬走、留在原家戶的家戶層級歷史筆數。 */
  householdLevelHistoryStays: { activities: number; ritualRecords: number };
};

export async function previewHouseholdSplit(
  householdId: string,
  memberIdsToMove: string[]
): Promise<HouseholdSplitPreview> {
  const household = await loadHouseholdForMerge(householdId);
  if (memberIdsToMove.length === 0) throw new HouseholdManagementError("請至少選擇一位成員移出");
  const moveSet = new Set(memberIdsToMove);
  const invalid = memberIdsToMove.filter((id) => !household.members.some((m) => m.id === id));
  if (invalid.length > 0) throw new HouseholdManagementError("選擇的成員不屬於這個家戶");

  const head = household.members.find((m) => m.role === "HOUSEHOLD_HEAD");
  const membersToMove = household.members.filter((m) => moveSet.has(m.id));
  const remainingMembers = household.members.filter((m) => !moveSet.has(m.id));

  // V12.3：新家戶編號建議值、六表同步筆數、主要聯絡人與留在原戶的家戶層級歷史。
  const suggestedNewCode = await findNextAutoHouseholdCode();
  const syncCounts = await countMemberHouseholdReferences(prisma, memberIdsToMove, suggestedNewCode);
  const currentContact = await describePrimaryContact(prisma, householdId);
  const contactWillMove = Boolean(currentContact.memberId && moveSet.has(currentContact.memberId));
  const [staysActivities, staysRituals] = await Promise.all([
    prisma.activity.count({ where: { householdId } }),
    prisma.ritualRecord.count({ where: { householdId } }),
  ]);

  return {
    original: { id: household.id, name: household.name, headMemberId: head?.id ?? null, headName: head?.name ?? null },
    syncCounts,
    suggestedNewCode,
    primaryContact: {
      current: currentContact,
      willMove: contactWillMove,
      // 原戶還有人、且主要聯絡人被移出 → 必須選新的（或明確選擇暫不指定）
      needsChoice: contactWillMove && remainingMembers.length > 0,
    },
    householdLevelHistoryStays: { activities: staysActivities, ritualRecords: staysRituals },
    membersToMove: membersToMove.map((m) => ({ id: m.id, name: m.name, role: m.role })),
    remainingMembers: remainingMembers.map((m) => ({ id: m.id, name: m.name, role: m.role })),
    originalHeadWillMove: !!head && moveSet.has(head.id),
    willBecomeEmpty: remainingMembers.length === 0,
    ancestors: household.worshipRecords
      .filter((w) => w.type === "ANCESTOR_LINE")
      .map((w) => ({ id: w.id, displayName: w.displayName })),
    individuals: household.worshipRecords
      .filter((w) => w.type === "INDIVIDUAL")
      .map((w) => ({ id: w.id, displayName: w.displayName })),
  };
}

export async function splitHousehold(params: {
  householdId: string;
  memberIdsToMove: string[];
  newHousehold: HouseholdBasicInput; // 必須含 id（新家戶編號）
  newHeadMemberId?: string | null; // 必須屬於被移出的成員
  originalNewHeadMemberId?: string | null; // 若原戶長被移出，指定原家戶新戶長（必須屬於留下的成員）
  ancestorHandling: Record<string, WorshipHandling>; // worshipRecordId → 處理方式（僅歷代祖先/乙位正魂需要）
  /** V12.3 指令三.3：原戶的主要聯絡人被移出時，原戶要指定的新主要聯絡人（null＝明確選擇暫不指定）。 */
  originalNewPrimaryContactMemberId?: string | null;
  /** V12.3：新家戶的主要聯絡人（必須是被移出的成員）。 */
  newPrimaryContactMemberId?: string | null;
  operatorName: string | null;
  operatorUserId?: string | null;
}) {
  const {
    householdId,
    memberIdsToMove,
    newHousehold,
    newHeadMemberId,
    originalNewHeadMemberId,
    ancestorHandling,
    originalNewPrimaryContactMemberId,
    newPrimaryContactMemberId,
    operatorName,
    operatorUserId,
  } = params;

  // V12.3 指令二：已合併的家戶不可再被拆分。
  await assertHouseholdNotMerged(householdId);

  const household = await loadHouseholdForMerge(householdId);
  if (memberIdsToMove.length === 0) throw new HouseholdManagementError("請至少選擇一位成員移出");
  const moveSet = new Set(memberIdsToMove);
  const movingMembers = household.members.filter((m) => moveSet.has(m.id));
  if (movingMembers.length !== memberIdsToMove.length) {
    throw new HouseholdManagementError("選擇的成員不屬於這個家戶");
  }
  const remainingMembers = household.members.filter((m) => !moveSet.has(m.id));

  const normalizedNew = normalizeHouseholdBasicInput(newHousehold);
  // V12.3 指令六：新家戶編號預設使用既有的自動編號服務；使用者仍可手動輸入，
  // 手動輸入時一樣要通過 validateHouseholdCode()（會同時檢查 Household.id 與
  // HouseholdCodeAlias.oldCode，曾使用過的編號不可回收）。
  if (!normalizedNew.id) {
    normalizedNew.id = await findNextAutoHouseholdCode();
  }
  const codeError = await validateHouseholdCode(normalizedNew.id);
  if (codeError) throw new HouseholdManagementError(codeError);

  if (newPrimaryContactMemberId && !moveSet.has(newPrimaryContactMemberId)) {
    throw new HouseholdManagementError("新家戶的主要聯絡人必須是被移出的成員");
  }
  if (
    originalNewPrimaryContactMemberId &&
    !remainingMembers.some((m) => m.id === originalNewPrimaryContactMemberId)
  ) {
    throw new HouseholdManagementError("原家戶的新主要聯絡人必須是留在原戶的成員");
  }

  if (newHeadMemberId && !moveSet.has(newHeadMemberId)) {
    throw new HouseholdManagementError("新家戶戶長必須是被移出的成員");
  }

  const originalHead = household.members.find((m) => m.role === "HOUSEHOLD_HEAD");
  const originalHeadMoving = !!originalHead && moveSet.has(originalHead.id);
  if (originalHeadMoving && remainingMembers.length > 0) {
    if (!originalNewHeadMemberId || !remainingMembers.some((m) => m.id === originalNewHeadMemberId)) {
      throw new HouseholdManagementError("原戶長已被移出，請先指定原家戶的新戶長");
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.household.create({
      data: {
        id: normalizedNew.id!,
        name: normalizedNew.name ?? household.name,
        contactName: normalizedNew.contactName ?? null,
        address: normalizedNew.address ?? household.address,
        phone: normalizedNew.phone ?? null,
        mobile: normalizedNew.mobile ?? null,
        notes: normalizedNew.notes ?? null,
      },
    });

    await tx.member.updateMany({ where: { id: { in: memberIdsToMove } }, data: { householdId: created.id } });

    // V12.3 指令一.A：六張去正規化表的 householdId 跟著成員一起搬到新家戶，
    // 同一個 transaction，失敗一起 rollback。
    const syncCounts = await syncMemberHouseholdReferences(tx, memberIdsToMove, created.id);

    // V12.3 指令三：先清掉被移出成員身上的主要聯絡人旗標，再各自指定。
    await clearIncomingPrimaryContactFlags(tx, memberIdsToMove);
    if (newPrimaryContactMemberId) {
      await setPrimaryContact(tx, created.id, newPrimaryContactMemberId);
    }
    // 原家戶：若主要聯絡人被移出，依使用者在 preview 的選擇處理，
    // 不留下孤兒 contactName（指令三.3）。
    const originalContactResult = await resolvePrimaryContactAfterRemoval(
      tx,
      household.id,
      memberIdsToMove,
      originalNewPrimaryContactMemberId
    );

    if (newHeadMemberId) {
      await tx.member.update({ where: { id: newHeadMemberId }, data: { role: "HOUSEHOLD_HEAD" } });
    }
    if (originalHeadMoving && originalNewHeadMemberId) {
      await tx.member.update({ where: { id: originalNewHeadMemberId }, data: { role: "HOUSEHOLD_HEAD" } });
    }

    // 歷代祖先／乙位正魂：依使用者選擇的方式處理（保留在原家戶／移至新家戶／複製到兩戶）。
    for (const w of household.worshipRecords) {
      const handling = ancestorHandling[w.id] ?? "KEEP";
      if (handling === "MOVE") {
        await tx.worshipRecord.update({ where: { id: w.id }, data: { householdId: created.id } });
      } else if (handling === "COPY") {
        await tx.worshipRecord.create({
          data: {
            householdId: created.id,
            type: w.type,
            displayName: w.displayName,
            location: w.location,
            yangshangName: w.yangshangName,
            notes: w.notes,
          },
        });
      }
      // "KEEP"：不動，留在原家戶
    }

    await recordVersion(
      {
        entityType: "Household",
        entityId: created.id,
        action: "CREATE",
        afterData: created,
        operatorName,
        changeNote:
          `家戶管理中心：從家戶 ${household.id}（${household.name}）拆分建立，移入 ${movingMembers.length} 位成員` +
          `｜同步關聯紀錄：${describeSyncCounts(syncCounts)}` +
          `｜移入成員：${movingMembers.map((m) => `${m.name}(${m.id})`).join("、")}` +
          `｜操作人 userId=${operatorUserId ?? "（未記錄）"}`,
      },
      tx
    );
    await recordVersion(
      {
        entityType: "Household",
        entityId: household.id,
        action: "UPDATE",
        beforeData: household,
        afterData: await tx.household.findUniqueOrThrow({ where: { id: household.id } }),
        operatorName,
        changeNote:
          `家戶管理中心：家戶拆分——${movingMembers.length} 位成員移出至新家戶 ${created.id}（${created.name}）${
            remainingMembers.length === 0 ? "，原家戶已無成員（空家戶）" : ""
          }` +
          `｜同步關聯紀錄：${describeSyncCounts(syncCounts)}` +
          `｜原戶主要聯絡人：${originalContactResult.changed ? `已調整為 ${originalContactResult.newContactName ?? "（暫不指定）"}` : "未變更"}` +
          `｜操作人 userId=${operatorUserId ?? "（未記錄）"}`,
      },
      tx
    );

    return {
      newHousehold: created,
      originalHouseholdId: household.id,
      becameEmpty: remainingMembers.length === 0,
      syncCounts,
    };
  });

  return result;
}

// ============================================================
// 成員轉移（對應指令「十三、成員轉移」）
// ============================================================

export type MemberTransferPreview = {
  members: { id: string; name: string; role: string; sourceHouseholdId: string; sourceHouseholdName: string }[];
  targetHousehold: { id: string; name: string };
  affectsSourceHead: boolean;
  affectsSourcePrimaryContact: boolean;
  suspectedDuplicatesAtTarget: DuplicateMatch[];
  sourceHouseholdsWillBecomeEmpty: string[];
  /** V12.3 指令五：會跟著成員同步 householdId 的紀錄筆數。 */
  syncCounts: HouseholdReferenceSyncCounts;
  /**
   * V12.3 指令三.3：每個來源家戶的主要聯絡人狀況。
   * needsChoice = true 代表該戶的主要聯絡人會被轉走、且原戶還有其他成員，
   * 必須在畫面上選一位新的（或明確選擇暫不指定）。
   */
  primaryContactBySource: {
    householdId: string;
    householdName: string;
    current: { memberId: string | null; name: string | null };
    willMove: boolean;
    needsChoice: boolean;
    candidates: { id: string; name: string }[];
  }[];
  /** V12.3 指令一.B：留在原家戶、不會跟著轉移的家戶層級歷史筆數。 */
  householdLevelHistoryStays: { householdId: string; activities: number; ritualRecords: number }[];
};

export async function previewMemberTransfer(memberIds: string[], targetHouseholdId: string): Promise<MemberTransferPreview> {
  if (memberIds.length === 0) throw new HouseholdManagementError("請至少選擇一位成員");
  const target = await requireActiveHousehold(targetHouseholdId);

  const members = await prisma.member.findMany({
    where: { id: { in: memberIds }, deletedAt: null },
    include: { household: true },
  });
  if (members.length !== memberIds.length) throw new HouseholdManagementError("找不到部分選擇的成員");
  if (members.some((m) => m.householdId === targetHouseholdId)) {
    throw new HouseholdManagementError("不可轉移至目前同一戶");
  }

  const affectsSourceHead = members.some((m) => m.role === "HOUSEHOLD_HEAD");
  const affectsSourcePrimaryContact = members.some((m) => m.isPrimaryContact);

  const sourceHouseholdIds = Array.from(new Set(members.map((m) => m.householdId)));
  const sourceHouseholdsWillBecomeEmpty: string[] = [];
  for (const hid of sourceHouseholdIds) {
    const remaining = await prisma.member.count({
      where: { householdId: hid, deletedAt: null, id: { notIn: memberIds } },
    });
    if (remaining === 0) sourceHouseholdsWillBecomeEmpty.push(hid);
  }

  const suspectedDuplicatesAtTarget = await findSuspectedDuplicatesAcross({
    memberIds: [...memberIds],
    householdIds: [targetHouseholdId],
  });

  // V12.3：六表同步筆數。
  const syncCounts = await countMemberHouseholdReferences(prisma, memberIds, targetHouseholdId);

  // V12.3 指令三.3：逐一來源家戶檢查主要聯絡人，並附上可選的候選人（留下的成員）。
  const primaryContactBySource: MemberTransferPreview["primaryContactBySource"] = [];
  const householdLevelHistoryStays: MemberTransferPreview["householdLevelHistoryStays"] = [];
  for (const hid of sourceHouseholdIds) {
    const current = await describePrimaryContact(prisma, hid);
    const willMove = Boolean(current.memberId && memberIds.includes(current.memberId));
    const candidates = await prisma.member.findMany({
      where: { householdId: hid, deletedAt: null, id: { notIn: memberIds } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    primaryContactBySource.push({
      householdId: hid,
      householdName: members.find((m) => m.householdId === hid)?.household.name ?? hid,
      current,
      willMove,
      needsChoice: willMove && candidates.length > 0,
      candidates,
    });

    const [acts, rits] = await Promise.all([
      prisma.activity.count({ where: { householdId: hid } }),
      prisma.ritualRecord.count({ where: { householdId: hid } }),
    ]);
    householdLevelHistoryStays.push({ householdId: hid, activities: acts, ritualRecords: rits });
  }

  return {
    syncCounts,
    primaryContactBySource,
    householdLevelHistoryStays,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      sourceHouseholdId: m.householdId,
      sourceHouseholdName: m.household.name,
    })),
    targetHousehold: { id: target.id, name: target.name },
    affectsSourceHead,
    affectsSourcePrimaryContact,
    suspectedDuplicatesAtTarget,
    sourceHouseholdsWillBecomeEmpty,
  };
}

export async function transferHouseholdMembers(params: {
  memberIds: string[];
  targetHouseholdId: string;
  newHeadsForSourceHouseholds?: Record<string, string>; // sourceHouseholdId → 新戶長 memberId
  /** V12.3 指令三.3：sourceHouseholdId → 該戶的新主要聯絡人 memberId（沒給＝明確選擇暫不指定）。 */
  newPrimaryContactsForSourceHouseholds?: Record<string, string>;
  operatorName: string | null;
  operatorUserId?: string | null;
}) {
  const {
    memberIds,
    targetHouseholdId,
    newHeadsForSourceHouseholds,
    newPrimaryContactsForSourceHouseholds,
    operatorName,
    operatorUserId,
  } = params;
  if (memberIds.length === 0) throw new HouseholdManagementError("請至少選擇一位成員");

  // V12.3 指令二：不可轉移到已被合併掉的家戶。
  await assertHouseholdNotMerged(targetHouseholdId);

  const target = await requireActiveHousehold(targetHouseholdId);
  const members = await prisma.member.findMany({ where: { id: { in: memberIds }, deletedAt: null } });
  if (members.length !== memberIds.length) throw new HouseholdManagementError("找不到部分選擇的成員");
  if (members.some((m) => m.householdId === targetHouseholdId)) {
    throw new HouseholdManagementError("不可轉移至目前同一戶");
  }

  // 轉移戶長前，必須先替來源家戶指定新戶長（除非該戶因此變成空家戶）。
  const bySource = new Map<string, typeof members>();
  for (const m of members) {
    const list = bySource.get(m.householdId) ?? [];
    list.push(m);
    bySource.set(m.householdId, list);
  }
  for (const [sourceId, list] of bySource) {
    const movingHead = list.find((m) => m.role === "HOUSEHOLD_HEAD");
    if (!movingHead) continue;
    const remainingCount = await prisma.member.count({
      where: { householdId: sourceId, deletedAt: null, id: { notIn: memberIds } },
    });
    if (remainingCount > 0) {
      const newHeadId = newHeadsForSourceHouseholds?.[sourceId];
      if (!newHeadId) {
        throw new HouseholdManagementError(`家戶 ${sourceId} 的戶長即將被轉移，請先指定該戶新戶長`);
      }
      const belongs = await prisma.member.findFirst({
        where: { id: newHeadId, householdId: sourceId, deletedAt: null, NOT: { id: { in: memberIds } } },
      });
      if (!belongs) throw new HouseholdManagementError(`指定的新戶長不屬於家戶 ${sourceId} 留下的成員`);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    for (const [sourceId, list] of bySource) {
      const movingHead = list.find((m) => m.role === "HOUSEHOLD_HEAD");
      if (!movingHead) continue;
      const newHeadId = newHeadsForSourceHouseholds?.[sourceId];
      if (newHeadId) {
        await tx.member.update({ where: { id: newHeadId }, data: { role: "HOUSEHOLD_HEAD" } });
      }
    }

    await tx.member.updateMany({ where: { id: { in: memberIds } }, data: { householdId: targetHouseholdId } });

    // V12.3 指令一.A：六張去正規化表同步，與成員搬動同一個 transaction。
    const syncCounts = await syncMemberHouseholdReferences(tx, memberIds, targetHouseholdId);

    // V12.3 指令三：清掉被轉移成員身上的舊主要聯絡人旗標，
    // 再逐一處理每個來源家戶的主要聯絡人（不留孤兒 contactName）。
    await clearIncomingPrimaryContactFlags(tx, memberIds);
    const contactChanges: string[] = [];
    for (const [sourceId] of bySource) {
      const r = await resolvePrimaryContactAfterRemoval(
        tx,
        sourceId,
        memberIds,
        newPrimaryContactsForSourceHouseholds?.[sourceId]
      );
      if (r.changed) {
        contactChanges.push(`${sourceId}→${r.newContactName ?? "（暫不指定）"}`);
      }
    }

    for (const m of members) {
      const after = await tx.member.findUniqueOrThrow({ where: { id: m.id } });
      await recordVersion(
        {
          entityType: "Member",
          entityId: m.id,
          action: "UPDATE",
          beforeData: m,
          afterData: after,
          operatorName,
          changeNote:
            `家戶管理中心：成員轉移，由家戶 ${m.householdId} 轉移至家戶 ${targetHouseholdId}（${target.name}）` +
            `｜同步關聯紀錄：${describeSyncCounts(syncCounts)}` +
            `｜原戶主要聯絡人調整：${contactChanges.join("、") || "無"}` +
            `｜操作人 userId=${operatorUserId ?? "（未記錄）"}`,
        },
        tx
      );
    }

    return { movedCount: members.length, targetHouseholdId, syncCounts };
  });

  return result;
}

// ============================================================
// 空家戶封存（對應指令「十四、空家戶處理」「十一、來源家戶完成合併後」）
// ============================================================

/**
 * 封存家戶。沿用既有 deletedAt／deletedByName 軟刪除欄位（會出現在既有
 * 回收區畫面，可用既有還原功能復原），不新增 isArchived 等欄位。
 * 只允許封存「目前沒有在職成員」的家戶——避免有人被封存的家戶「隱形」
 * 遺漏在畫面外（對應指令「十四」空家戶處理的精神：封存是給空家戶用的）。
 */
export async function archiveHousehold(householdId: string, reason: string | null, operatorName: string | null) {
  const household = await requireActiveHousehold(householdId);
  const activeMemberCount = await prisma.member.count({ where: { householdId, deletedAt: null } });
  if (activeMemberCount > 0) {
    throw new HouseholdManagementError("這個家戶目前還有成員，請先將成員轉移或拆分後才能封存");
  }

  const archived = await prisma.$transaction(async (tx) => {
    const updated = await tx.household.update({
      where: { id: householdId },
      data: { deletedAt: new Date(), deletedByName: operatorName },
    });
    await recordVersion(
      {
        entityType: "Household",
        entityId: householdId,
        action: "DELETE",
        beforeData: household,
        afterData: updated,
        operatorName,
        changeNote: reason ? `家戶管理中心：封存空家戶（原因：${reason}）` : "家戶管理中心：封存空家戶",
      },
      tx
    );
    return updated;
  });

  return { household: archived };
}

// ============================================================
// API 共用錯誤處理（對應指令「十六、11/12」：回傳可讀的中文錯誤訊息，
// 不得把 Prisma 原始錯誤完整暴露給前端）
// ============================================================

export function toHouseholdApiError(e: unknown): { status: number; error: string } {
  if (e instanceof HouseholdManagementError) {
    return { status: e.status, error: e.message };
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return { status: 400, error: "家戶編號已被其他家戶使用" };
    if (e.code === "P2025") return { status: 404, error: "找不到指定的資料，可能已被其他人異動" };
    return { status: 400, error: "資料庫操作失敗，請確認輸入內容後再試一次" };
  }
  return { status: 500, error: "系統發生未預期的錯誤，請稍後再試一次" };
}
