import { prisma } from "@/lib/prisma";
import { getZodiacByLunarYear, solarToLunar } from "@/lib/lunar";
import type { NormalizedDevoteeRow } from "@/lib/devoteeImportValidate";

/**
 * V11.3「信眾資料匯入預檢中心」——重複資料判斷（需求「第六步」）。
 *
 * ⚠️ 核心原則（逐字對應需求）：不得只用姓名判定重複；只要無法百分之百
 * 確認，一律回傳「疑似重複」候選給呼叫端顯示，由人工判斷；這支函式本身
 * 「不會」自動覆蓋、自動合併，也不會刪除或略過任何資料——它只負責回答
 * 「有沒有可能是同一人／同一戶」，實際要不要匯入永遠是呼叫端／使用者的
 * 決定（見 devoteeImportBatch.ts 的 resolutionDecision 機制）。
 *
 * 候選結果刻意「不落地保存」（需求確認④）：每次呼叫都是即時查詢目前資料庫
 * 內容，不會把比對結果寫進 ImportRow——已完成（COMMITTED）的批次不會再
 * 呼叫這支函式，直接顯示當時真正執行的結果（見 devoteeImportBatch.ts）。
 */

export type DuplicateCandidateTier = "HIGH" | "MEDIUM";

export type DuplicateCandidate = {
  tier: DuplicateCandidateTier;
  reasons: string[]; // 判斷依據（可能同時符合多個規則）
  existingHouseholdId: string;
  existingHouseholdName: string;
  existingMemberId: string | null; // null＝只比對到「家戶」層級（原系統編號相同），還沒有同名成員
  existingMemberName: string | null;
};

function lastDigits(phone: string | null, n = 4): string | null {
  if (!phone) return null;
  return phone.length >= n ? phone.slice(-n) : phone;
}

