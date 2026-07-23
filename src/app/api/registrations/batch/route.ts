import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { registerItemsBatch, type BatchItemEntry } from "@/lib/registrationItemRegistration";

/**
 * V14.1：整批多人多項報名（信眾詳情頁多選、活動中心整戶報名共用）。
 *
 * POST /api/registrations/batch
 * body: { operatorUserId, entries: [{ memberId, registrationItemTypeId, year,
 *          quantity?, customName?, customAmount?, feeChoice? }, ...] }
 *
 * 單一交易；任一失敗全部 rollback。權限：register（READONLY 一律 403）。
 *
 * ⚠️ operatorUserId 一律用 readOperatorUserId（body 優先、query 備援），
 * 與前端 fetchRegistration 對 POST 把 operatorUserId 放進 body 的行為一致
 * （之前只讀 query → 永遠 null → 401 → 按鈕按了沒反應）。
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertRitualRegistrationPermissionForOperator(operatorUserId, "register");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  // readJsonBody 有快取（同一 request 讀過的 body 直接回），與上面的
  // readOperatorUserId 讀的是同一份 body，不會二次消耗 stream。
  const body = await readJsonBody(request);
  if (!body || !Array.isArray(body.entries) || body.entries.length === 0) {
    return NextResponse.json({ error: "沒有要報名的項目" }, { status: 400 });
  }

  const entries: BatchItemEntry[] = [];
  for (const raw of body.entries) {
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ error: "報名項目格式錯誤" }, { status: 400 });
    }
    const e = raw as Record<string, unknown>;
    if (typeof e.memberId !== "string" || typeof e.registrationItemTypeId !== "string" || typeof e.year !== "number") {
      return NextResponse.json({ error: "報名項目缺少必要欄位（memberId／registrationItemTypeId／year）" }, { status: 400 });
    }
    entries.push({
      memberId: e.memberId,
      registrationItemTypeId: e.registrationItemTypeId,
      year: e.year,
      quantity: typeof e.quantity === "number" ? e.quantity : undefined,
      customName: typeof e.customName === "string" ? e.customName : null,
      customAmount: typeof e.customAmount === "number" ? e.customAmount : null,
      feeChoice: e.feeChoice === "FIXED" || e.feeChoice === "CUSTOM" ? e.feeChoice : null,
    });
  }

  const result = await registerItemsBatch(entries, check.operator.name);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const primaryRecord = result.ritualRecordIds[0] ?? null;
  return NextResponse.json({
    ok: true,
    outcomes: result.outcomes,
    ritualRecordIds: result.ritualRecordIds,
    editorUrl: primaryRecord ? `/registration/${primaryRecord}` : null,
  });
}
