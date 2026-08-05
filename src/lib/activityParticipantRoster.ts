/**
 * V36.1：活動參加名單（只讀）——以「每一筆實際報名項目」為列表主體。
 *
 * ⚠️ 全程**只讀**：只 SELECT，不新增/修改/刪除任何資料，不回寫地址，不重算金額。
 *    優先沿用既有資料表與欄位：
 *      - RitualRegistrationItem（報名項目本體：數量、應收/已收/未收、狀態、列印次數、workOrder/registrationOrder）
 *      - UniversalSalvationEntry（牌位主文、陽上人、每筆已保存牌位地址）
 *      - Household / Member（家戶編號・戶名・報名人・個人地址）
 *      - TempleEvent（活動名稱）
 *      - 既有 workOrder / registrationOrder（作業編號 = printNumberOf(workOrder, registrationOrder)）
 *    不建立第二套名單資料表、不複製快照、不用家戶摘要取代每筆項目。
 *
 * 目前涵蓋普渡（UNIVERSAL_SALVATION）——牌位／寶袋／白米／贊普等每筆報名項目，
 * 這正是需求欄位（牌位/寶袋/陽上人/地址/作業編號）所描述的範疇。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { printNumberOf } from "@/lib/workOrder";
import { resolveYangshangNames } from "@/lib/yangshang";
import { resolveRitualDisplayName } from "@/lib/ritualDisplayName";
import { listPrintItemsForPrintCenter } from "@/lib/additionalPrintItems";
import type { ParticipantItemRow } from "@/lib/activityParticipantRosterFilter";

// 型別與純函式篩選／排序集中於 prisma-free 模組（client／測試安全）；此處只放 server 端查詢。
export type { ParticipantItemRow, ParticipantFilters } from "@/lib/activityParticipantRosterFilter";
export { filterAndSortParticipantRows } from "@/lib/activityParticipantRosterFilter";

/** 只讀查詢：普渡某年度的每一筆報名項目（不合併家戶）。 */
export async function listUniversalSalvationParticipantItems(year: number): Promise<ParticipantItemRow[]> {
  const items = await prisma.ritualRegistrationItem.findMany({
    where: { deletedAt: null, ritualRecord: { is: { activityType: "UNIVERSAL_SALVATION", year, deletedAt: null } } },
    select: {
      id: true,
      quantity: true,
      amountDue: true,
      amountPaid: true,
      amountUnpaid: true,
      status: true,
      createdAt: true,
      customName: true,
      universalSalvationEntryId: true,
      member: { select: { name: true, address: true } },
      registrationItemType: { select: { key: true, name: true } },
      ritualRecord: {
        select: {
          household: { select: { id: true, name: true, contactName: true, address: true } },
          templeEvent: { select: { name: true } },
          participants: { where: { deletedAt: null }, select: { nameSnapshot: true }, orderBy: { createdAt: "asc" }, take: 1 },
        },
      },
      universalSalvationEntry: {
        select: {
          category: true,
          displayName: true,
          yangshangNames: true,
          yangshangName: true,
          tabletAddress: true,
          worshipRecord: { select: { location: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // V36.7：牌位（有 universalSalvationEntryId 者）一律以 V34 同一支 listPrintItemsForPrintCenter 的
  //   「有效牌位集合」為準（已排除封存牌位／取消 RRI，與 V34／Print Center／Roster 一致）；
  //   非牌位項目（白米／贊普／寶袋，universalSalvationEntryId 為 null）維持逐筆呈現，不受影響。
  const validTabletEntryIds = new Set(
    (await listPrintItemsForPrintCenter(year, {})).filter((v) => v.itemType === "TABLET").map((v) => v.sourceEntryId)
  );
  const scoped = items.filter((it) => it.universalSalvationEntryId == null || validTabletEntryIds.has(it.universalSalvationEntryId));

  // workOrder / registrationOrder / printCount / printedAt 以 raw SQL 取（比照既有列印中心：這些欄位以 raw 存取）。
  const ids = scoped.map((i) => i.id);
  const rawRows = ids.length
    ? await prisma.$queryRaw<{ id: string; wo: number | null; ro: number | null; pc: number | null; pat: Date | null }[]>`
        SELECT "id", "workOrder" AS wo, "registrationOrder" AS ro, "printCount" AS pc, "printedAt" AS pat
        FROM "ritual_registration_items" WHERE "id" IN (${Prisma.join(ids)})`
    : [];
  const rawById = new Map(rawRows.map((r) => [r.id, r]));

  return scoped.map((it) => {
    const raw = rawById.get(it.id);
    const hh = it.ritualRecord?.household;
    const entry = it.universalSalvationEntry;

    // 地址（沿用既有資料、不回寫）：每筆已保存牌位地址 → 個人地址 → 家戶地址。
    let address: string | null = null;
    let addressSource: ParticipantItemRow["addressSource"] = "無";
    if (entry?.tabletAddress) { address = entry.tabletAddress; addressSource = "牌位地址"; }
    else if (it.member?.address) { address = it.member.address; addressSource = "個人地址"; }
    else if (hh?.address) { address = hh.address; addressSource = "家戶地址"; }

    const content = entry
      ? resolveRitualDisplayName(entry.category, entry.displayName)
      : (it.customName ?? it.registrationItemType?.name ?? "（報名項目）");

    const registrantName =
      it.member?.name ?? it.ritualRecord?.participants?.[0]?.nameSnapshot ?? hh?.contactName ?? "（未指定）";

    return {
      itemId: it.id,
      workNo: printNumberOf(raw?.wo ?? null, raw?.ro ?? null),
      activityName: it.ritualRecord?.templeEvent?.name ?? `民國 ${year} 年中元普渡`,
      itemTypeKey: it.registrationItemType?.key ?? "",
      itemTypeName: it.registrationItemType?.name ?? "（未分類）",
      householdCode: hh?.id ?? "",
      householdName: hh?.name ?? "",
      registrantName,
      content,
      yangshang: entry ? resolveYangshangNames(entry.yangshangNames, entry.yangshangName) : [],
      address,
      addressSource,
      quantity: it.quantity,
      amountDue: Number(it.amountDue),
      amountPaid: Number(it.amountPaid),
      amountUnpaid: Number(it.amountUnpaid),
      status: it.status,
      printCount: Number(raw?.pc ?? 0),
      printedAt: raw?.pat ? new Date(raw.pat).toISOString() : null,
      createdAt: new Date(it.createdAt).toISOString(),
    };
  });
}