function sameUtcDate(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

/** 沿用既有 lunar.ts 換算：從國曆生日或農曆年份算出生肖，兩者都沒有就回傳 null。 */
function computeZodiac(solarBirthDate: Date | null, lunarBirthYear: number | null): string | null {
  if (solarBirthDate) return getZodiacByLunarYear(solarToLunar(solarBirthDate).year);
  if (lunarBirthYear) return getZodiacByLunarYear(lunarBirthYear);
  return null;
}

async function queryExistingMembersByName(name: string) {
  return prisma.member.findMany({
    where: { name, deletedAt: null, household: { deletedAt: null } },
    include: { household: true, devoteeProfile: { select: { mobile: true } } },
  });
}

export async function findDuplicateCandidates(row: NormalizedDevoteeRow): Promise<DuplicateCandidate[]> {
  const { household, member } = row;
  if (!member.name) return []; // 沒有姓名的列會被歸類成「資料不完整」，不會走到這裡

  const byKey = new Map<string, DuplicateCandidate>();

  function addReason(
    key: string,
    base: Omit<DuplicateCandidate, "reasons" | "tier">,
    tier: DuplicateCandidateTier,
    reason: string
  ) {
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      if (tier === "HIGH") existing.tier = "HIGH";
    } else {
      byKey.set(key, { ...base, tier, reasons: [reason] });
    }
  }

  const rowZodiac = computeZodiac(member.solarBirthDate, member.lunarBirthYear);
  const rowPhoneTail = lastDigits(household.phone) ?? lastDigits(household.mobile);

  const sameNameMembers = await queryExistingMembersByName(member.name);

  for (const m of sameNameMembers) {
    const base = {
      existingHouseholdId: m.householdId,
      existingHouseholdName: m.household.name,
      existingMemberId: m.id,
      existingMemberName: m.name,
    };

    // 高相似度：姓名＋電話（含手機／信眾延伸資料手機，三個來源都比對）
    const existingPhones = [m.household.phone, m.household.mobile, m.devoteeProfile?.mobile].filter(
      (v): v is string => !!v
    );
    if ((household.phone && existingPhones.includes(household.phone)) || (household.mobile && existingPhones.includes(household.mobile))) {
      addReason(m.id, base, "HIGH", "姓名＋電話相同");
    }

    // 高相似度：姓名＋國曆生日
    if (member.solarBirthDate && m.solarBirthDate && sameUtcDate(member.solarBirthDate, m.solarBirthDate)) {
      addReason(m.id, base, "HIGH", "姓名＋國曆生日相同");
    }

    // 高相似度：姓名＋農曆生日＋地址
    if (
      member.lunarBirthYear &&
      m.lunarBirthYear === member.lunarBirthYear &&
      m.lunarBirthMonth === member.lunarBirthMonth &&
      m.lunarBirthDay === member.lunarBirthDay &&
      household.address &&
      m.household.address === household.address
    ) {
      addReason(m.id, base, "HIGH", "姓名＋農曆生日＋地址相同");
    }

    // 高相似度：姓名＋地址＋同戶主要聯絡人
    const sameAddress = Boolean(household.address && m.household.address === household.address);
    const sameContact = Boolean(household.contactName && m.household.contactName === household.contactName);
    if (sameAddress && sameContact) {
      addReason(m.id, base, "HIGH", "姓名＋地址＋主要聯絡人相同");
    } else if (sameAddress) {
      // 中相似度：只有姓名＋地址相同（沒有同時符合聯絡人），訊號比較弱
      addReason(m.id, base, "MEDIUM", "姓名＋地址相同");
    }

    // 中相似度：姓名＋生肖＋電話尾碼
    if (rowZodiac && rowPhoneTail) {
      const existingZodiac = computeZodiac(m.solarBirthDate, m.lunarBirthYear);
      const existingPhoneTail = lastDigits(m.household.phone) ?? lastDigits(m.household.mobile);
      if (existingZodiac && existingZodiac === rowZodiac && existingPhoneTail && existingPhoneTail === rowPhoneTail) {
        addReason(m.id, base, "MEDIUM", "姓名＋生肖＋電話尾碼相同");
      }
    }
  }

  // 高相似度：原系統唯一編號完全相同（家戶層級，即使還沒有同名成員也成立——
  // 代表這個戶號本身已經被別人用掉了，需要人工確認是否為同一戶）。
  if (household.code) {
    const existingHousehold = await prisma.household.findFirst({ where: { id: household.code, deletedAt: null } });
    if (existingHousehold) {
      const key = `household:${existingHousehold.id}`;
      addReason(
        key,
        {
          existingHouseholdId: existingHousehold.id,
          existingHouseholdName: existingHousehold.name,
          existingMemberId: null,
          existingMemberName: null,
        },
        "HIGH",
        `原系統唯一編號「${household.code}」在資料庫已經存在同一戶`
      );
    }
  }

  // 中相似度：同姓名且同一戶——如果上面已經用「原系統編號相同」比對到這一戶，
  // 且該戶剛好有同名成員，補上這個較白話的理由（不會另外產生新的候選項目）。
  if (household.code) {
    const key = `household:${household.code}`;
    const householdLevelCandidate = byKey.get(key);
    if (householdLevelCandidate) {
      const sameHouseholdSameName = sameNameMembers.find((m) => m.householdId === household.code);
      if (sameHouseholdSameName) {
        // 這一戶內已經有同名成員：把家戶層級候選跟成員層級候選合併成同一筆，
        // 避免畫面同時顯示「這戶已存在」跟「這個人已存在」兩筆看起來不相關的候選。
        byKey.delete(key);
        addReason(
          sameHouseholdSameName.id,
          {
            existingHouseholdId: sameHouseholdSameName.householdId,
            existingHouseholdName: sameHouseholdSameName.household.name,
            existingMemberId: sameHouseholdSameName.id,
            existingMemberName: sameHouseholdSameName.name,
          },
          "HIGH",
          "同姓名且同一戶（原系統編號相同）"
        );
      }
    }
  }

  return Array.from(byKey.values());
}
