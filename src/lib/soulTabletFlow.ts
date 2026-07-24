/**
 * V13.1 指令五／九：辭世 → 建立乙位正魂 → 加入中元普渡 的兩段式流程。
 *
 * ── 為什麼是「兩段式」而不是一次做完 ─────────────────────────
 * 指令五、九都明確要求「不得自動建立」「不得自動加入」。所以流程是：
 *
 *   信眾儲存為已辭世
 *     → 詢問①「是否建立乙位正魂？」[建立乙位正魂][暫不處理]
 *       → 建立完成
 *         → 詢問②「是否加入中元普渡？」[確認加入][修改活動年度][暫不加入]
 *
 * 每一步都由使用者主動點擊，系統只負責準備好預覽資料。
 *
 * ── 沿用既有架構 ────────────────────────────────────────
 *   乙位正魂 → WorshipRecord (type = INDIVIDUAL)
 *   中元普渡 → RitualRecord (UNIVERSAL_SALVATION)
 *              + UniversalSalvationDetail
 *              + UniversalSalvationEntry (category = INDIVIDUAL_SOUL)
 * 全部是既有資料表，沒有新增任何牌位或普渡資料表。
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { recordVersion } from "@/lib/recordVersion";
import { ensureTabletPrintObjects } from "@/lib/additionalPrintItems";
import {
  createWorshipRecordInTransaction,
  findExistingSoulTablet,
  getYangshangSuggestions,
  validateWorshipRecordInput,
  type YangshangSuggestion,
} from "@/lib/worshipRecordCreate";
import { resolveDefaultUniversalSalvationYear, type ActivityYearDecision } from "@/lib/activityYear";

import { upsertParticipantsInTransaction } from "@/lib/ritualParticipants";
// ────────────────────────────────────────────────────────────
// 詢問① 建立乙位正魂 — 預覽資料
// ────────────────────────────────────────────────────────────

export type SoulTabletPreview = {
  /** 是否已經有乙位正魂。true 時畫面必須顯示「此信眾已有乙位正魂資料」並提供查看，不得重複新增 */
  alreadyExists: boolean;
  existingId: string | null;

  /** 以下是預填內容，使用者可在儲存前全部修改（指令十六） */
  memberId: string;
  /** 亡者姓名（預填信眾姓名） */
  displayName: string;
  householdId: string;
  householdName: string;
  /** 牌位地址預填家戶地址，但**不強制**——使用者可自由改成別的地址或留空 */
  suggestedLocation: string | null;
  /** 家戶地址原文，供「帶入家戶地址」按鈕使用 */
  householdAddress: string | null;
  /** 陽上人快速帶入選項。只是快捷，使用者可自由輸入不在清單內的姓名 */
  yangshangSuggestions: YangshangSuggestion[];
  /** 建立日期（顯示用，實際以 createdAt 為準） */
  createdAtPreview: Date;
  /** 建立人 */
  operatorName: string;
};

/**
 * 準備「建立乙位正魂」的預覽資料（指令五：建立前必須檢查重複、顯示預覽）。
 *
 * ⚠️ 這支**不會建立任何資料**，純讀取。
 */
export async function buildSoulTabletPreview(
  memberId: string,
  operatorName: string
): Promise<SoulTabletPreview | null> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: { household: true },
  });
  if (!member || member.deletedAt) return null;

  const existing = await findExistingSoulTablet(memberId);
  const suggestions = await getYangshangSuggestions(member.householdId);

  return {
    alreadyExists: existing !== null,
    existingId: existing?.id ?? null,
    memberId: member.id,
    displayName: `${member.name} 乙位正魂`,
    householdId: member.householdId,
    householdName: member.household.name,
    // 預填家戶地址是**快捷**，不是規則。指令七：不得強制使用家戶地址，
    // 也不得把牌位地址誤存為亡者生前居住地址。
    suggestedLocation: member.household.address ?? null,
    householdAddress: member.household.address ?? null,
    yangshangSuggestions: suggestions,
    createdAtPreview: new Date(),
    operatorName,
  };
}

export type CreateSoulTabletInput = {
  memberId: string;
  displayName: string;
  location: string | null;
  yangshangName: string | null;
  notes: string | null;
  operatorName: string;
};

