/**
 * V13.1 指令十五：測試資料清理**預覽**。
 *
 * ⚠️⚠️ 這支檔案**完全沒有刪除功能**，這是刻意的。
 *
 * 整份檔案裡沒有任何 delete / deleteMany / executeRaw / TRUNCATE，
 * 只有 findMany 與 count。使用者本輪的決定是「只產出清理預覽，
 * 等我確認後，下一次才執行真正清理」，所以連一個「順便寫好但先不呼叫」
 * 的刪除函式都不應該存在——那種函式遲早會被誤用。
 *
 * 真正的清理必須是**下一輪**、由使用者確認清單之後，另外撰寫一支
 * 一次性腳本，並且事前完整備份。
 *
 * ── 判斷方式（誠實說明其限制）─────────────────────────────
 * 系統沒有「這筆是測試資料」的欄位，所以只能用**啟發式訊號**推測，
 * 不可能 100% 準確。因此結果分成三類：
 *   likelyTest  ── 有明確測試特徵（例如戶名含「測試」）
 *   likelyReal  ── 有正式使用痕跡（有收款、收據、列印紀錄）
 *   needsReview ── 兩者都不明顯，**一律歸到這裡由人工判斷**
 *
 * 只要有任何疑慮就歸 needsReview，寧可讓使用者多看幾筆，
 * 也不要把正式資料誤標成測試資料。
 */

import { prisma } from "@/lib/prisma";

/** 測試資料的關鍵字特徵。 */
const TEST_KEYWORDS = ["測試", "test", "TEST", "Test", "範例", "demo", "DEMO", "假資料", "aaa", "AAA", "xxx", "XXX"];

function hasTestKeyword(...values: (string | null | undefined)[]): string | null {
  for (const v of values) {
    if (!v) continue;
    for (const kw of TEST_KEYWORDS) {
      if (v.includes(kw)) return kw;
    }
  }
  return null;
}

export type CleanupClassification = "likelyTest" | "likelyReal" | "needsReview";

export type HouseholdCleanupRow = {
  householdId: string;
  householdName: string;
  memberCount: number;
  worshipRecordCount: number;
  ritualRecordCount: number;
  /** 有沒有正式使用痕跡 */
  paymentCount: number;
  receiptCount: number;
  offeringClaimCount: number;
  classification: CleanupClassification;
  /** 為什麼這樣分類 */
  reasons: string[];
  createdAt: Date;
};

export type CleanupPreview = {
  generatedAt: Date;
  totals: {
    households: number;
    members: number;
    worshipRecords: number;
    ritualRecords: number;
    universalSalvationEntries: number;
    templeEvents: number;
  };
  classification: {
    likelyTest: number;
    likelyReal: number;
    needsReview: number;
  };
  households: HouseholdCleanupRow[];
  /** 無論如何都必須保留的資料（指令十五明列） */
  protectedData: { label: string; count: number; note: string }[];
};

/**
 * 產出清理預覽。**純讀取，不修改任何資料。**
 */
export async function buildCleanupPreview(): Promise<CleanupPreview> {
  const households = await prisma.household.findMany({
    where: { deletedAt: null },
    include: {
      _count: {
        select: {
          members: true,
          worshipRecords: true,
          ritualRecords: true,
          paymentTransactions: true,
          receipts: true,
          offeringClaims: true,
        },
      },
      members: { where: { deletedAt: null }, select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows: HouseholdCleanupRow[] = households.map((h) => {
    const reasons: string[] = [];

    // ── 正式使用痕跡（最強的「這是真資料」訊號）──
    const hasFinancialTrace =
      h._count.paymentTransactions > 0 || h._count.receipts > 0 || h._count.offeringClaims > 0;
    if (h._count.paymentTransactions > 0) reasons.push(`有 ${h._count.paymentTransactions} 筆收款紀錄`);
    if (h._count.receipts > 0) reasons.push(`有 ${h._count.receipts} 筆收據`);
    if (h._count.offeringClaims > 0) reasons.push(`有 ${h._count.offeringClaims} 筆供品認捐`);

    // ── 測試特徵 ──
    const keyword = hasTestKeyword(h.name, h.contactName, h.address, ...h.members.map((m) => m.name));
    if (keyword) reasons.push(`名稱或地址含「${keyword}」`);

    // ── 分類（有疑慮一律 needsReview）──
    let classification: CleanupClassification;
    if (hasFinancialTrace) {
      // 有金流痕跡 → 一律視為正式資料，即使名稱含「測試」也不建議清除
      classification = "likelyReal";
      if (keyword) {
        reasons.push("⚠️ 名稱看起來像測試資料，但已有金流紀錄，請人工確認後再決定");
        classification = "needsReview";
      }
    } else if (keyword) {
      classification = "likelyTest";
    } else if (h._count.members === 0 && h._count.worshipRecords === 0 && h._count.ritualRecords === 0) {
      classification = "needsReview";
      reasons.push("這一戶沒有任何成員、牌位或活動資料（可能是建立到一半的空資料）");
    } else {
      classification = "needsReview";
      reasons.push("沒有明確的測試特徵，也沒有金流紀錄，需人工判斷");
    }

    return {
      householdId: h.id,
      householdName: h.name,
      memberCount: h._count.members,
      worshipRecordCount: h._count.worshipRecords,
      ritualRecordCount: h._count.ritualRecords,
      paymentCount: h._count.paymentTransactions,
      receiptCount: h._count.receipts,
      offeringClaimCount: h._count.offeringClaims,
      classification,
      reasons,
      createdAt: h.createdAt,
    };
  });

  const [
    memberTotal,
    worshipTotal,
    ritualTotal,
    salvationEntryTotal,
    templeEventTotal,
    userTotal,
    settingTotal,
    templateTotal,
    driveTotal,
  ] = await Promise.all([
    prisma.member.count({ where: { deletedAt: null } }),
    prisma.worshipRecord.count(),
    prisma.ritualRecord.count({ where: { deletedAt: null } }),
    prisma.universalSalvationEntry.count({ where: { deletedAt: null } }),
    prisma.templeEvent.count(),
    prisma.user.count(),
    prisma.systemSetting.count(),
    prisma.templateDefinition.count(),
    prisma.googleDriveConnection.count(),
  ]);

  return {
    generatedAt: new Date(),
    totals: {
      households: households.length,
      members: memberTotal,
      worshipRecords: worshipTotal,
      ritualRecords: ritualTotal,
      universalSalvationEntries: salvationEntryTotal,
      templeEvents: templeEventTotal,
    },
    classification: {
      likelyTest: rows.filter((r) => r.classification === "likelyTest").length,
      likelyReal: rows.filter((r) => r.classification === "likelyReal").length,
      needsReview: rows.filter((r) => r.classification === "needsReview").length,
    },
    households: rows,
    /**
     * 指令十五明列「必須保留」的項目。列在預覽裡是為了讓使用者看到
     * 「這些東西不會被碰」，而不是要求她記住。
     */
    protectedData: [
      { label: "使用者帳號", count: userTotal, note: "不在任何清理範圍內" },
      { label: "角色權限", count: 0, note: "定義在程式碼（src/lib/permissions.ts），不是資料" },
      { label: "系統設定", count: settingTotal, note: "不在任何清理範圍內" },
      { label: "Google Drive 設定", count: driveTotal, note: "不在任何清理範圍內" },
      { label: "列印模板", count: templateTotal, note: "不在任何清理範圍內" },
      { label: "活動設定（活動年度）", count: templeEventTotal, note: "不在任何清理範圍內" },
    ],
  };
}
