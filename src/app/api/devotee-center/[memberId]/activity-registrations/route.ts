import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { registerActivity, type RegistrationSource } from "@/lib/activityRegistration";
import { copyUniversalSalvationFromPreviousYear } from "@/lib/ritual";

/**
 * V13.4：從信眾詳情頁建立活動報名。
 *
 * POST /api/devotee-center/[memberId]/activity-registrations
 * body: {
 *   operatorUserId,
 *   templeEventId,
 *   memberIds: string[],          // 本次納入的成員（本人 + 同家戶成員）
 *   mode: "NEW" | "CARRY_OVER",   // 全新建立 / 沿用去年
 *   carryOverOptions?: {...},     // 沿用時的勾選項目
 *   lanternUnitPrice?: number
 * }
 *
 * ── 兩種模式（V13.4 指令六、七）─────────────────────────────
 *   NEW        **完全不讀取去年資料**。建立乾淨的新年度報名，
 *              使用者手動填內容、可存草稿、可回編、完整後才確認。
 *   CARRY_OVER 沿用去年可延續的內容；付款、收據、列印、對帳、交易
 *              狀態一律不複製，全部初始化。
 *
 * 兩種模式最後都走**同一個** registerActivity() 正式儲存流程，
 * 不做第二套 API。
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  const operatorUserId = await readOperatorUserId(request);

  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });

  const mode = body.mode === "CARRY_OVER" ? "CARRY_OVER" : "NEW";

  // 沿用去年需要 carryOver 權限，全新建立需要 register 權限
  const check = await assertRitualRegistrationPermissionForOperator(
    operatorUserId,
    mode === "CARRY_OVER" ? "carryOver" : "register"
  );
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const { memberId } = await params;

  const templeEventId = typeof body.templeEventId === "string" ? body.templeEventId : "";
  if (!templeEventId) {
    return NextResponse.json({ error: "請選擇活動" }, { status: 400 });
  }

  const memberIds = Array.isArray(body.memberIds)
    ? body.memberIds.filter((x): x is string => typeof x === "string")
    : [];
  if (memberIds.length === 0) {
    return NextResponse.json({ error: "請至少選擇一位報名成員" }, { status: 400 });
  }

  const member = await prisma.member.findFirst({
    where: { id: memberId, deletedAt: null },
    select: { householdId: true },
  });
  if (!member) return NextResponse.json({ error: "找不到這位信眾" }, { status: 404 });

  const event = await prisma.templeEvent.findUnique({ where: { id: templeEventId } });
  if (!event) return NextResponse.json({ error: "找不到這個活動" }, { status: 404 });

  /**
   * 沿用去年：先複製去年內容建立主檔，再由 registerActivity 補上本次成員。
   *
   * ⚠️ 只有普渡目前有「沿用去年內容」的實作（copy-from-previous-year）。
   * 其他活動類型的沿用＝沿用報名成員（由 memberIds 帶入），內容仍需手動填。
   */
  if (mode === "CARRY_OVER" && event.activityType === "UNIVERSAL_SALVATION") {
    const carryOptions = (body.carryOverOptions ?? {}) as Record<string, unknown>;
    const copied = await copyUniversalSalvationFromPreviousYear(
      member.householdId,
      event.year - 1,
      event.year,
      {
        copyTableNumber: carryOptions.copyTableNumber === true,
        copyEntries: carryOptions.copyEntries !== false,
        copySponsor: carryOptions.copySponsor !== false,
        copyNotes: carryOptions.copyNotes !== false,
        operatorName: check.operator.name,
      }
    );
    // 去年沒有資料不是錯誤——改走全新建立，讓使用者手動填
    if (!copied.ok && copied.status !== 404) {
      return NextResponse.json({ error: copied.error }, { status: copied.status });
    }
  }

  const source: RegistrationSource = mode === "CARRY_OVER" ? "CARRY_OVER" : "DEVOTEE_PAGE";

  const result = await registerActivity({
    templeEventId,
    householdId: member.householdId,
    memberIds,
    source,
    operatorName: check.operator.name,
    lanternUnitPrice:
      typeof body.lanternUnitPrice === "number" ? body.lanternUnitPrice : null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    ritualRecordId: result.ritualRecordId,
    created: result.created,
    message: result.message,
    formType: result.formType,
    participantOutcomes: result.participantOutcomes,
    /** 前端據此導向共用報名編輯器 */
    editorUrl: `/registration/${result.ritualRecordId}`,
  });
}