export type CreateSoulTabletResult =
  | { ok: true; worshipRecordId: string; warnings: string[] }
  | { ok: false; error: string; existingId?: string };

/**
 * 建立乙位正魂（指令五）。
 *
 * 重複時**拒絕建立**並回傳既有 id——這是指令五唯一要求硬性阻擋的地方
 * （「若已存在乙位正魂…不得重複新增」）。其他重複檢查一律只提醒。
 */
export async function createSoulTablet(
  input: CreateSoulTabletInput
): Promise<CreateSoulTabletResult> {
  const member = await prisma.member.findUnique({
    where: { id: input.memberId },
    include: { household: true },
  });
  if (!member || member.deletedAt) {
    return { ok: false, error: "找不到這位信眾，無法建立乙位正魂" };
  }

  const existing = await findExistingSoulTablet(input.memberId);
  if (existing) {
    return {
      ok: false,
      error: "此信眾已有乙位正魂資料",
      existingId: existing.id,
    };
  }

  const validation = validateWorshipRecordInput({
    householdId: member.householdId,
    type: "INDIVIDUAL",
    displayName: input.displayName,
    location: input.location,
    yangshangName: input.yangshangName,
    memberId: input.memberId,
    notes: input.notes,
    operatorName: input.operatorName,
  });
  if (!validation.ok) {
    return { ok: false, error: validation.errors.join("；") };
  }

  const created = await prisma.$transaction(async (tx) => {
    const record = await createWorshipRecordInTransaction(tx, {
      householdId: member.householdId,
      type: "INDIVIDUAL",
      displayName: input.displayName,
      location: input.location,
      yangshangName: input.yangshangName,
      memberId: input.memberId,
      notes: input.notes,
      operatorName: input.operatorName,
    });

    await recordVersion(
      {
        entityType: "WorshipRecord",
        entityId: record.id,
        action: "CREATE",
        afterData: record,
        operatorName: input.operatorName,
        changeNote: `信眾辭世流程：由信眾「${member.name}」建立乙位正魂`,
      },
      tx
    );

    // 建立成功後就不需要再自動詢問了
    await tx.member.update({
      where: { id: input.memberId },
      data: { soulTabletPromptedAt: new Date() },
    });

    return record;
  });

  return { ok: true, worshipRecordId: created.id, warnings: validation.warnings };
}

// ────────────────────────────────────────────────────────────
// 詢問② 加入中元普渡
// ────────────────────────────────────────────────────────────

export type UniversalSalvationJoinPreview = {
  worshipRecordId: string;
  displayName: string;
  householdId: string;
  /** 年度判斷結果。ok=false 時畫面必須提示先建立活動，不得偷偷建立 */
  yearDecision: ActivityYearDecision;
  /** 確認畫面文案：「將加入民國 XXX 年中元普渡」 */
  confirmText: string;
  /** 是否已經加入過這個年度的普渡 */
  alreadyJoined: boolean;
};

/**
 * 準備「是否加入中元普渡」的預覽（指令九）。
 *
 * 年度**完全依活動資料判斷**（開放報名／是否完成／截止日），
 * 不寫死「今天是否超過農曆七月十八」。
 */
export async function buildUniversalSalvationJoinPreview(
  worshipRecordId: string,
  now: Date = new Date()
): Promise<UniversalSalvationJoinPreview | null> {
  const record = await prisma.worshipRecord.findUnique({
    where: { id: worshipRecordId },
  });
  if (!record) return null;

  const yearDecision = await resolveDefaultUniversalSalvationYear(now);

  let alreadyJoined = false;
  let confirmText: string;

  if (yearDecision.ok) {
    const year = yearDecision.candidate.year;
    const existingEntry = await prisma.universalSalvationEntry.findFirst({
      where: {
        worshipRecordId,
        deletedAt: null,
        universalSalvation: { ritualRecord: { year, deletedAt: null } },
      },
    });
    alreadyJoined = existingEntry !== null;
    confirmText = alreadyJoined
      ? `這筆牌位已經加入民國 ${year} 年中元普渡，不需要重複加入`
      : `將加入民國 ${year} 年中元普渡`;
  } else {
    confirmText = yearDecision.reason;
  }

  return {
    worshipRecordId,
    displayName: record.displayName,
    householdId: record.householdId,
    yearDecision,
    confirmText,
    alreadyJoined,
  };
}

