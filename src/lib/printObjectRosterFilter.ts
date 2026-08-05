/**
 * V36.2：列印物件查詢／補印準備「型別＋純函式」——**不 import Prisma**，
 * 供 client 元件與單元測試安全使用（server 端查詢在 printObjectRoster.ts）。
 *
 * 一物件一列的關鍵：expandPrintObjects() 依 quantity 展開成 N 筆實體列印物件
 *（例如一筆報名 5 個寶袋 → 5 列，不以「數量 5」單列呈現）。
 */

/** 一個列印物件（AdditionalPrintItem）的基底資料（未依數量展開）。 */
export type PrintObjectBase = {
  objectId: string;
  workNo: number | null; // No.xxx = workOrder ?? registrationOrder
  activityName: string;
  itemType: string; // TABLET / POCKET / ...
  typeKey: string; // 篩選用：牌位＝category、寶袋＝POCKET
  typeLabel: string; // 顯示用中文
  householdId: string;
  householdCode: string;
  householdName: string;
  registrantName: string;
  mainText: string; // 實際列印主文（printMainText 覆寫優先，否則 resolveRitualDisplayName）
  yangshang: string[];
  address: string | null;
  firstPrintedAt: string | null;
  lastPrintedAt: string | null;
  printCount: number; // 物件層列印次數
  quantity: number; // 份數
  printedQuantity: number; // 已印份數（供每份已/未列印判定）
  reportStatus: string; // 報名狀態（RitualRecord.status）
  createdAt: string;
  previewHref: string; // 既有唯讀預覽頁
};

/** 展開後的「單一實體列印物件」列。 */
export type PrintObjectRow = Omit<PrintObjectBase, "quantity" | "printedQuantity"> & {
  rowKey: string;
  copyIndex: number; // 第幾份（1 起）
  copyCount: number; // 總份數
  copyPrinted: boolean; // 這一份是否已列印
  firstVsReprint: "first" | "reprint"; // 物件層：首印 vs 補印
};

/** 依 quantity 展開：一物件 → N 筆實體列印物件（不合併、不以數量單列）。 */
export function expandPrintObjects(bases: PrintObjectBase[]): PrintObjectRow[] {
  const rows: PrintObjectRow[] = [];
  for (const b of bases) {
    const count = Math.max(1, b.quantity || 1);
    const { quantity: _q, printedQuantity, ...rest } = b;
    void _q;
    for (let k = 1; k <= count; k++) {
      rows.push({
        ...rest,
        rowKey: `${b.objectId}#${k}`,
        copyIndex: k,
        copyCount: count,
        copyPrinted: k <= printedQuantity,
        firstVsReprint: b.printCount > 0 ? "reprint" : "first",
      });
    }
  }
  return rows;
}

export type PrintObjectFilters = {
  activityName?: string;
  typeKey?: string;
  workNo?: string; // 作業編號（字串包含比對）
  householdCode?: string;
  householdName?: string;
  keyword?: string; // 姓名／主文／陽上人
  printed?: "all" | "printed" | "unprinted";
  firstReprint?: "all" | "first" | "reprint";
  reportStatus?: string;
  dateField?: "created" | "printed";
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  sort?: "workNoAsc" | "workNoDesc";
};

const inc = (hay: string | null | undefined, needle: string) =>
  (hay ?? "").toLowerCase().includes(needle.trim().toLowerCase());

export function filterAndSortPrintObjectRows(rows: PrintObjectRow[], f: PrintObjectFilters): PrintObjectRow[] {
  let out = rows.filter((r) => {
    if (f.activityName && r.activityName !== f.activityName) return false;
    if (f.typeKey && r.typeKey !== f.typeKey) return false;
    if (f.workNo && !inc(r.workNo == null ? "" : String(r.workNo), f.workNo)) return false;
    if (f.householdCode && !inc(r.householdCode, f.householdCode)) return false;
    if (f.householdName && !inc(r.householdName, f.householdName)) return false;
    if (f.keyword) {
      const k = f.keyword;
      const hit = inc(r.registrantName, k) || inc(r.mainText, k) || r.yangshang.some((y) => inc(y, k));
      if (!hit) return false;
    }
    if (f.printed === "printed" && !r.copyPrinted) return false;
    if (f.printed === "unprinted" && r.copyPrinted) return false;
    if (f.firstReprint === "first" && r.firstVsReprint !== "first") return false;
    if (f.firstReprint === "reprint" && r.firstVsReprint !== "reprint") return false;
    if (f.reportStatus && r.reportStatus !== f.reportStatus) return false;
    if (f.dateFrom || f.dateTo) {
      const iso = f.dateField === "printed" ? r.lastPrintedAt : r.createdAt;
      const day = (iso ?? "").slice(0, 10);
      if (!day) return false; // 無日期者，套用日期範圍時排除
      if (f.dateFrom && day < f.dateFrom) return false;
      if (f.dateTo && day > f.dateTo) return false;
    }
    return true;
  });

  const dir = f.sort === "workNoDesc" ? -1 : 1;
  out = out.slice().sort((a, b) => {
    // No.xxx 空號一律排最後（升／降序皆然）。
    if (a.workNo == null && b.workNo == null) return a.copyIndex - b.copyIndex;
    if (a.workNo == null) return 1;
    if (b.workNo == null) return -1;
    if (a.workNo !== b.workNo) return (a.workNo - b.workNo) * dir;
    return a.copyIndex - b.copyIndex;
  });
  return out;
}
