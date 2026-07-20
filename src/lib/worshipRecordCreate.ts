/**
 * V13.1 指令六／七／十四：歷代祖先與乙位正魂的建立、重複檢查、陽上人快速帶入。
 *
 * 沿用既有的 **WorshipRecord** 資料表（type = ANCESTOR_LINE / INDIVIDUAL），
 * 沒有新建任何牌位資料表——指令明令「不得建立第二套相同功能」。
 *
 * 既有欄位的用途在 V13.1 正名：
 *   location      → 牌位地址（原 UI 標示「安奉位置」）
 *   yangshangName → 陽上人（自由文字，可多位，以「、」分隔）
 *   memberId      → 由信眾轉建時的原信眾關聯
 *   createdByName → 建立人（V13.1 新增）
 *   createdAt     → 建立日期（既有）
 */

import { prisma } from "@/lib/prisma";
import type { Prisma, WorshipType } from "@prisma/client";
import { normalizeYangshangName, detectKinshipTerms } from "@/lib/printChinese";

// ────────────────────────────────────────────────────────────
// 陽上人快速帶入（指令六）
// ────────────────────────────────────────────────────────────

export type YangshangSuggestion = {
  /** 建議的姓名 */
  name: string;
  /** 這個建議是從哪裡來的，畫面上顯示給使用者看 */
  source: "戶長" | "主要聯絡人" | "家戶成員" | "最近使用" | "常用";
  /** 額外說明，例如成員的身份 */
  hint?: string;
};

/**
 * 取得某家戶可用的陽上人快速帶入選項。
 *
 * ⚠️ 這些**只是快捷功能**（指令六）。使用者帶入後可以自由刪除、增加、
 * 修改姓名；陽上人不必是既有信眾、不必是家戶成員，這個清單不構成任何限制。
 * 前端絕不可以把輸入框做成「只能從這個清單挑選」的下拉選單。
 */
