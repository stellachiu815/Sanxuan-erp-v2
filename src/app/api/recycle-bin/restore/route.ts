import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isRecycleBinEntityType, restoreRecycleBinItem } from "@/lib/recycleBin";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * 從回收區還原一筆資料（V8.0「刪除保護」）。
 *
 * POST /api/recycle-bin/restore
 * body: { "entityType": "RitualRecord", "entityId": "xxx", "operatorName": "操作人姓名" }
 *
 * ⚠️ 需求「九、權限」要求只有 SUPER_ADMIN 能還原資料。系統目前沒有登入/
 * session 機制（見 src/lib/permissions.ts），暫時無法在後端驗證操作者
 * 身份，這個限制目前只能靠畫面提示，還沒辦法真正擋下——已在
 * docs/BACKUP_VERSION_CONTROL.md 列為風險事項，等登入機制做出來後必須
 * 補上真正的後端權限檢查。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const entityType = body.entityType;
  const entityId = typeof body.entityId === "string" ? body.entityId : "";

  if (!isRecycleBinEntityType(entityType) || !entityId) {
    return NextResponse.json({ error: "請提供正確的 entityType 與 entityId" }, { status: 400 });
  }

  // V14.3：回收桶還原僅 SUPER_ADMIN／ADMIN（STAFF／READONLY 不得使用回收桶）；
  // 操作人一律以登入 session 為準，不信任前端 operatorName。
  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request), "manageRecycleBin");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const operatorName = check.operator.name;

  // 先查一次相關的家戶 id，還原成功後才知道要 revalidate 哪個頁面。
  let householdIdToRevalidate: string | null = null;
  if (entityType === "Household") {
    householdIdToRevalidate = entityId;
  } else if (entityType === "Member") {
    const m = await prisma.member.findUnique({ where: { id: entityId } });
    householdIdToRevalidate = m?.householdId ?? null;
  } else if (entityType === "RitualRecord") {
    const r = await prisma.ritualRecord.findUnique({ where: { id: entityId } });
    householdIdToRevalidate = r?.householdId ?? null;
  } else if (entityType === "UniversalSalvationEntry") {
    const e = await prisma.universalSalvationEntry.findUnique({
      where: { id: entityId },
      include: { universalSalvation: { include: { ritualRecord: true } } },
    });
    householdIdToRevalidate = e?.universalSalvation.ritualRecord.householdId ?? null;
  } else if (entityType === "AdditionalPrintItem") {
    const item = await prisma.additionalPrintItem.findUnique({ where: { id: entityId } });
    householdIdToRevalidate = item?.householdId ?? null;
  } else if (entityType === "OfferingClaim") {
    const claim = await prisma.offeringClaim.findUnique({ where: { id: entityId } });
    householdIdToRevalidate = claim?.sponsorHouseholdId ?? null;
  }

  const result = await restoreRecycleBinItem(entityType, entityId, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath("/system/recycle-bin");
  if (householdIdToRevalidate) {
    revalidatePath(`/household/${householdIdToRevalidate}`);
    revalidatePath(`/household/${householdIdToRevalidate}/rituals/universal-salvation`);
  }

  return NextResponse.json({ ok: true });
}