export type JoinUniversalSalvationResult =
  | { ok: true; ritualRecordId: string; entryId: string; year: number }
  | { ok: false; error: string };

/**
 * 把一筆牌位加入指定年度的中元普渡（指令九）。
 *
 * @param year 使用者確認（或修改）後的活動年度。**由呼叫端明確傳入**，
 *             這支不自行決定年度——預設值的計算在
 *             buildUniversalSalvationJoinPreview()，使用者可以改。
 */
export async function joinUniversalSalvation(params: {
  worshipRecordId: string;
  year: number;
  operatorName: string;
}): Promise<JoinUniversalSalvationResult> {
  const record = await prisma.worshipRecord.findUnique({
    where: { id: params.worshipRecordId },
  });
  if (!record) return { ok: false, error: "找不到這筆牌位資料" };

  // 指令九：不得偷偷建立不存在的活動。年度活動必須已經存在。
  const templeEvent = await prisma.templeEvent.findUnique({
    where: { activityType_year: { activityType: "UNIVERSAL_SALVATION", year: params.year } },
  });
  if (!templeEvent) {
    return {
      ok: false,
      error: `尚未建立民國 ${params.year} 年的中元普渡活動，請先於活動中心建立此年度活動`,
    };
  }

  return prisma.$transaction(async (tx) => {
    // 沿用既有的 RitualRecord 主檔（一戶 × 一年 × 一活動類型）
    let ritual = await tx.ritualRecord.findUnique({
      where: {
        householdId_year_activityType: {
          householdId: record.householdId,
          year: params.year,
          activityType: "UNIVERSAL_SALVATION",
        },
      },
      include: { universalSalvation: true },
    });

    if (ritual && ritual.deletedAt) {
      return {
        ok: false as const,
        error: `這一戶民國 ${params.year} 年的普渡紀錄目前在回收區，請先還原後再加入`,
      };
    }

    if (!ritual) {
      ritual = await tx.ritualRecord.create({
        data: {
          householdId: record.householdId,
          year: params.year,
          activityType: "UNIVERSAL_SALVATION",
          templeEventId: templeEvent.id,
          status: "DRAFT",
          registrationSource: "DEVOTEE_PAGE",
        },
        include: { universalSalvation: true },
      });
    }

    let detail = ritual.universalSalvation;
    if (!detail) {
      detail = await tx.universalSalvationDetail.create({
        data: { ritualRecordId: ritual.id, isRegistered: true },
      });
    }

    // 避免重複加入同一筆牌位
    const existingEntry = await tx.universalSalvationEntry.findFirst({
      where: {
        universalSalvationId: detail.id,
        worshipRecordId: record.id,
        deletedAt: null,
      },
    });
    if (existingEntry) {
      return {
        ok: true as const,
        ritualRecordId: ritual.id,
        entryId: existingEntry.id,
        year: params.year,
      };
    }

    /**
     * V13.4 指令十八：辭世流程加入普渡時，也要寫入 RitualParticipant。
     * 這筆牌位若關聯回原信眾（memberId），就把那位信眾納入報名成員。
     */
    if (record.memberId) {
      await upsertParticipantsInTransaction(
        tx,
        ritual.id,
        [record.memberId],
        params.operatorName
      );
    }

    const entry = await tx.universalSalvationEntry.create({
      data: {
        universalSalvationId: detail.id,
        // 乙位正魂 → INDIVIDUAL_SOUL；歷代祖先 → ANCESTOR_LINE
        category: record.type === "ANCESTOR_LINE" ? "ANCESTOR_LINE" : "INDIVIDUAL_SOUL",
        displayName: record.displayName,
        yangshangName: record.yangshangName,
        worshipRecordId: record.id,
      },
    });

    await recordVersion(
      {
        entityType: "UniversalSalvationEntry",
        entityId: entry.id,
        action: "CREATE",
        afterData: entry,
        operatorName: params.operatorName,
        changeNote: `辭世流程：牌位「${record.displayName}」加入民國 ${params.year} 年中元普渡`,
      },
      tx
    );

    // V14.4 Part 2：辭世流程建立牌位時，一律共用 ensureTabletPrintObjects
    // 自動建立 TABLET＋預設 POCKET（同一 tx；不各自手寫）。
    await ensureTabletPrintObjects(
      {
        ritualRecordId: ritual.id,
        householdId: record.householdId,
        sourceEntryId: entry.id,
        printName: record.displayName,
        memberId: record.memberId ?? null,
        activityId: ritual.templeEventId ?? null,
      },
      tx
    );

    return {
      ok: true as const,
      ritualRecordId: ritual.id,
      entryId: entry.id,
      year: params.year,
    };
  });
}