export async function getYangshangSuggestions(
  householdId: string
): Promise<YangshangSuggestion[]> {
  const suggestions: YangshangSuggestion[] = [];
  const seen = new Set<string>();

  const push = (name: string | null | undefined, source: YangshangSuggestion["source"], hint?: string) => {
    const trimmed = (name ?? "").trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    suggestions.push({ name: trimmed, source, hint });
  };

  const household = await prisma.household.findUnique({
    where: { id: householdId },
    include: {
      members: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!household) return [];

  // 1. 戶長
  const head = household.members.find((m) => m.role === "HOUSEHOLD_HEAD");
  if (head) push(head.name, "戶長");

  // 2. 主要聯絡人（可能是成員，也可能只是 Household.contactName 的自由文字）
  const primary = household.members.find((m) => m.isPrimaryContact);
  if (primary) push(primary.name, "主要聯絡人");
  push(household.contactName, "主要聯絡人");

  // 3. 其他家戶成員（排除已辭世者——請已故者當陽上人並不合適）
  for (const m of household.members) {
    if (m.isDeceased) continue;
    push(m.name, "家戶成員", m.role);
  }

  // 4. 最近使用過的陽上人（本戶既有牌位上填過的）
  const recent = await prisma.worshipRecord.findMany({
    where: { householdId, yangshangName: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { yangshangName: true },
  });
  for (const r of recent) {
    // 一筆可能有多位，逐一拆開
    for (const n of (r.yangshangName ?? "").split("、")) {
      push(n, "最近使用");
    }
  }

  return suggestions;
}

// ────────────────────────────────────────────────────────────
// 重複檢查（指令十四）
// ────────────────────────────────────────────────────────────

export type WorshipDuplicate = {
  id: string;
  type: WorshipType;
  displayName: string;
  location: string | null;
  yangshangName: string | null;
  createdAt: Date;
  /** 為什麼判定為疑似重複 */
  reason: string;
};

/**
 * 建立前的重複檢查（指令五、七、十四）。
 *
 * 判定範圍刻意限縮在**同一家戶內**——不同家戶本來就可能有同名的歷代祖先
 * （「陳姓歷代祖先」全台一堆），跨戶比對只會製造大量假警報。
 *
 * 回傳結果**不阻擋建立**，只是提示；由使用者決定要不要繼續
 * （指令十四：「不確定比對必須讓使用者人工確認」）。
 */
export async function findWorshipDuplicates(params: {
  householdId: string;
  type: WorshipType;
  displayName: string;
  /** 由信眾轉建時的原信眾 id */
  memberId?: string | null;
}): Promise<WorshipDuplicate[]> {
  const name = params.displayName.trim();
  const existing = await prisma.worshipRecord.findMany({
    where: { householdId: params.householdId, type: params.type },
    orderBy: { createdAt: "desc" },
  });

  const out: WorshipDuplicate[] = [];
  for (const r of existing) {
    let reason = "";
    if (params.memberId && r.memberId === params.memberId) {
      reason = "這位信眾已經建立過牌位";
    } else if (r.displayName.trim() === name) {
      reason = "同一家戶已有相同名稱的牌位";
    } else if (
      name &&
      (r.displayName.includes(name) || name.includes(r.displayName.trim()))
    ) {
      reason = "同一家戶已有名稱相近的牌位";
    }
    if (reason) {
      out.push({
        id: r.id,
        type: r.type,
        displayName: r.displayName,
        location: r.location,
        yangshangName: r.yangshangName,
        createdAt: r.createdAt,
        reason,
      });
    }
  }
  return out;
}

/**
 * 專用於「信眾辭世後建立乙位正魂」的檢查（指令五）。
 *
 * 指令五要求：若已存在乙位正魂，顯示「此信眾已有乙位正魂資料」並提供
 * 「查看既有資料」，**不得重複新增**。所以這支是唯一一個會回傳
 * 「硬性阻擋」語意的檢查。
 */
export async function findExistingSoulTablet(memberId: string) {
  return prisma.worshipRecord.findFirst({
    where: { memberId, type: "INDIVIDUAL" },
    orderBy: { createdAt: "asc" },
  });
}

// ────────────────────────────────────────────────────────────
// 建立
// ────────────────────────────────────────────────────────────

export type CreateWorshipRecordInput = {
  householdId: string;
  type: WorshipType;
  displayName: string;
  /** 牌位地址。可留空 → 視為「待補資料」，不阻擋建立 */
  location?: string | null;
  /** 陽上人。自由文字，可多位 */
  yangshangName?: string | null;
  /** 由信眾轉建時的原信眾關聯 */
  memberId?: string | null;
  notes?: string | null;
  /** 建立人 */
  operatorName: string;
};

export type WorshipValidation = {
  ok: boolean;
  errors: string[];
  /** 不阻擋建立，但要提醒使用者的事項（例如牌位地址待補） */
  warnings: string[];
  normalized: {
    displayName: string;
    location: string | null;
    yangshangName: string | null;
    notes: string | null;
  };
};

/**
 * 驗證＋正規化牌位輸入。
 *
 * 牌位地址留空**不是錯誤**（V13.1 確認的規則）：建議填寫，不知道可留空，
 * 儲存後標示為「待補資料」，由資料完整度提醒。既有 location 為 null 的
 * 舊牌位因此仍可正常編輯，不會被卡住。
 */
export function validateWorshipRecordInput(
  input: CreateWorshipRecordInput
): WorshipValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const displayName = (input.displayName ?? "").trim();
  if (!displayName) {
    errors.push(input.type === "ANCESTOR_LINE" ? "請輸入歷代祖先名稱" : "請輸入亡者姓名");
  }

  const location = (input.location ?? "").trim() || null;
  if (!location) {
    warnings.push("牌位地址尚未填寫，將標示為「待補資料」，之後可於牌位資料補上");
  }

  const yangshangName = normalizeYangshangName(input.yangshangName);
  if (!yangshangName) {
    warnings.push("陽上人尚未填寫，將標示為「待補資料」");
  } else {
    // 指令六：不得含關係稱謂。這是提示不是阻擋——理論上可能有人姓名
    // 剛好包含這些字，系統不替使用者決定。
    const found = detectKinshipTerms(yangshangName);
    if (found.length > 0) {
      warnings.push(
        `陽上人欄位包含「${found.join("、")}」。陽上人只需要填姓名，` +
          `稱謂與「叩薦」由系統在列印時自動處理，不需要輸入`
      );
    }
  }

  const notes = (input.notes ?? "").trim() || null;

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    normalized: { displayName, location, yangshangName, notes },
  };
}

/**
 * 建立牌位（在既有交易內）。
 *
 * 抽成吃 tx 的版本，是為了讓「辭世 → 建立乙位正魂 → 加入中元普渡」
 * 這一串可以放在同一個 transaction，避免只完成一半。
 */
export async function createWorshipRecordInTransaction(
  tx: Prisma.TransactionClient,
  input: CreateWorshipRecordInput
) {
  const validation = validateWorshipRecordInput(input);
  if (!validation.ok) {
    throw new Error(validation.errors.join("；"));
  }
  const n = validation.normalized;

  return tx.worshipRecord.create({
    data: {
      householdId: input.householdId,
      type: input.type,
      displayName: n.displayName,
      location: n.location,
      yangshangName: n.yangshangName,
      memberId: input.memberId ?? null,
      notes: n.notes,
      createdByName: input.operatorName,
    },
  });
}

// ────────────────────────────────────────────────────────────
// 資料完整度（指令七：牌位地址待補提醒）
// ────────────────────────────────────────────────────────────

export type WorshipCompleteness = {
  /** 待補項目 */
  missing: string[];
  /** 是否完整 */
  isComplete: boolean;
};

/**
 * 牌位資料完整度。牌位地址與陽上人皆為「建議填寫」，缺少時列入待補清單，
 * 由畫面提醒 —— 但**不阻擋任何操作**。
 */
export function evaluateWorshipCompleteness(record: {
  location: string | null;
  yangshangName: string | null;
}): WorshipCompleteness {
  const missing: string[] = [];
  if (!record.location || !record.location.trim()) missing.push("牌位地址");
  if (!record.yangshangName || !record.yangshangName.trim()) missing.push("陽上人");
  return { missing, isComplete: missing.length === 0 };
}
