import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { quickRegister, type QuickRegInput } from "@/lib/quickRegistration";
import { listActivityYearCandidates, canAcceptRegistration } from "@/lib/activityYear";

/**
 * 現場快速報名可選的普渡活動年度（優先開放報名者）。
 * GET /api/quick-registration
 */
export async function GET(request: NextRequest) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "create");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  const candidates = await listActivityYearCandidates("UNIVERSAL_SALVATION");
  const now = new Date();
  const activities = candidates
    .filter((c) => !c.isArchived && c.status !== "CANCELLED")
    .map((c) => ({
      templeEventId: c.templeEventId,
      year: c.year,
      name: c.name,
      canRegister: canAcceptRegistration(c, now).ok,
    }))
    .sort((a, b) => b.year - a.year);
  return NextResponse.json({ activities });
}

/**
 * V38 現場快速報名：一頁三步，一鍵完成中元普渡報名。
 *
 * POST /api/quick-registration
 * 身分＝登入 session（不信任前端送的 operatorUserId）；權限沿用普渡 create。
 */
export async function POST(request: NextRequest) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "create");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const body = await readJsonBody(request);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const templeEventId = typeof body.templeEventId === "string" ? body.templeEventId : "";
  if (!templeEventId) {
    return NextResponse.json({ error: "請先選擇活動年度" }, { status: 400 });
  }

  // 前端 body 已是 QuickRegInput 形狀；服務層會再逐欄清理／驗證。
  const input = { ...(body as unknown as QuickRegInput), templeEventId };

  const result = await quickRegister(input, {
    id: check.operator.id,
    name: check.operator.name,
    role: check.operator.role,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/household/${result.householdId}`);
  revalidatePath(`/registration/${result.ritualRecordId}`);

  return NextResponse.json(result, { status: 201 });
}
