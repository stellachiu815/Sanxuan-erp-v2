import type { DbClient } from "@/lib/prisma";
import { normalizeTabletText } from "@/lib/tabletIdentity";

/**
 * V15R6.1：把普渡編輯頁新增／修改的「歷代祖先／乙位正魂」牌位，同步寫入該家戶的
 * **永久名單**（WorshipRecord）。目的：下次進家戶資料看得到、明年普渡可自動帶入、
 * 家戶主檔與活動草稿保持一致。
 *
 * ⚠️ 必須由呼叫端在**同一交易**內呼叫（傳入 tx）——活動草稿與永久名單任一失敗全部回滾。
 * 只處理祖先／正魂；其他類別（冤親／無緣）回傳 null、不動永久名單。
 *
 * 防重複（規格四，依序）：
 *   1. existingWorshipRecordId（來源 ID，最優先）
 *   2. 家戶內 type ＋ 標準化 displayName ＋ 標準化 location（地址）
 * 同名不同地址＝不同牌位，不合併；只用姓名不足以判斷。
 */

const CATEGORY_TO_WORSHIP_TYPE: Record<string, "ANCESTOR_LINE" | "INDIVIDUAL"> = {
  ANCESTOR_LINE: "ANCESTOR_LINE",
  INDIVIDUAL_SOUL: "INDIVIDUAL",
};

/** 此普渡類別是否需要／可以同步到家戶永久名單（只有祖先／正魂）。 */
export function isSyncableWorshipCategory(category: string): boolean {
  return category in CATEGORY_TO_WORSHIP_TYPE;
}

/** 陽上人陣列 → WorshipRecord.yangshangName 單一字串（「、」分隔；空則 null）。 */
function joinYangshang(names: string[] | null | undefined): string | null {
  const cleaned = (names ?? []).map((n) => (n ?? "").trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned.join("、") : null;
}

export type WorshipSyncInput = {
  householdId: string;
  category: string; // UniversalSalvationEntryCategory
  displayName: string;
  tabletAddress?: string | null;
  yangshangNames?: string[];
  /** 既有來源 ID（entry.worshipRecordId）——有值時最優先，直接更新該筆。 */
  existingWorshipRecordId?: string | null;
  operatorName?: string | null;
};

/**
 * 同步一筆祖先／正魂牌位到家戶永久名單。回傳對應的 worshipRecordId（建立或匹配到的既有）。
 * 非可同步類別或缺姓名 → 回 null（不動作）。
 */
export async function syncEntryToHouseholdWorshipRecord(
  tx: DbClient,
  input: WorshipSyncInput
): Promise<string | null> {
  const worshipType = CATEGORY_TO_WORSHIP_TYPE[input.category];
  if (!worshipType) return null;
  const name = (input.displayName ?? "").trim();
  if (!name) return null; // 缺牌位姓名不同步（避免灌入空白牌位）

  // 動態載入版本紀錄（recordVersion 於模組頂層載入 prisma；改為函式內載入，
  // 讓本模組的純函式 isSyncableWorshipCategory 可在無 DB 的單元測試中直接使用）。
  const { recordVersion } = await import("@/lib/recordVersion");

  const yangshangName = joinYangshang(input.yangshangNames);
  const location = input.tabletAddress?.trim() || null;

  // 1) 優先用來源 ID（既有連結）。
  let target =
    input.existingWorshipRecordId
      ? await tx.worshipRecord.findFirst({
          where: { id: input.existingWorshipRecordId, householdId: input.householdId, type: worshipType },
        })
      : null;

  // 2) 否則以 (type ＋ 標準化姓名 ＋ 標準化地址) 比對本戶既有牌位（同名不同址＝不同牌位）。
  if (!target) {
    const candidates = await tx.worshipRecord.findMany({
      where: { householdId: input.householdId, type: worshipType },
    });
    const key = `${normalizeTabletText(name)}::${normalizeTabletText(location)}`;
    target =
      candidates.find(
        (w) => `${normalizeTabletText(w.displayName)}::${normalizeTabletText(w.location)}` === key
      ) ?? null;
  }

  if (target) {
    const after = await tx.worshipRecord.update({
      where: { id: target.id },
      data: { displayName: name, location, yangshangName },
    });
    await recordVersion(
      { entityType: "WorshipRecord", entityId: after.id, action: "UPDATE", beforeData: target, afterData: after, operatorName: input.operatorName },
      tx
    );
    return after.id;
  }

  const created = await tx.worshipRecord.create({
    data: { householdId: input.householdId, type: worshipType, displayName: name, location, yangshangName },
  });
  await recordVersion(
    { entityType: "WorshipRecord", entityId: created.id, action: "CREATE", afterData: created, operatorName: input.operatorName },
    tx
  );
  return created.id;
}
