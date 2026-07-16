// 前端共用型別——對應 GET/POST 這些 API 實際回傳的 JSON 形狀（Date 欄位
// 序列化後會變成字串，跟 src/lib/purification.ts 裡的伺服器端型別不完全
// 相同，所以前端另外定義一份，只挑畫面真正需要用到的欄位）。

export type FontTierJson = {
  level: number;
  fontSizePt: number;
  letterSpacingPt: number;
  charsCapacity: number;
};

export type ColumnOptimizationJson = {
  column: "NAME" | "MIDDLE" | "ADDRESS";
  charCount: number;
  chosenTier: FontTierJson;
  fits: boolean;
};

export type CellOptimizationJson = {
  name: ColumnOptimizationJson;
  middle: ColumnOptimizationJson;
  address: ColumnOptimizationJson;
  needsManualReview: boolean;
  reviewReasons: string[];
};

export type PurificationPrintFieldsJson = {
  view: {
    id: string;
    number: number | null;
    status: "ACTIVE" | "CANCELLED" | "SUPPLEMENTARY";
    displayName: string;
    gender: "MALE" | "FEMALE" | "UNKNOWN";
    address: string | null;
    isPrinted: boolean;
  };
  ageResolution: { ok: boolean; age?: number; reason?: string };
  jishiText: string | null;
  lunarDateText: { monthText: string; dayText: string; combined: string } | null;
  addressText: string;
  cellContent: {
    numberText: string;
    nameText: string;
    middleText: string;
    addressText: string;
  };
  layout: CellOptimizationJson;
  readiness: { canPrint: boolean; issues: string[] };
};

export type PurificationRegistrationViewJson = {
  id: string;
  templeEventId: string;
  number: number | null;
  status: "ACTIVE" | "CANCELLED" | "SUPPLEMENTARY";
  isTemporaryName: boolean;
  displayName: string;
  gender: "MALE" | "FEMALE" | "UNKNOWN";
  lunar: { year: number; month: number; day: number; isLeapMonth: boolean } | null;
  address: string | null;
  phone: string | null;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  paymentAmount: string | null;
  notes: string | null;
  registeredAt: string;
  isPrinted: boolean;
  printedAt: string | null;
  printBatchId: string | null;
  memberId: string | null;
  householdId: string | null;
};

export type PurificationYearOverviewJson = {
  id: string;
  year: number;
  name: string;
  isLocked: boolean;
  registrations: PurificationRegistrationViewJson[];
  needsConfirmation: { registration: PurificationRegistrationViewJson; issues: string[] }[];
};

export type PurificationYearListItemJson = {
  id: string;
  year: number;
  name: string;
  isLocked: boolean;
  copiedFromYearId: string | null;
  createdAt: string;
  updatedAt: string;
};
