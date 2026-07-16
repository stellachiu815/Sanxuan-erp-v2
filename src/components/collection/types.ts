// V11.0「全宮共用收款中心」前端共用型別（比照 src/components/offering/types.ts 既有慣例，
// Date 一律轉成 ISO 字串再傳給 client component）。
//
// V11.0.1 更新：欄位名稱改成跟 src/lib/receivableAdapters.ts 的
// `UniversalReceivableView`（需求「四」明確列出的 18 個共用欄位）完全一致，
// 不再是 V11.0 版本專屬於 OfferingClaim 命名習慣的 sponsorName/title/
// contextLabel/amountDue/amountPaid/amountUnpaid——現在收款中心的畫面透過
// 統一介面拿到普渡贊普、祭改等來源的資料，欄位名稱也必須是通用的。

export type UniversalReceivableViewJSON = {
  sourceType: string;
  sourceId: string;
  householdId: string | null;
  memberId: string | null;
  payerName: string;
  phone: string | null;
  activityId: string | null;
  activityName: string | null;
  itemName: string;
  receivableAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  paymentStatus: string;
  sourceYear: number;
  sourceDate: string;
  sourceUrl: string;
  canCollect: boolean;
  cannotCollectReason: string | null;
  isCrossYear: boolean;
  note: string | null;
  createdAt: string;
};

export type PaymentAllocationJSON = {
  id: string;
  sourceType: string;
  sourceId: string;
  sourceLabel: string;
  sourceYear: number | null;
  amount: number;
};

export type PaymentTransactionJSON = {
  id: string;
  transactionNo: string;
  paidOn: string;
  totalAmount: number;
  methodType: string;
  payerNameSnapshot: string;
  isAgentCollected: boolean;
  agentName: string | null;
  agentRemittanceStatus: string | null;
  status: string;
  createdAt: string;
  allocations: PaymentAllocationJSON[];
};
