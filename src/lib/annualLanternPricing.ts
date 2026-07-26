import { prisma, type DbClient } from "@/lib/prisma";

/**
 * V15R5 / V15R5.1：年度燈「四個報名項目」年度單價的**唯一讀取／寫入層**。
 *
 * 價格來源＝ANNUAL_LANTERN TempleEvent 上的 per-year 欄位（與 sponsorUnitPrice／
 * pocketUnitPrice／四類牌位單價同一套結構，不是第二套價格表）。四項各自獨立欄位：
 *   - brightLightUnitPrice ：光明燈（LANTERN_GUANGMING）
 *   - taisuiLightUnitPrice ：太歲燈（LANTERN_TAISUI）
 *   - familyLanternUnitPrice：全家燈（LANTERN_FAMILY）
 *   - purificationUnitPrice ：祭改（LANTERN_PURIFICATION）
 * 未設定（null）時該項應收為 0（不寫死金額）。光明燈／太歲燈**不再讀**全域
 * RegistrationItemType.defaultUnitPrice、不寫死 500。收款一律走既有金流：
 * 光明/太歲/全家燈→RitualRegistrationItem.amountDue；祭改→PurificationEntry.feeStatus/amountDue。
 * 以正規 Prisma Client 欄位存取（`prisma generate` 後型別即含這四個欄位）。
 */
export type AnnualLanternPrices = {
  brightLightUnitPrice: number | null;
  taisuiLightUnitPrice: number | null;
  familyLanternUnitPrice: number | null;
  purificationUnitPrice: number | null;
};

/** 報名項目 key → TempleEvent 年度單價欄位（自身計價的三項；祭改另走 PurificationEntry）。 */
export const ANNUAL_LANTERN_ITEM_PRICE_FIELD = {
  LANTERN_GUANGMING: "brightLightUnitPrice",
  LANTERN_TAISUI: "taisuiLightUnitPrice",
  LANTERN_FAMILY: "familyLanternUnitPrice",
} as const;

export type AnnualLanternItemPriceKey = keyof typeof ANNUAL_LANTERN_ITEM_PRICE_FIELD;

/** 這個項目 key 是否為「自身計價、依年度燈單價」的項目（光明/太歲/全家燈）。 */
export function isAnnualLanternPricedItemKey(key: string): key is AnnualLanternItemPriceKey {
  return key in ANNUAL_LANTERN_ITEM_PRICE_FIELD;
}

/** 依項目 key 取該年度單價（number｜null；null=未設定，呼叫端當 0，不寫死金額）。 */
export function annualLanternItemUnitPrice(key: string, prices: AnnualLanternPrices): number | null {
  if (!isAnnualLanternPricedItemKey(key)) return null;
  return prices[ANNUAL_LANTERN_ITEM_PRICE_FIELD[key]];
}

export async function getAnnualLanternPrices(
  year: number,
  client: DbClient = prisma
): Promise<AnnualLanternPrices> {
  const event = await client.templeEvent.findUnique({
    where: { activityType_year: { activityType: "ANNUAL_LANTERN", year } },
    select: {
      brightLightUnitPrice: true,
      taisuiLightUnitPrice: true,
      familyLanternUnitPrice: true,
      purificationUnitPrice: true,
    },
  });
  return {
    brightLightUnitPrice: event?.brightLightUnitPrice != null ? Number(event.brightLightUnitPrice) : null,
    taisuiLightUnitPrice: event?.taisuiLightUnitPrice != null ? Number(event.taisuiLightUnitPrice) : null,
    familyLanternUnitPrice: event?.familyLanternUnitPrice != null ? Number(event.familyLanternUnitPrice) : null,
    purificationUnitPrice: event?.purificationUnitPrice != null ? Number(event.purificationUnitPrice) : null,
  };
}

export type UpdateAnnualLanternPricesInput = {
  brightLightUnitPrice?: number | null;
  taisuiLightUnitPrice?: number | null;
  familyLanternUnitPrice?: number | null;
  purificationUnitPrice?: number | null;
};

/** 更新年度燈四項目單價（正規 Prisma Client 欄位；只帶入的欄位才更新）。 */
export async function updateAnnualLanternPrices(
  eventId: string,
  input: UpdateAnnualLanternPricesInput,
  client: DbClient = prisma
): Promise<void> {
  const data: UpdateAnnualLanternPricesInput = {};
  if ("brightLightUnitPrice" in input) data.brightLightUnitPrice = input.brightLightUnitPrice ?? null;
  if ("taisuiLightUnitPrice" in input) data.taisuiLightUnitPrice = input.taisuiLightUnitPrice ?? null;
  if ("familyLanternUnitPrice" in input) data.familyLanternUnitPrice = input.familyLanternUnitPrice ?? null;
  if ("purificationUnitPrice" in input) data.purificationUnitPrice = input.purificationUnitPrice ?? null;
  if (Object.keys(data).length === 0) return;
  await client.templeEvent.update({ where: { id: eventId }, data });
}
