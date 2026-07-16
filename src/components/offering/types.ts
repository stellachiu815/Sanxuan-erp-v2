// V10.1「供品認捐中心」前端共用型別（比照 src/components/ritual/types.ts 的既有慣例）。

export type OfferingBehaviorKindValue = "TURTLE" | "NOODLE_TOWER" | "LOOSE_PEACH" | "FLORAL" | "GENERIC";
export type OfferingClaimModeValue = "INDIVIDUAL" | "GROUPED";
export type OfferingUnitValue = "ZHI" | "DUI" | "PAN" | "FEN" | "ZU" | "OTHER";

export type OfferingTypeJSON = {
  id: string;
  name: string;
  category: string | null;
  behaviorKind: OfferingBehaviorKindValue;
  unit: OfferingUnitValue;
  isChargeable: boolean;
  hasLimitedQuantity: boolean;
  defaultQuantity: number;
  defaultPrice: string | null;
  allowPriceOverride: boolean;
  allowDuplicateClaim: boolean;
  claimMode: OfferingClaimModeValue;
  isActive: boolean;
  sortOrder: number;
  note: string | null;
};

export type ActivityOfferingJSON = {
  id: string;
  templeEventId: string;
  offeringTypeId: string;
  offeringType: OfferingTypeJSON;
  quantity: number;
  price: string | null;
  useDefaultPrice: boolean;
  allowPriceOverride: boolean;
  hasLimitedQuantity: boolean;
  isChargeable: boolean;
  claimMode: OfferingClaimModeValue;
  claimStartDate: string | null;
  claimEndDate: string | null;
  status: "OPEN" | "FULL" | "STOPPED" | "CLOSED";
  note: string | null;
};

export type FloralOfferingSlotJSON = {
  id: string;
  activityOfferingId: string;
  lunarMonth: number;
  lunarDay: number;
  isLeapMonth: boolean;
  sortOrder: number;
  isActive: boolean;
  priceOverride: string | null;
  note: string | null;
};

export type OfferingClaimJSON = {
  id: string;
  activityId: string;
  activityOfferingId: string;
  offeringTypeId: string;
  floralSlotId: string | null;
  year: number;
  sponsorMemberId: string;
  sponsorHouseholdId: string;
  sponsorNameSnapshot: string;
  phoneSnapshot: string | null;
  quantity: number;
  unitPrice: string | null;
  amountDue: string;
  amountPaid: string;
  amountUnpaid: string;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID" | "WAIVED";
  receiptStatus: "NOT_ISSUED" | "ISSUED" | "REPRINTED";
  expectedPaymentDate: string | null;
  collectionNote: string | null;
  note: string | null;
  status: "ACTIVE" | "CANCELLED" | "REFUND_PENDING" | "REFUNDED";
  createdAt: string;
};

export type MemberSearchResult = { memberId: string | null; name: string; householdId: string };
