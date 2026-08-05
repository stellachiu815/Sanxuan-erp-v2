/**
 * V36.2：列印物件查詢／補印準備（只讀 server 查詢）。
 *
 * ⚠️ 全程**只讀**：不寫入 printedAt／lastPrintedAt／printCount，不改作業編號，不建列印批次，
 *    不改任何報名／財務資料。
 *
 * 沿用既有查詢與規則，不建立第二套列印物件或快照表：
 *   - listPrintItemsForPrintCenter()：一列一個 AdditionalPrintItem 列印物件（TABLET／POCKET），
 *     已內含 No.xxx（workOrder ?? registrationOrder）、resolveRitualDisplayName 主文、
 *     既定地址規則、printCount／firstPrintedAt／lastPrintedAt。
 *   - previewRouteForPrintObject()：既有唯讀正式列印預覽路由。
 * 僅以「最小只讀查詢」補既有 view 未帶出的欄位：活動名稱、報名人、報名狀態、建立時間。
 * 最後依 quantity 展開成「一物件一列」（expandPrintObjects）。
 */
import { prisma } from "@/lib/prisma";
import { listPrintItemsForPrintCenter } from "@/lib/additionalPrintItems";
import { previewRouteForPrintObject } from "@/lib/printPreviewRoutes";
import { expandPrintObjects, type PrintObjectBase, type PrintObjectRow } from "@/lib/printObjectRosterFilter";

/** 列印品類型 → 篩選 key 與中文標籤。牌位依牌位分類，寶袋為 POCKET。 */
function resolveType(itemType: string, sourceCategory: string, sourceCategoryLabel: string): { typeKey: string; typeLabel: string } {
  if (itemType === "TABLET") return { typeKey: `TABLET:${sourceCategory}`, typeLabel: `牌位・${sourceCategoryLabel}` };
  if (itemType === "POCKET") return { typeKey: "POCKET", typeLabel: "寶袋" };
  return { typeKey: itemType, typeLabel: itemType };
}

/** 只讀：某年度普渡所有列印物件（依 quantity 展開為一物件一列）。 */
export async function listPrintObjectsForReprintConsole(year: number): Promise<PrintObjectRow[]> {
  // 1) 沿用既有列印物件查詢（一列一個列印物件）。
  const views = await listPrintItemsForPrintCenter(year, {});
  if (views.length === 0) return [];

  // 2) 最小只讀補齊：activityId／memberId／ritualRecordId／createdAt（view 未帶出）。
  const ids = views.map((v) => v.id);
  const meta = await prisma.additionalPrintItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, activityId: true, memberId: true, ritualRecordId: true, createdAt: true, printedQuantity: true },
  });
  const metaById = new Map(meta.map((m) => [m.id, m]));

  const activityIds = [...new Set(meta.map((m) => m.activityId).filter((x): x is string => !!x))];
  const memberIds = [...new Set(meta.map((m) => m.memberId).filter((x): x is string => !!x))];
  const ritualRecordIds = [...new Set(meta.map((m) => m.ritualRecordId).filter((x): x is string => !!x))];

  const [events, members, records] = await Promise.all([
    activityIds.length ? prisma.templeEvent.findMany({ where: { id: { in: activityIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    memberIds.length ? prisma.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ritualRecordIds.length
      ? prisma.ritualRecord.findMany({
          where: { id: { in: ritualRecordIds } },
          select: { id: true, status: true, participants: { where: { deletedAt: null }, select: { nameSnapshot: true }, orderBy: { createdAt: "asc" }, take: 1 } },
        })
      : Promise.resolve([]),
  ]);
  const eventName = new Map(events.map((e) => [e.id, e.name]));
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const recordById = new Map(records.map((r) => [r.id, r]));

  // 3) 組成基底，套用既有預覽路由；再依 quantity 展開為一物件一列。
  const bases: PrintObjectBase[] = views.map((v) => {
    const m = metaById.get(v.id);
    const rec = m?.ritualRecordId ? recordById.get(m.ritualRecordId) : undefined;
    const registrantName =
      (m?.memberId ? memberName.get(m.memberId) : null) ?? rec?.participants?.[0]?.nameSnapshot ?? v.household.name ?? "（未指定）";
    const activityName = (m?.activityId ? eventName.get(m.activityId) : null) ?? `民國 ${year} 年中元普渡`;
    const { typeKey, typeLabel } = resolveType(v.itemType, v.sourceCategory, v.sourceCategoryLabel);
    const preview = previewRouteForPrintObject({
      itemKey: v.itemType,
      contentKind: v.itemType,
      householdId: v.household.id,
      year,
    });
    return {
      objectId: v.id,
      workNo: v.registrationOrder,
      activityName,
      itemType: v.itemType,
      typeKey,
      typeLabel,
      householdId: v.household.id,
      householdCode: v.household.id,
      householdName: v.household.name,
      registrantName,
      mainText: v.printMainText || v.sourceDisplayName,
      yangshang: v.sourceYangshangNames,
      address: v.sourceLocation,
      firstPrintedAt: v.firstPrintedAt,
      lastPrintedAt: v.lastPrintedAt,
      printCount: v.printCount,
      quantity: v.quantity,
      printedQuantity: Number(m?.printedQuantity ?? v.printedQuantity ?? 0),
      reportStatus: rec?.status ?? "—",
      createdAt: m?.createdAt ? new Date(m.createdAt).toISOString() : "",
      previewHref: preview.href,
    };
  });

  return expandPrintObjects(bases);
}
