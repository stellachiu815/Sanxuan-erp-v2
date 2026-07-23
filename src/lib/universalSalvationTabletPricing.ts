import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * V14.2：中元普渡「四類牌位」年度單價的**唯一對照與讀取層**。
 *
 * 價格來源＝TempleEvent 上的 per-year 欄位（與 pocketUnitPrice／sponsorUnitPrice
 * 同一套結構），不是 item type 的全域 defaultUnitPrice，也不是第二套價格表。
 *
 * 對照（RegistrationItemType.key → TempleEvent 欄位）：
 *   US_ANCESTOR → ancestorUnitPrice（超拔祖先）
 *   US_ZHENGHUN → zhenghunUnitPrice（乙位正魂）
 *   US_YUANQIN  → yuanqinUnitPrice （累世冤親債主）
 *   US_WUYUAN   → wuyuanUnitPrice  （無緣子女）
 *
 * 程式只認 key，數字全部是資料；未設定（null）時價格視為未定，建立報名該項
 * 應收為 0（不寫死金額）。
 */

export type UniversalSalvationTabletPriceField =
  | "ancestorUnitPrice"
  | "zhenghunUnitPrice"
  | "yuanqinUnitPrice"
  | "wuyuanUnitPrice";

/** RegistrationItemType.key → TempleEvent 單價欄位。非四類牌位回 null。 */
export const UNIVERSAL_SALVATION_TABLET_PRICE_FIELD: Record<
  string,
  UniversalSalvationTabletPriceField
> = {
  US_ANCESTOR: "ancestorUnitPrice",
  US_ZHENGHUN: "zhenghunUnitPrice",
  US_YUANQIN: "yuanqinUnitPrice",
  US_WUYUAN: "wuyuanUnitPrice",
};

/** 這個項目 key 是否屬於「四類牌位」（有年度單價）。 */
export function isUniversalSalvationTabletKey(key: string): boolean {
  return key in UNIVERSAL_SALVATION_TABLET_PRICE_FIELD;
}

type TabletPriceRow = {
  ancestorUnitPrice: Prisma.Decimal | null;
  zhenghunUnitPrice: Prisma.Decimal | null;
  yuanqinUnitPrice: Prisma.Decimal | null;
  wuyuanUnitPrice: Prisma.Decimal | null;
};

/** 一筆 TempleEvent 的四類單價（number｜null；null=尚未設定）。 */
export type TabletUnitPrices = Record<UniversalSalvationTabletPriceField, number | null>;

function toPrices(row: TabletPriceRow | null): TabletUnitPrices {
  return {
    ancestorUnitPrice: row?.ancestorUnitPrice != null ? Number(row.ancestorUnitPrice) : null,
    zhenghunUnitPrice: row?.zhenghunUnitPrice != null ? Number(row.zhenghunUnitPrice) : null,
    yuanqinUnitPrice: row?.yuanqinUnitPrice != null ? Number(row.yuanqinUnitPrice) : null,
    wuyuanUnitPrice: row?.wuyuanUnitPrice != null ? Number(row.wuyuanUnitPrice) : null,
  };
}

const PRICE_SELECT = {
  ancestorUnitPrice: true,
  zhenghunUnitPrice: true,
  yuanqinUnitPrice: true,
  wuyuanUnitPrice: true,
} as const;

/**
 * 取某年度中元普渡活動的四類牌位單價。查不到活動回全 null。
 * 可傳交易 client（建立報名在 $transaction 內呼叫）。
 */
export async function getUniversalSalvationTabletPrices(
  year: number,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<TabletUnitPrices> {
  const row = await client.templeEvent.findUnique({
    where: { activityType_year: { activityType: "UNIVERSAL_SALVATION", year } },
    select: PRICE_SELECT,
  });
  return toPrices(row);
}

/**
 * 依項目 key + 年度單價，取這個四類牌位的單價（number）。
 * 非四類牌位或未設定 → null（呼叫端把 null 當 0，但不寫死任何金額）。
 */
export function tabletUnitPriceFor(key: string, prices: TabletUnitPrices): number | null {
  const field = UNIVERSAL_SALVATION_TABLET_PRICE_FIELD[key];
  if (!field) return null;
  return prices[field];
}
