// V3.0「普渡登記 UI」共用型別。
//
// 這裡刻意不直接重用 src/lib/ritual.ts 的 Prisma payload 型別，因為從
// Server Component 傳到 Client Component 的資料，一律先經過
// JSON.parse(JSON.stringify(...)) 序列化過（Decimal／Date 都會變成字串），
// 跟 Prisma 原始型別不一樣；之後畫面上每次呼叫 API 存檔，拿到的也是同一種
// JSON 形狀，所以乾脆單獨定義一份「畫面用」的型別，比較單純、不會混淆。

export type EntryCategory =
  | "ANCESTOR_LINE"
  | "INDIVIDUAL_SOUL"
  | "DEBT_CREDITOR"
  | "UNBORN_CHILD";

/** V14.2：一筆本戶既有牌位可選項（名稱＋既有陽上人＋既有牌位地址）。 */
export type WorshipOptionJSON = {
  displayName: string;
  yangshangNames: string[];
  tabletAddress: string | null;
};

export type EntryJSON = {
  id: string;
  category: EntryCategory;
  displayName: string;
  yangshangName: string | null;
  /** V14.1：多位陽上人（只存姓名、保留順序）。 */
  yangshangNames: string[];
  /** V14.1：此筆牌位獨立地址。 */
  tabletAddress: string | null;
  notes: string | null;
  sortOrder: number;
};

export type DetailJSON = {
  id: string;
  isRegistered: boolean;
  yangshangName: string | null;
  enshrinementLocation: string | null;
  isSponsor: boolean;
  sponsorQuantity: number | null;
  sponsorUnitPrice: string | null;
  sponsorAmount: string | null;
  sponsorNotes: string | null;
  tableNumber: string | null;
  notes: string | null;
  entries: EntryJSON[];
};

export type RecordJSON = {
  id: string;
  year: number;
  status: "DRAFT" | "CONFIRMED" | "CANCELLED";
  universalSalvation: DetailJSON | null;
};

// V9.1「附加列印項目與多寶袋管理機制」共用型別。同樣是「畫面用」的 JSON
// 形狀（Decimal 已轉成 string／null），對應 src/lib/additionalPrintItems.ts
// 的 AdditionalPrintItem 資料。
export type AdditionalPrintItemType = "POCKET" | "TABLET" | "PETITION" | "LANTERN_TABLET" | "OTHER";

export type AdditionalPrintItemStatus = "PENDING_CONFIRMATION" | "PENDING_PRINT" | "PRINTED" | "CANCELLED";

export type AdditionalPrintItemJSON = {
  id: string;
  itemType: AdditionalPrintItemType;
  printName: string;
  usesSourceName: boolean;
  quantity: number;
  isExtra: boolean;
  status: AdditionalPrintItemStatus;
  isPrinted: boolean;
  printedQuantity: number;
  reprintCount: number;
  note: string | null;
  isChargeable: boolean;
  unitPrice: string | null;
  subtotal: string | null;
  /**
   * V13.3B：付款狀態。由 API 即時計算
   * （PaymentAllocation − PaymentAdjustment），不是資料庫欄位。
   */
  amountPaid: number;
  amountUnpaid: number;
  isPaid: boolean;
  paymentStatus: "FREE" | "UNPAID" | "PARTIAL" | "PAID";
};

/**
 * 新增登記項目時的操作模式（V3.1 建立，V3.2「大量登記優化」調整，只影響
 * 畫面上「新增」這個動作怎麼填，不影響資料表欄位、也不影響任何 API）：
 * - "surname"：只需輸入姓氏，Enter 直接新增「○○姓歷代祖先」，新增後游標
 *   自動清空並回到姓氏欄，方便連續輸入下一戶。
 * - "name"：只需輸入姓名，Enter 直接新增「○○○ 乙位正魂」，新增後同樣清空
 *   並回到姓名欄。
 * - "batch"：可以輸入數量，一次建立多筆固定名稱＋流水編號的登記
 *   （例如「冤親債主（1）」～「冤親債主（5）」）；數量是 1 時維持原本的
 *   做法，不加編號（就是單純一筆「冤親債主」）。
 */
export type EntryAddMode = "surname" | "name" | "batch";

/** 四個登記分類固定的顯示順序與樣式，畫面上依這個順序排版。 */
export const CATEGORY_SECTIONS: {
  category: EntryCategory;
  title: string;
  tone: string;
  addMode: EntryAddMode;
  /** "batch" 模式下，固定的名稱（會依數量自動加上流水編號） */
  fixedDisplayName?: string;
}[] = [
  {
    category: "ANCESTOR_LINE",
    title: "歷代祖先",
    tone: "bg-yolk-50",
    addMode: "surname",
  },
  {
    category: "INDIVIDUAL_SOUL",
    title: "個人乙位正魂",
    tone: "bg-blossom-50",
    addMode: "name",
  },
  {
    category: "DEBT_CREDITOR",
    title: "冤親債主",
    tone: "bg-mist-50",
    addMode: "batch",
    fixedDisplayName: "冤親債主",
  },
  {
    category: "UNBORN_CHILD",
    title: "無緣子女",
    tone: "bg-sage-50",
    addMode: "batch",
    fixedDisplayName: "無緣子女",
  },
];
