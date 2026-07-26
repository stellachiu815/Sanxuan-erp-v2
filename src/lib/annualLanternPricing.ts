import { prisma, type DbClient } from "@/lib/prisma";

/**
 * V15R5：年度燈「祭改／全家燈」年度單價的唯一讀取／寫入層。
 *
 * 價格來源＝ANNUAL_LANTERN TempleEvent 上的 per-year 欄位
 * （purificationUnitPrice／familyLanternUnitPrice），與 sponsorUnitPrice／
 * pocketUnitPrice 同一套結構，不是第二套價格表。未設定（null）時該項應收為 0
 * （不寫死金額）。收款寫入一律走既有金流：全家燈→RitualRegistrationItem.amountDue；
 * 祭改→PurificationEntry.feeStatus/amountDue。以正規 Prisma Client 欄位存取
 * （`prisma generate` 後型別即含這兩個欄位）。
 */
export type AnnualLanternPrices = {
  purificationUnitPrice: number | null;
  familyLanternUnitPrice: number | null;
};

export async function getAnnualLanternPrices(
  year: number,
  client: DbClient = prisma
): Promise<AnnualLanternPrices> {
  const event = await client.templeEvent.findUnique({
    where: { activityType_year: { activityType: "ANNUAL_LANTERN", year } },
    select: { purificationUnitPrice: true, familyLanternUnitPrice: true },
  });
  return {
    purificationUnitPrice: event?.purificationUnitPrice != null ? Number(event.purificationUnitPrice) : null,
    familyLanternUnitPrice: event?.familyLanternUnitPrice != null ? Number(event.familyLanternUnitPrice) : null,
  };
}

/** 更新年度燈祭改／全家燈單價（正規 Prisma Client 欄位；只帶入的欄位才更新）。 */
export async function updateAnnualLanternPrices(
  eventId: string,
  input: { purificationUnitPrice?: number | null; familyLanternUnitPrice?: number | null },
  client: DbClient = prisma
): Promise<void> {
  const data: { purificationUnitPrice?: number | null; familyLanternUnitPrice?: number | null } = {};
  if ("purificationUnitPrice" in input) data.purificationUnitPrice = input.purificationUnitPrice ?? null;
  if ("familyLanternUnitPrice" in input) data.familyLanternUnitPrice = input.familyLanternUnitPrice ?? null;
  if (Object.keys(data).length === 0) return;
  await client.templeEvent.update({ where: { id: eventId }, data });
}
