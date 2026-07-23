import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { registerItemsBatch, type BatchItemEntry } from "@/lib/registrationItemRegistration";

/**
 * V14.1：整批多人多項報名（信眾詳情頁多選、活動中心整戶報名共用）。
 *
 * POST /api/registrations/batch?operatorUserId=xxx
 * body: { entries: [{ memberId, registrationItemTypeId, year, quantity?,
 *                     customName?, customAmount?, feeChoice? }, ...] }
 *
 * 單一交易；任一失敗全部 rollback。權限：register（READONLY 一律 403）。
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(
    new URL(request.url).searchParams.get("operatorUserId"),
    "register"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  let body: { entries?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "請求內容格式錯誤" }, { status: 400 });
  }
  if (!Array.isArray(body.entries) || body.entries.length === 0) {
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
