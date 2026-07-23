import { fetchRegistration } from "@/lib/registrationFetch";

/**
 * V14.2：累世冤親債主「每位成員各一筆」的**共用**批次建立邏輯。
 *
 * 信眾入口（NewActivityRegistrationDialog）與家戶入口（UniversalSalvationScreen）
 * 共用同一套：一律組成 per-member 的 US_YUANQIN 報名項目，打同一支
 * POST /api/registrations/batch（registerItemsBatch）。不複製流程、不建第二套。
 * 冪等由 registerItemsBatch 保證（同一 RitualRecord+itemType+成員 不重複建立）。
 */

export type BatchEntry = {
  memberId: string;
  registrationItemTypeId: string;
  year: number;
  quantity: number;
};

/** 依成員清單組出 US_YUANQIN 的 batch entries（每位一筆）。 */
export function buildDebtCreditorEntries(
  memberIds: string[],
  year: number,
  yuanqinItemTypeId: string
): BatchEntry[] {
  return memberIds.map((memberId) => ({
    memberId,
    registrationItemTypeId: yuanqinItemTypeId,
    year,
    quantity: 1,
  }));
}

export type DebtCreditorBatchResult = {
  ok: boolean;
  status: number;
  editorUrl?: string;
  alreadyExists: number;
  created: number;
  error?: string;
};

/** 送出 US_YUANQIN 批次（家戶入口用的獨立呼叫；信眾入口在其合併送出中共用 buildDebtCreditorEntries）。 */
export async function submitDebtCreditorBatch(
  memberIds: string[],
  year: number,
  yuanqinItemTypeId: string
): Promise<DebtCreditorBatchResult> {
  const entries = buildDebtCreditorEntries(memberIds, year, yuanqinItemTypeId);
  const res = await fetchRegistration(`/api/registrations/batch`, {
    method: "POST",
    body: JSON.stringify({ entries }),
  });
  const data = await res.json().catch(() => null);
  const outcomes: { outcome: string }[] = data?.outcomes ?? [];
  return {
    ok: res.ok,
    status: res.status,
    editorUrl: data?.editorUrl,
    alreadyExists: outcomes.filter((o) => o.outcome === "ALREADY_EXISTS").length,
    created: outcomes.filter((o) => o.outcome === "CREATED").length,
    error: res.ok ? undefined : data?.error,
  };
}
