import type { RitualRecordStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureLinkedTabletItem, ENTRY_CATEGORY_TO_ITEM_KEY } from "@/lib/registrationItemRegistration";
import { ensureRegistrationItemTypesSeeded } from "@/lib/registrationItems";

/**
 * V27.3：普渡牌位「孤立 Entry」修復——為 deletedAt=null、卻沒有對應
 * RitualRegistrationItem 的有效 UniversalSalvationEntry 補建缺少的計價項目。
 *
 * 背景（根因）：`ensureLinkedTabletItem` 唯一會對「有效、對映正確」的牌位 Entry
 * 靜默不建 item 的條件是 `if (!itemType) return;`——建立當下 registration_item_types
 * 尚無對應 key（US_ANCESTOR／US_ZHENGHUN／US_YUANQIN…未 seed）。這些 Entry 從此
 * 沒有 item，`listRegisteredItems` 也就查不到，形成孤立資料。
 *
 * 安全保證：
 *  - **冪等、可重跑**：只挑「registrationItem 關聯為 null」的 Entry；已連結（含已取消／
 *    已軟刪除的 item）者一律跳過，不重複建立。
 *  - **不改 Entry 內容**：只新增 RitualRegistrationItem，不動 Entry 的姓名／陽上／地址／分類。
 *  - **不動金流/確認/列印**：新 item 金額由既有年度單價計算（牌位類 feeMode=NONE → 0），
 *    status 沿用該筆 RitualRecord 現況；完全不觸碰既有付款、收據、列印物件或確認狀態。
 *  - **先 seed 再補**（commit 時）：透過既有官方路徑 `ensureRegistrationItemTypesSeeded()`
 *    （create-only、冪等）確保 item type 存在，不新增第二套 seed。
 *  - **預設只補祖先／乙位正魂**：冤親債主（DEBT_CREDITOR）／無緣子女（UNBORN_CHILD）需
 *    人工先判斷是否重複，故預設不含；要納入須明確傳入 categories。
 */

export type TabletBackfillCategory = "ANCESTOR_LINE" | "INDIVIDUAL_SOUL" | "DEBT_CREDITOR" | "UNBORN_CHILD";

export const DEFAULT_BACKFILL_CATEGORIES: TabletBackfillCategory[] = ["ANCESTOR_LINE", "INDIVIDUAL_SOUL"];

export type OrphanEntry = {
  entryId: string;
  category: string;
  displayName: string;
  ritualRecordId: string;
  householdId: string;
  year: number;
  status: string;
  /**
   * 已存在 item 列、但**非有效**（deletedAt≠null 或 status=CANCELLED）→ 需「恢復」既有 item，
   * 不能新建（universalSalvationEntryId 唯一，且 ensureLinkedTabletItem 會因 already 跳過）。
   */
  hasInactiveItem: boolean;
};

export type BackfillAction = "CREATE" | "RESTORE" | "SKIP_EXCLUDED" | "FAIL";

export type BackfillPlanItem = {
  entry: OrphanEntry;
  action: BackfillAction;
  /** RESTORE 時＝要恢復的既有（軟刪）item id。 */
  itemId?: string;
  /** FAIL 時＝原因。 */
  reason?: string;
};

export type BackfillResult = {
  seededItemTypes: number;
  scanned: number;
  orphans: OrphanEntry[];
  plan: BackfillPlanItem[];
  created: string[]; // entryId：原本完全沒有 item 列 → 新建
  restored: string[]; // entryId：既有唯一軟刪 item → 恢復（僅清 deletedAt/deletedByName）
  skipped: string[]; // entryId：被 exclude 排除
  failed: { entryId: string; reason: string }[]; // 例如同一 Entry 有多筆歷史 item
  committed: boolean;
};

/**
 * 為單一孤立 Entry 規劃動作（唯讀）。dry-run 與 commit 共用，確保預覽與實作一致。
 *  - 完全沒有 item 列 → CREATE（由 ensureLinkedTabletItem 新建）。
 *  - 恰有 1 筆軟刪 item → RESTORE（只清 deletedAt/deletedByName）。
 *  - 有多筆歷史 item → FAIL（拒絕自動處理，需人工確認）。
 */
async function planForOrphan(entry: OrphanEntry, excluded: boolean): Promise<BackfillPlanItem> {
  if (excluded) return { entry, action: "SKIP_EXCLUDED" };
  if (!ENTRY_CATEGORY_TO_ITEM_KEY[entry.category]) {
    return { entry, action: "FAIL", reason: `分類 ${entry.category} 無對應 item key` };
  }
  if (!entry.hasInactiveItem) return { entry, action: "CREATE" };

  // hasInactiveItem：有 item 列但無「有效」item。找出全部歷史 item 判斷。
  const items = await prisma.ritualRegistrationItem.findMany({
    where: { universalSalvationEntryId: entry.entryId },
    select: { id: true, deletedAt: true },
  });
  if (items.length === 0) return { entry, action: "CREATE" }; // 理論上不會（hasInactiveItem 代表有列）
  if (items.length > 1) {
    return { entry, action: "FAIL", reason: `同一 Entry 有 ${items.length} 筆歷史 item，拒絕自動恢復，請人工確認` };
  }
  const it = items[0];
  if (it.deletedAt === null) {
    // 不會發生（有效 item 早在 findOrphan 被排除），保守處理。
    return { entry, action: "FAIL", reason: "既有 item 未軟刪，無需恢復" };
  }
  return { entry, action: "RESTORE", itemId: it.id };
}

