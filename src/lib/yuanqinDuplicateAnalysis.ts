/**
 * V33 §9 累世冤親債主重複「分類器」（純函式，無 Prisma，供唯讀診斷腳本與測試共用）。
 *
 * 依規格六類判定，**不自動刪除／合併正式資料**：
 *   1 QUERY_FANOUT           同一 Entry 被查詢/ join 重複展開（由呼叫端資料重複 id 判定）。
 *   2 DUP_DEFAULT_TABLET     同一 Entry ≥2 筆預設 TABLET 列印物件（可安全去重 → 修復腳本 dry-run）。
 *   3 DUP_BASIC_POCKET       同一 Entry ≥2 筆基本寶袋（可安全去重；額外寶袋不動）。
 *   4 DUP_YUANQIN_ITEM       同一 Member 在同一 RitualRecord 有 ≥2 筆有效 US_YUANQIN → NEEDS_REVIEW（人工）。
 *   5 LEGIT_MULTIPLE         姓名相同但 Entry 不同、確為合法多筆報名（保留）。
 *   6 CANCELLED_HISTORY      已取消／軟刪，保留歷史但不得進有效清單。
 */

export type YuanqinPrintObjectRow = {
  additionalPrintItemId: string;
  entryId: string; // sourceEntryId
  itemType: string; // TABLET / POCKET / ...
  isExtra: boolean;
  status: string;
  deletedAt: string | null;
  printCount: number;
  createdAt: string | null;
};

export type YuanqinEntryRow = {
  entryId: string;
  ritualRecordId: string;
  householdId: string;
  memberId: string | null;
  displayName: string;
  tabletAddress: string | null;
  memberAddress: string | null;
  registrationItemId: string | null;
  workOrder: number | null;
  status: string; // entry / item status
  deletedAt: string | null;
};

export type DuplicateClass =
  | "DUP_DEFAULT_TABLET"
  | "DUP_BASIC_POCKET"
  | "DUP_YUANQIN_ITEM"
  | "LEGIT_MULTIPLE"
  | "CANCELLED_HISTORY"
  | "OK";

export type EntryClassification = {
  entryId: string;
  ritualRecordId: string;
  householdId: string;
  memberId: string | null;
  displayName: string;
  workOrder: number | null;
  classes: DuplicateClass[];
  suggestion: string;
};

const isActive = (r: { status: string; deletedAt: string | null }) =>
  r.deletedAt == null && r.status !== "CANCELLED";

/** 每 (entryId,itemType) 預設物件（isExtra=false、active）數量 → 供 DUP_DEFAULT_TABLET / DUP_BASIC_POCKET。 */
export function countDefaultPrintObjects(rows: YuanqinPrintObjectRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.isExtra || !isActive(r)) continue;
    const key = `${r.entryId}::${r.itemType}`;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return m;
}

/**
 * 綜合分類：逐筆有效 Entry 給出分類與建議。
 * printObjects 用於判定 2/3；entries 用於判定 4/5/6。
 */
export function classifyYuanqin(
  entries: YuanqinEntryRow[],
  printObjects: YuanqinPrintObjectRow[]
): EntryClassification[] {
  const defaultCounts = countDefaultPrintObjects(printObjects);
  // (ritualRecordId, memberId) → 有效 entry 數（判定 4）。memberId null 不納入「同人重複」判定。
  const memberGroup = new Map<string, YuanqinEntryRow[]>();
  for (const e of entries) {
    if (!isActive(e) || !e.memberId) continue;
    const key = `${e.ritualRecordId}::${e.memberId}`;
    (memberGroup.get(key) ?? memberGroup.set(key, []).get(key)!).push(e);
  }
  // (ritualRecordId, displayName) 有效 entry 數（判定 5 legit multiple by name）。
  const nameGroup = new Map<string, number>();
  for (const e of entries) {
    if (!isActive(e)) continue;
    const key = `${e.ritualRecordId}::${e.displayName}`;
    nameGroup.set(key, (nameGroup.get(key) ?? 0) + 1);
  }

  return entries.map((e) => {
    const classes: DuplicateClass[] = [];
    const suggestions: string[] = [];
    if (!isActive(e)) {
      classes.push("CANCELLED_HISTORY");
      suggestions.push("保留歷史；不得進有效名單/統計/列印");
      return { entryId: e.entryId, ritualRecordId: e.ritualRecordId, householdId: e.householdId, memberId: e.memberId, displayName: e.displayName, workOrder: e.workOrder, classes, suggestion: suggestions.join("；") };
    }
    const tabletN = defaultCounts.get(`${e.entryId}::TABLET`) ?? 0;
    const pocketN = defaultCounts.get(`${e.entryId}::POCKET`) ?? 0;
    if (tabletN > 1) { classes.push("DUP_DEFAULT_TABLET"); suggestions.push(`預設 TABLET ${tabletN} 筆→dry-run 去重保留 1 筆`); }
    if (pocketN > 1) { classes.push("DUP_BASIC_POCKET"); suggestions.push(`基本寶袋 ${pocketN} 筆→dry-run 去重保留 1 筆（額外寶袋不動）`); }
    const mg = e.memberId ? memberGroup.get(`${e.ritualRecordId}::${e.memberId}`) : undefined;
    if (mg && mg.length > 1) { classes.push("DUP_YUANQIN_ITEM"); suggestions.push(`同一 Member 有 ${mg.length} 筆有效冤親→NEEDS_REVIEW（人工確認，不自動刪除）`); }
    const nameN = nameGroup.get(`${e.ritualRecordId}::${e.displayName}`) ?? 0;
    if (classes.length === 0 && nameN > 1) { classes.push("LEGIT_MULTIPLE"); suggestions.push("姓名相同但不同 Entry；不得誤合併"); }
    if (classes.length === 0) { classes.push("OK"); suggestions.push("正常"); }
    return { entryId: e.entryId, ritualRecordId: e.ritualRecordId, householdId: e.householdId, memberId: e.memberId, displayName: e.displayName, workOrder: e.workOrder, classes, suggestion: suggestions.join("；") };
  });
}

export function summarizeClassifications(list: EntryClassification[]): Record<string, number> {
  const s: Record<string, number> = {};
  for (const c of list) for (const cls of c.classes) s[cls] = (s[cls] ?? 0) + 1;
  return s;
}
