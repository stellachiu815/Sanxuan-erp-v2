import type { Prisma } from "@prisma/client";

/**
 * V12.3「家戶管理完整強化」指令一.A：成員換戶時，去正規化 householdId 的同步。
 *
 * ── 問題背景 ──
 * 系統有 6 張表同時存了 memberId 與 householdId。householdId 是為了「不必
 * join Member 就能依家戶查詢與列印」而刻意去正規化的欄位，本身沒有錯；
 * 錯的是在 V12.3 之前，成員被轉移／拆分／合併到另一戶時，程式只更新了
 * Member.householdId，這 6 張表的 householdId 完全沒有跟著動——結果就是
 * 「這位信眾已經在 B 戶，但他的收款、收據、供品認捐仍然掛在 A 戶」。
 *
 * ── 這支 service 的角色 ──
 * 這是**全系統唯一**一份「成員換戶時要一併同步哪些表」的定義。合併、拆分、
 * 轉移三條流程一律呼叫它，不可各寫一套（指令一.A）。日後若再新增同時存
 * memberId 與 householdId 的表，只要加進下面的 SYNC_TARGETS 就會自動被三條
 * 流程涵蓋。
 *
 * ── 交易安全 ──
 * 這支只接受 Prisma.TransactionClient（tx），不接受 prisma 本體，型別上就
 * 強制呼叫端必須把它放在 $transaction 裡。任何一步失敗，整個交易連同
 * Member.householdId 一起 rollback（指令一.A）。
 *
 * ── 只動「跟著人走」的紀錄 ──
 * 一律用 `memberId IN (...)` 當條件，只更新確實屬於這批被移動成員的紀錄。
 * 沒有 memberId、純家戶層級的歷史（RitualRecord、Activity）**不在這裡**，
 * 那些依指令一.B 維持原家戶不動，改由查詢時合併顯示。
 */

/**
 * 需要同步的 6 張表。每一項描述「這張表用哪個欄位存成員、哪個欄位存家戶」。
 *
 * ⚠️ 欄位名稱各表不同（歷史因素），所以用設定表描述而不是硬寫 6 段程式碼：
 *   OfferingClaim            sponsorMemberId / sponsorHouseholdId（兩者皆必填）
 *   PaymentTransaction       payerMemberId   / payerHouseholdId
 *   ManualReceivable         payerMemberId   / payerHouseholdId
 *   Receipt                  memberId        / householdId
 *   StoveMasterRegistration  memberId        / householdId
 *   AdditionalPrintItem      memberId        / householdId（householdId 必填、memberId 選填）
 */
const SYNC_TARGETS = [
  { key: "offeringClaim", label: "供品認捐", memberField: "sponsorMemberId", householdField: "sponsorHouseholdId" },
  { key: "paymentTransaction", label: "收款紀錄", memberField: "payerMemberId", householdField: "payerHouseholdId" },
  { key: "manualReceivable", label: "臨時應收", memberField: "payerMemberId", householdField: "payerHouseholdId" },
  { key: "receipt", label: "收據", memberField: "memberId", householdField: "householdId" },
  { key: "stoveMasterRegistration", label: "爐主登錄", memberField: "memberId", householdField: "householdId" },
  { key: "additionalPrintItem", label: "附加列印項目", memberField: "memberId", householdField: "householdId" },
] as const;

export type SyncTargetKey = (typeof SYNC_TARGETS)[number]["key"];

/** 每張表實際同步（或預計同步）的筆數，供 preview 顯示與 RecordVersion 記錄。 */
export type HouseholdReferenceSyncCounts = Record<SyncTargetKey, number>;

export const SYNC_TARGET_LABEL: Record<SyncTargetKey, string> = SYNC_TARGETS.reduce(
  (acc, t) => ({ ...acc, [t.key]: t.label }),
  {} as Record<SyncTargetKey, string>
);

function emptyCounts(): HouseholdReferenceSyncCounts {
  return SYNC_TARGETS.reduce(
    (acc, t) => ({ ...acc, [t.key]: 0 }),
    {} as HouseholdReferenceSyncCounts
  );
}

export function totalSyncCount(counts: HouseholdReferenceSyncCounts): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/**
 * 把這批成員名下、6 張表裡的 householdId 一律同步成新的家戶。
 *
 * **必須**在 $transaction 內呼叫（型別已強制）。回傳各表實際更新筆數，
 * 呼叫端會把它寫進 RecordVersion 的 changeNote，讓異動紀錄看得出這次
 * 一共連帶調整了哪些歷史資料。
 *
 * @param tx                 進行中的 Prisma 交易
 * @param memberIds          被移動的成員
 * @param targetHouseholdId  這批成員的新家戶
 */
export async function syncMemberHouseholdReferences(
  tx: Prisma.TransactionClient,
  memberIds: string[],
  targetHouseholdId: string
): Promise<HouseholdReferenceSyncCounts> {
  const counts = emptyCounts();
  if (memberIds.length === 0) return counts;

  for (const target of SYNC_TARGETS) {
    // 用 Prisma 的 delegate 動態取用；欄位名稱來自上方 SYNC_TARGETS 的設定，
    // 不是使用者輸入，沒有注入風險。
    const delegate = (tx as unknown as Record<string, { updateMany: (args: unknown) => Promise<{ count: number }> }>)[
      target.key
    ];

    const result = await delegate.updateMany({
      where: {
        [target.memberField]: { in: memberIds },
        // 已經是目標家戶的就不必再寫入，減少沒必要的 UPDATE 與版本雜訊。
        NOT: { [target.householdField]: targetHouseholdId },
      },
      data: { [target.householdField]: targetHouseholdId },
    });

    counts[target.key] = result.count;
  }

  return counts;
}

/**
 * 預估「若把這批成員移到目標家戶，會同步幾筆」——給 preview 用。
 *
 * 條件與 syncMemberHouseholdReferences() **完全一致**，只是換成 count()，
 * 確保 preview 顯示的數字跟實際執行的筆數對得起來。這裡接受 tx 或 prisma
 * 本體，因為 preview 是唯讀查詢、不需要交易。
 */
export async function countMemberHouseholdReferences(
  client: Prisma.TransactionClient,
  memberIds: string[],
  targetHouseholdId: string
): Promise<HouseholdReferenceSyncCounts> {
  const counts = emptyCounts();
  if (memberIds.length === 0) return counts;

  for (const target of SYNC_TARGETS) {
    const delegate = (client as unknown as Record<string, { count: (args: unknown) => Promise<number> }>)[target.key];

    counts[target.key] = await delegate.count({
      where: {
        [target.memberField]: { in: memberIds },
        NOT: { [target.householdField]: targetHouseholdId },
      },
    });
  }

  return counts;
}

/** 把筆數整理成人看得懂的一行字，供 RecordVersion.changeNote 與畫面使用。 */
export function describeSyncCounts(counts: HouseholdReferenceSyncCounts): string {
  const parts = SYNC_TARGETS.filter((t) => counts[t.key] > 0).map((t) => `${t.label} ${counts[t.key]} 筆`);
  return parts.length > 0 ? parts.join("、") : "無需同步的關聯紀錄";
}
