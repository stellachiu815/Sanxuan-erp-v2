/**
 * V36.1：活動參加名單「型別＋純函式篩選／排序」——**不 import Prisma**，
 * 供 client 元件與單元測試安全使用（server 端查詢在 activityParticipantRoster.ts）。
 */

export type ParticipantItemRow = {
  itemId: string;
  /** 正式作業編號＝workOrder ?? registrationOrder（printNumberOf）。舊資料未編號為 null。 */
  workNo: number | null;
  activityName: string;
  itemTypeKey: string;
  itemTypeName: string;
  householdCode: string;
  householdName: string;
  registrantName: string;
  /** 牌位主文／寶袋列印名稱／實際報名內容。 */
  content: string;
  yangshang: string[];
  address: string | null;
  addressSource: "牌位地址" | "個人地址" | "家戶地址" | "無";
  quantity: number;
  amountDue: number;
  amountPaid: number;
  amountUnpaid: number;
  status: string;
  printCount: number;
  printedAt: string | null;
  createdAt: string;
};

export type ParticipantFilters = {
  activityName?: string;
  itemTypeKey?: string;
  householdCode?: string;
  householdName?: string;
  keyword?: string; // 信眾／陽上人／主文
  payment?: "all" | "paid" | "unpaid";
  print?: "all" | "printed" | "unprinted";
  sort?: "workNoAsc" | "workNoDesc";
};

const inc = (hay: string | null | undefined, needle: string) =>
  (hay ?? "").toLowerCase().includes(needle.trim().toLowerCase());

export function filterAndSortParticipantRows(rows: ParticipantItemRow[], f: ParticipantFilters): ParticipantItemRow[] {
  let out = rows.filter((r) => {
    if (f.activityName && r.activityName !== f.activityName) return false;
    if (f.itemTypeKey && r.itemTypeKey !== f.itemTypeKey) return false;
    if (f.householdCode && !inc(r.householdCode, f.householdCode)) return false;
    if (f.householdName && !inc(r.householdName, f.householdName)) return false;
    if (f.keyword) {
      const k = f.keyword;
      const hit = inc(r.registrantName, k) || inc(r.content, k) || r.yangshang.some((y) => inc(y, k));
      if (!hit) return false;
    }
    if (f.payment === "paid" && !(r.amountPaid > 0)) return false;
    if (f.payment === "unpaid" && !(r.amountUnpaid > 0)) return false;
    if (f.print === "printed" && !(r.printCount > 0)) return false;
    if (f.print === "unprinted" && r.printCount > 0) return false;
    return true;
  });

  const dir = f.sort === "workNoDesc" ? -1 : 1;
  // null 作業編號一律排在最後（不論升降序）。
  out = out.slice().sort((a, b) => {
    if (a.workNo == null && b.workNo == null) return 0;
    if (a.workNo == null) return 1;
    if (b.workNo == null) return -1;
    return (a.workNo - b.workNo) * dir;
  });
  return out;
}
