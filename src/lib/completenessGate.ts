import { prisma } from "@/lib/prisma";
import { listRegisteredItems } from "@/lib/registrationItemRegistration";
import { solarToLunar } from "@/lib/lunar";
import {
  checkUniversalSalvationItem,
  checkAnnualLantern,
  checkDragonPhoenixLantern,
  combineCompleteness,
  resolveLunarAvailable,
  type CompletenessResult,
} from "@/lib/dataCompleteness";

/**
 * V15R3：以資料完整度驗證判斷「一筆報名（RitualRecord）」是否可正式確認／正式列印。
 *
 * **純讀取**——用 listRegisteredItems（已純化、不寫入）取各項目，逐項套既有 dataCompleteness
 * 規則後彙總（不建第二套規則）：
 *   - 普渡各項目 → checkUniversalSalvationItem
 *   - 年度燈（LANTERN_*／PURIFICATION）→ checkAnnualLantern（姓名／農曆生日可取得／地址／生肖／性別）
 *   - 龍鳳燈（DRAGON_PHOENIX）→ checkDragonPhoenixLantern（姓名／地址／農曆生日／生肖／燈種）
 * 年度燈／龍鳳燈的信眾資料（生日／性別／地址）以 memberId 讀 Member＋Household；
 * 農曆生日「可取得」＝直接有農曆，或有國曆且 solarToLunar 換算成功（規則六）。
 * 生肖以「可推得出生年」為準（直接農曆年或國曆年皆可推）；缺出生年 → 缺生肖。
 * 非列管項目視為完整、不誤擋；CANCELLED／舊資料唯讀列不納入。
 */
function isLanternKey(key: string): boolean {
  return key.startsWith("LANTERN_") || key === "DRAGON_PHOENIX";
}

export async function checkRitualRecordCompleteness(ritualRecordId: string): Promise<CompletenessResult> {
  const items = await listRegisteredItems(ritualRecordId);
  const active = items.filter((it) => it.status !== "CANCELLED" && !it.readOnlyLegacy);

  // 年度燈／龍鳳燈需信眾資料——一次撈齊（非 N+1）。
  const lanternMemberIds = [
    ...new Set(active.filter((it) => isLanternKey(it.itemKey)).map((it) => it.memberId).filter((x): x is string => !!x)),
  ];
  const members = lanternMemberIds.length
    ? await prisma.member.findMany({
        where: { id: { in: lanternMemberIds } },
        select: {
          id: true, name: true, gender: true,
          solarBirthDate: true, lunarBirthYear: true, lunarBirthMonth: true, lunarBirthDay: true,
          household: { select: { address: true } },
        },
      })
    : [];
  const memberMap = new Map(members.map((m) => [m.id, m]));

  const results = active.map((it) => {
    if (isLanternKey(it.itemKey)) {
      const m = it.memberId ? memberMap.get(it.memberId) ?? null : null;
      const hasLunarBirth = !!(m?.lunarBirthMonth && m?.lunarBirthDay);
      const hasSolarBirth = !!m?.solarBirthDate;
      // 國曆→農曆換算是否成功（有效日期即成功；防呆 try/catch）。
      let solarToLunarOk = false;
      if (hasSolarBirth && m?.solarBirthDate) {
        try { solarToLunar(m.solarBirthDate); solarToLunarOk = true; } catch { solarToLunarOk = false; }
      }
      const lunarBirthResolved = resolveLunarAvailable({ hasLunarBirth, hasSolarBirth, solarToLunarOk });
      // 生肖：可推出生年即視為可得（直接農曆年或國曆年）。
      const birthYearKnown = !!(m?.lunarBirthYear || (m?.solarBirthDate && m.solarBirthDate.getUTCFullYear()));
      const subject = {
        name: m?.name ?? null,
        lunarBirthResolved,
        address: m?.household?.address ?? null,
        zodiac: birthYearKnown ? "可推得" : null,
        gender: m?.gender ?? null,
        lanternKind: it.itemName, // 已報名的燈種名稱
      };
      return it.itemKey === "DRAGON_PHOENIX" ? checkDragonPhoenixLantern(subject) : checkAnnualLantern(subject);
    }
    return checkUniversalSalvationItem(it.itemKey, {
      yangshangNames: it.yangshangNames,
      tabletAddress: it.tabletAddress,
      purchaserName: it.contentKind === "RICE" ? it.memberName : null,
      weightKg: it.contentKind === "RICE" ? it.quantity : null,
      sponsorName: it.contentKind === "SPONSOR" ? (it.customName ?? it.memberName) : null,
      amount: it.contentKind === "SPONSOR" ? it.amountDue : null,
    });
  });
  return combineCompleteness(results);
}

/** 結構化不完整回應（供 API 直接回傳）。 */
export function incompleteDataPayload(result: CompletenessResult): { code: "INCOMPLETE_DATA"; message: string; missingFields: string[] } {
  return {
    code: "INCOMPLETE_DATA",
    message: "資料尚未完整",
    missingFields: result.missing.map((m) => m.label),
  };
}

/**
 * V15R3：批次列印用——檢查多筆報名的完整度，回每筆缺項與整體是否可列印。
 * 任一筆不完整 → allComplete=false（呼叫端整批擋、回 422、每筆列缺項；不寫任何列印紀錄）。
 */
export async function checkRitualRecordsCompleteness(
  ritualRecordIds: string[]
): Promise<{ allComplete: boolean; incompleteRecords: { ritualRecordId: string; missingFields: string[] }[]; missingFields: string[] }> {
  const unique = [...new Set(ritualRecordIds)];
  const incompleteRecords: { ritualRecordId: string; missingFields: string[] }[] = [];
  const allMissing = new Set<string>();
  for (const id of unique) {
    const r = await checkRitualRecordCompleteness(id);
    if (!r.complete) {
      const labels = r.missing.map((m) => m.label);
      incompleteRecords.push({ ritualRecordId: id, missingFields: labels });
      for (const l of labels) allMissing.add(l);
    }
  }
  return { allComplete: incompleteRecords.length === 0, incompleteRecords, missingFields: [...allMissing] };
}

/** 給定普渡列印物件 ids，取其所屬的 ritualRecordId（純讀取）。 */
export async function ritualRecordIdsForPrintObjects(printObjectIds: string[]): Promise<string[]> {
  if (printObjectIds.length === 0) return [];
  const rows = await prisma.additionalPrintItem.findMany({
    where: { id: { in: printObjectIds } },
    select: { ritualRecordId: true },
  });
  return [...new Set(rows.map((r) => r.ritualRecordId).filter((x): x is string => !!x))];
}

/** 給定某項目 key＋年度的總名單，取其涵蓋的（已確認）ritualRecordId（純讀取）。 */
export async function ritualRecordIdsForRoster(itemKey: string, year: number): Promise<string[]> {
  const rows = await prisma.ritualRegistrationItem.findMany({
    where: {
      deletedAt: null,
      status: "CONFIRMED",
      registrationItemType: { key: itemKey },
      ritualRecord: { deletedAt: null, status: "CONFIRMED", year },
    },
    select: { ritualRecordId: true },
  });
  return [...new Set(rows.map((r) => r.ritualRecordId))];
}