// ────────────────────────────────────────────────────────────
// 歷代祖先（指令七）
// ────────────────────────────────────────────────────────────

/**
 * 指令七：**歷代祖先不因信眾辭世而自動建立。**
 *
 * 信眾詳情頁可以提供「加入歷代祖先」按鈕，但必須由使用者手動選擇、
 * 預覽及確認。所以這支只準備預覽資料，沒有任何自動觸發路徑——
 * 辭世流程（上面兩段）完全不會呼叫到這裡。
 */
export type AncestorLinePreview = {
  householdId: string;
  householdName: string;
  /** 預填名稱，例如「王姓歷代祖先」。使用者可改 */
  suggestedDisplayName: string;
  suggestedLocation: string | null;
  householdAddress: string | null;
  yangshangSuggestions: YangshangSuggestion[];
  /** 這一戶已有的歷代祖先牌位，供重複檢查提示 */
  existing: { id: string; displayName: string; createdAt: Date }[];
};

export async function buildAncestorLinePreview(
  householdId: string
): Promise<AncestorLinePreview | null> {
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    include: {
      members: { where: { deletedAt: null }, orderBy: { createdAt: "asc" }, take: 1 },
      worshipRecords: {
        where: { type: "ANCESTOR_LINE" },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!household) return null;

  // 由戶名或第一位成員的姓氏推出「○姓歷代祖先」。這只是**預填建議**，
  // 使用者可以完全改掉——不是規則。
  const sourceName = household.members[0]?.name ?? household.name ?? "";
  const surname = sourceName.trim().charAt(0);
  const suggestedDisplayName = surname ? `${surname}姓歷代祖先` : "";

  return {
    householdId: household.id,
    householdName: household.name,
    suggestedDisplayName,
    suggestedLocation: household.address ?? null,
    householdAddress: household.address ?? null,
    yangshangSuggestions: await getYangshangSuggestions(householdId),
    existing: household.worshipRecords.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      createdAt: r.createdAt,
    })),
  };
}

/** 建立歷代祖先（由使用者明確操作，不會被辭世流程自動呼叫）。 */
export async function createAncestorLine(input: {
  householdId: string;
  displayName: string;
  location: string | null;
  yangshangName: string | null;
  notes: string | null;
  operatorName: string;
}): Promise<{ ok: true; worshipRecordId: string; warnings: string[] } | { ok: false; error: string }> {
  const validation = validateWorshipRecordInput({
    householdId: input.householdId,
    type: "ANCESTOR_LINE",
    displayName: input.displayName,
    location: input.location,
    yangshangName: input.yangshangName,
    notes: input.notes,
    operatorName: input.operatorName,
  });
  if (!validation.ok) return { ok: false, error: validation.errors.join("；") };

  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const record = await createWorshipRecordInTransaction(tx, {
      householdId: input.householdId,
      type: "ANCESTOR_LINE",
      displayName: input.displayName,
      location: input.location,
      yangshangName: input.yangshangName,
      notes: input.notes,
      operatorName: input.operatorName,
    });
    await recordVersion(
      {
        entityType: "WorshipRecord",
        entityId: record.id,
        action: "CREATE",
        afterData: record,
        operatorName: input.operatorName,
        changeNote: "手動建立歷代祖先牌位",
      },
      tx
    );
    return record;
  });

  return { ok: true, worshipRecordId: created.id, warnings: validation.warnings };
}
