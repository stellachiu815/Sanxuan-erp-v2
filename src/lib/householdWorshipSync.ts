import type { DbClient } from "@/lib/prisma";
import { prisma } from "@/lib/prisma";
import { normalizeTabletText } from "@/lib/tabletIdentity";
import { normalizeRitualNameForStore } from "@/lib/ritualDisplayName";
import { resolveYangshangNames } from "@/lib/yangshang";

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
  // V33.2：同步進家戶 WorshipRecord 也只存核心名稱（去後綴、依 category 欄位）；顯示由 resolver 補後綴。
  const name = normalizeRitualNameForStore(input.category, (input.displayName ?? "").trim());
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
          // V28：只對應「有效（未封存）」永久牌位；封存的牌位不被年度同步復用/覆寫。
          where: { id: input.existingWorshipRecordId, householdId: input.householdId, type: worshipType, deletedAt: null },
        })
      : null;

  // 2) 否則以 (type ＋ 標準化姓名 ＋ 標準化地址) 比對本戶既有牌位（同名不同址＝不同牌位）。
  if (!target) {
    const candidates = await tx.worshipRecord.findMany({
      where: { householdId: input.householdId, type: worshipType, deletedAt: null },
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

/**
 * V27.1：把「家戶永久牌位（WorshipRecord）」已有、但本年度普渡草稿卻缺少的陽上人，
 * 補入該年度的祖先／正魂 entry。
 *
 * 背景：建立時的帶入（auto-draft／沿用去年／手動選取）都會帶陽上人；但若某筆牌位
 * 是在「永久名單尚未有陽上人」時就建進本年度草稿，之後永久名單才補上陽上人，該年度
 * 草稿因冪等被跳過而不會回頭更新，導致確認報名一直卡在「缺陽上人」。
 *
 * 安全原則（對應需求）：
 *   - 只補「本年度 entry 陽上人為空」的牌位；**不覆蓋**已有值（含使用者手動輸入）。
 *   - 只在**永久名單確有陽上人**時才補；永久名單沒有 → 不動、不猜測（維持顯示缺少）。
 *   - 對應永久牌位：優先用 entry.worshipRecordId；否則以（type＋正規化姓名＋正規化地址）比對。
 *   - 只處理歷代祖先（ANCESTOR_LINE）與乙位正魂（INDIVIDUAL_SOUL）。
 *   - 冪等：補過即為非空，之後再進來是 no-op。
 *
 * 回傳補入筆數。呼叫時機：進入本年度普渡編輯器載入資料時（僅具編輯權限者觸發）。
 */
export async function backfillYearAncestorYangshangFromHousehold(
  householdId: string,
  year: number,
  operatorName?: string | null
): Promise<{ filled: number }> {
  const record = await prisma.ritualRecord.findFirst({
    where: { householdId, year, activityType: "UNIVERSAL_SALVATION", deletedAt: null },
    include: { universalSalvation: { include: { entries: { where: { deletedAt: null } } } } },
  });
  if (!record?.universalSalvation) return { filled: 0 };

  const targets = record.universalSalvation.entries.filter(
    (e) =>
      (e.category === "ANCESTOR_LINE" || e.category === "INDIVIDUAL_SOUL") &&
      (e.yangshangNames?.length ?? 0) === 0 &&
      !(e.yangshangName && e.yangshangName.trim())
  );
  if (targets.length === 0) return { filled: 0 };

  const { recordVersion } = await import("@/lib/recordVersion");
  let filled = 0;

  for (const e of targets) {
    const worshipType = e.category === "ANCESTOR_LINE" ? "ANCESTOR_LINE" : "INDIVIDUAL";
    // 對應永久牌位：優先來源 ID，否則姓名＋地址比對（同名不同址＝不同牌位）。
    let wr =
      e.worshipRecordId != null
        ? await prisma.worshipRecord.findFirst({ where: { id: e.worshipRecordId, householdId, type: worshipType, deletedAt: null } })
        : null;
    if (!wr) {
      const candidates = await prisma.worshipRecord.findMany({ where: { householdId, type: worshipType, deletedAt: null } });
      const key = `${normalizeTabletText(e.displayName)}::${normalizeTabletText(e.tabletAddress)}`;
      wr =
        candidates.find(
          (w) => `${normalizeTabletText(w.displayName)}::${normalizeTabletText(w.location)}` === key
        ) ?? null;
    }
    const names = resolveYangshangNames(null, wr?.yangshangName ?? null);
    if (names.length === 0) continue; // 永久名單也沒有陽上人 → 不猜、不動（維持顯示缺少）

    await prisma.$transaction(async (tx) => {
      const after = await tx.universalSalvationEntry.update({
        where: { id: e.id },
        data: { yangshangNames: names, yangshangName: names[0] },
      });
      await recordVersion(
        {
          entityType: "UniversalSalvationEntry",
          entityId: e.id,
          action: "UPDATE",
          beforeData: e,
          afterData: after,
          operatorName,
          changeNote: "自家戶永久名單補入陽上人（本年度草稿原缺，永久名單有值）",
        },
        tx
      );
    });
    filled += 1;
  }

  return { filled };
}