/**
 * 掃描孤立 Entry（唯讀）。
 *
 * 「孤立」＝有效 Entry（deletedAt=null）**沒有任何『有效』的 RitualRegistrationItem**
 * （有效＝deletedAt=null 且 status≠CANCELLED），定義與 diagnose 完全一致。
 *
 * ⚠️ 刻意**不**用 `registrationItem: { is: null }` 反向關聯過濾：因為已被軟刪除／取消的
 * item 列仍佔用 `universalSalvationEntryId`（唯一），會讓關聯非 null 而漏掉這種孤立
 * （正是 F00001「周姓歷代祖先」在 diagnose 有、backfill 卻 0 的原因）。改以「是否存在
 * 有效 item」為準，並保留是否有 inactive item 的旗標。
 */
export async function findOrphanTabletEntries(params: {
  householdId?: string | null;
  categories?: TabletBackfillCategory[];
}): Promise<OrphanEntry[]> {
  const categories = params.categories ?? DEFAULT_BACKFILL_CATEGORIES;

  // 1) 候選有效 Entry（不用關聯過濾，避免軟刪 item 造成漏掉）。
  const rows = await prisma.universalSalvationEntry.findMany({
    where: {
      deletedAt: null,
      category: { in: categories },
      universalSalvation: {
        ritualRecord: {
          deletedAt: null,
          ...(params.householdId ? { householdId: params.householdId } : {}),
        },
      },
    },
    select: {
      id: true,
      category: true,
      displayName: true,
      universalSalvation: {
        select: { ritualRecord: { select: { id: true, householdId: true, year: true, status: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) return [];

  // 2) 這些 Entry 對應的所有 item（含軟刪／取消），判斷是否已有「有效」item。
  const entryIds = rows.map((r) => r.id);
  const items = await prisma.ritualRegistrationItem.findMany({
    where: { universalSalvationEntryId: { in: entryIds } },
    select: { universalSalvationEntryId: true, deletedAt: true, status: true },
  });
  // 「有效」＝ deletedAt=null（與 listRegisteredItems 顯示條件一致；不看 status，
  // 因為已取消但未軟刪的 item 仍會出現在「已報名項目」清單，故不算孤立）。
  const activeItemEntryIds = new Set<string>();
  const anyItemEntryIds = new Set<string>();
  for (const it of items) {
    if (!it.universalSalvationEntryId) continue;
    anyItemEntryIds.add(it.universalSalvationEntryId);
    if (it.deletedAt === null) activeItemEntryIds.add(it.universalSalvationEntryId);
  }

  const out: OrphanEntry[] = [];
  for (const r of rows) {
    if (activeItemEntryIds.has(r.id)) continue; // 已有有效 item → 非孤立
    const rr = r.universalSalvation?.ritualRecord;
    if (!rr) continue;
    out.push({
      entryId: r.id,
      category: r.category,
      displayName: r.displayName,
      ritualRecordId: rr.id,
      householdId: rr.householdId,
      year: rr.year,
      status: rr.status,
      hasInactiveItem: anyItemEntryIds.has(r.id),
    });
  }
  return out;
}

/**
 * 修復孤立 Entry。dry-run（commit=false）只回報將補哪些；commit=true 才實際 seed＋補 item。
 * excludeEntryIds：人工判定為重複／暫不處理的 Entry，可排除不補。
 */
export async function backfillMissingTabletItems(params: {
  householdId?: string | null;
  categories?: TabletBackfillCategory[];
  excludeEntryIds?: string[];
  commit?: boolean;
}): Promise<BackfillResult> {
  const commit = params.commit ?? false;
  const exclude = new Set(params.excludeEntryIds ?? []);

  const orphans = await findOrphanTabletEntries({ householdId: params.householdId, categories: params.categories });

  // 規劃每一筆的動作（唯讀）——dry-run 直接回報此規劃，commit 依此執行。
  const plan: BackfillPlanItem[] = [];
  for (const o of orphans) plan.push(await planForOrphan(o, exclude.has(o.entryId)));

  const skipped = plan.filter((p) => p.action === "SKIP_EXCLUDED").map((p) => p.entry.entryId);
  const created: string[] = [];
  const restored: string[] = [];
  const failed: { entryId: string; reason: string }[] = plan
    .filter((p) => p.action === "FAIL")
    .map((p) => ({ entryId: p.entry.entryId, reason: p.reason ?? "未知原因" }));

  let seededItemTypes = 0;

  if (commit) {
    // 官方 seed 路徑（冪等、create-only）：確保 item type 存在再補。
    const seed = await ensureRegistrationItemTypesSeeded();
    seededItemTypes = seed.created;

    for (const p of plan) {
      if (p.action === "CREATE") {
        await prisma.$transaction(async (tx) => {
          await ensureLinkedTabletItem(tx, {
            ritualRecordId: p.entry.ritualRecordId,
            entryId: p.entry.entryId,
            category: p.entry.category,
            year: p.entry.year,
            status: p.entry.status as RitualRecordStatus, // 沿用該筆報名現況
            memberId: null, // 祖先／乙位正魂的計價項目不綁單一成員（與現行建立行為一致）
          });
        });
        created.push(p.entry.entryId);
      } else if (p.action === "RESTORE" && p.itemId) {
        // 最小恢復：只清 deletedAt / deletedByName。其餘欄位（itemTypeId／ritualRecordId／
        // universalSalvationEntryId／金額／status／收據／列印／createdAt）一律不動。
        await prisma.ritualRegistrationItem.update({
          where: { id: p.itemId },
          data: { deletedAt: null, deletedByName: null },
        });
        restored.push(p.entry.entryId);
      }
    }
  }

  return {
    seededItemTypes,
    scanned: orphans.length,
    orphans,
    plan,
    created,
    restored,
    skipped,
    failed,
    committed: commit,
  };
}

export type ReactivateResult =
  | { ok: true; action: "REACTIVATE"; entryId: string; displayName: string; itemId: string; fromStatus: string; entryWasDeleted: boolean; committed: boolean }
  | { ok: true; action: "ALREADY_ACTIVE"; entryId: string; displayName: string; itemId: string; committed: boolean }
  | { ok: false; reason: string };

/**
 * V27.4/V27.5：使用者「重新報名」一筆先前被取消的祖先／乙位正魂／冤親牌位——限單筆、可預覽。
 *
 * 在同一 transaction 內恢復同一筆 Entry 與其 item（不新增重複）：
 *   Entry.deletedAt = null、Entry.deletedByName = null（若原本被軟刪）
 *   item.status = DRAFT（由 CANCELLED 恢復；讓使用者重新確認，不自動標 CONFIRMED）
 *   item.deletedAt = null、item.deletedByName = null
 * 金額／付款／收據／列印／itemType／ritualRecord／universalSalvationEntry／Entry 內容一律不動。
 *
 * 這代表**使用者明確的重新報名意圖**（與唯讀 backfill 不同）；故獨立成一支、需明確指定 entryId。
 * 保護：恰 1 筆 item 才處理，多筆歷史 item 拒絕（回報，不自動處理）。
 */
export async function reactivateTabletItemForReRegistration(
  entryId: string,
  opts?: { commit?: boolean }
): Promise<ReactivateResult> {
  const commit = opts?.commit ?? false;

  // 找 Entry（不論是否被軟刪；修復時可能兩種狀態都遇到）。
  const entry = await prisma.universalSalvationEntry.findUnique({
    where: { id: entryId },
    select: { id: true, displayName: true, deletedAt: true },
  });
  if (!entry) return { ok: false, reason: "找不到 Entry（不存在）" };

  const items = await prisma.ritualRegistrationItem.findMany({
    where: { universalSalvationEntryId: entryId },
    select: { id: true, status: true, deletedAt: true },
  });
  if (items.length === 0) return { ok: false, reason: "此 Entry 沒有任何 item 可恢復（應改用新建 backfill）" };
  if (items.length > 1) return { ok: false, reason: `此 Entry 有 ${items.length} 筆歷史 item，拒絕自動處理，請人工確認` };

  const it = items[0];
  const entryActive = entry.deletedAt === null;
  const itemActive = it.deletedAt === null && it.status !== "CANCELLED";
  if (entryActive && itemActive) {
    return { ok: true, action: "ALREADY_ACTIVE", entryId: entry.id, displayName: entry.displayName, itemId: it.id, committed: false };
  }

  if (commit) {
    await prisma.$transaction(async (tx) => {
      if (!entryActive) {
        await tx.universalSalvationEntry.update({ where: { id: entry.id }, data: { deletedAt: null, deletedByName: null } });
      }
      await tx.ritualRegistrationItem.update({
        where: { id: it.id },
        data: { status: "DRAFT", deletedAt: null, deletedByName: null },
      });
    });
  }
  return { ok: true, action: "REACTIVATE", entryId: entry.id, displayName: entry.displayName, itemId: it.id, fromStatus: it.status, entryWasDeleted: !entryActive, committed: commit };
}
