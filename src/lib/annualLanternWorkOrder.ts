/**
 * V41 年度燈「正式作業編號」清單（照燈別：光明燈／太歲燈／祭改／全家燈各自 1..N）。
 *
 * 普渡的 listWorkOrderRows 綁牌位（universalSalvationEntry）與列印物件（additional_print_items），
 * 年度燈沒有這些，故另開本支專用清單；**存檔沿用通用的 saveWorkOrders**（同一張 ritual_registration_items，
 * 同一組 (templeEventId, registrationItemTypeId, workOrder) 唯一約束、兩階段存檔、重號檢查皆共用）。
 * 列印狀態讀 item.printCount（年度燈燈牌列印流程更新該欄）。
 */
import { prisma } from "@/lib/prisma";
import type { WorkOrderRow } from "@/lib/workOrderRepo";

export const ANNUAL_LANTERN_LAMP_KEYS = ["LANTERN_GUANGMING", "LANTERN_TAISUI", "LANTERN_PURIFICATION", "LANTERN_FAMILY"] as const;
const LAMP_LABELS: Record<string, string> = {
  LANTERN_GUANGMING: "光明燈",
  LANTERN_TAISUI: "太歲燈",
  LANTERN_PURIFICATION: "祭改",
  LANTERN_FAMILY: "全家燈",
};
export function annualLanternLampLabel(key: string): string {
  return LAMP_LABELS[key] ?? key;
}
export function isAnnualLanternLampKey(key: string): boolean {
  return (ANNUAL_LANTERN_LAMP_KEYS as readonly string[]).includes(key);
}

/** 某年度、某燈別的所有報名（含取消，取消於歷史區、不占新號）。排序：workOrder 優先，其餘照建立先後。 */
export async function listAnnualLanternWorkOrderRows(year: number, lampKey: string): Promise<WorkOrderRow[]> {
  const rows = await prisma.$queryRaw<{
    id: string; ro: number | null; wo: number | null; key: string; name: string;
    member: string | null; household: string; status: string; printcount: number; printedat: Date | null;
  }[]>`
    SELECT rri."id", rri."registrationOrder" AS ro, rri."workOrder" AS wo,
           rit."key", rit."name", m."name" AS member, h."name" AS household,
           rri."status", rri."printCount" AS printcount, rri."printedAt" AS printedat
    FROM "ritual_registration_items" rri
    JOIN "registration_item_types" rit ON rit."id" = rri."registrationItemTypeId"
    JOIN "ritual_records" rr ON rr."id" = rri."ritualRecordId"
    JOIN "households" h ON h."id" = rr."householdId"
    LEFT JOIN "members" m ON m."id" = rri."memberId"
    WHERE rr."year" = ${year} AND rr."deletedAt" IS NULL AND h."deletedAt" IS NULL
      AND rri."deletedAt" IS NULL AND rit."key" = ${lampKey}
    ORDER BY (rri."workOrder" IS NULL), rri."workOrder", rri."registrationOrder", rri."createdAt"`;
  return rows.map((r) => ({
    id: r.id,
    registrationOrder: r.ro,
    workOrder: r.wo,
    itemKey: r.key,
    itemName: r.name,
    subject: (r.member ?? "").trim(),
    household: r.household,
    yangshang: "", // 年度燈是本人點燈，無陽上人
    status: r.status,
    printCount: r.printcount ?? 0,
    printedAt: r.printedat ? r.printedat.toISOString() : null,
  }));
}
