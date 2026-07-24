import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { listOfferingTypes, createOfferingType } from "@/lib/offeringTypes";
import { assertOfferingPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * V10.1「供品認捐中心」需求「一、供品種類管理」。
 *
 * GET  /api/offering-types
 * POST /api/offering-types
 *   body: { "name": "平安米", "category": "其他供品", "behaviorKind": "GENERIC",
 *           "unit": "FEN", "defaultQuantity": 1, "defaultPrice": 100, ... }
 *
 * V14.3：正式登入系統上線後，補上原本待辦的後端權限檢查——新增/修改供品
 * 種類屬 manageOfferingTypes（僅 SUPER_ADMIN／ADMIN），操作人一律取自登入
 * session，忽略前端傳入的 operatorName/operatorUserId。
 */
export async function GET(request: NextRequest) {
  const includeInactive = request.nextUrl.searchParams.get("includeInactive") !== "false";
  const types = await listOfferingTypes(includeInactive);
  return NextResponse.json({ types });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.name !== "string") {
    return NextResponse.json({ error: "請提供供品名稱" }, { status: 400 });
  }

  const __op = await assertOfferingPermissionForOperator(await readOperatorUserId(request), "manageOfferingTypes");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });
  const operatorName = __op.operator.name;
  const result = await createOfferingType(
    {
      name: body.name,
      category: typeof body.category === "string" ? body.category : null,
      behaviorKind: body.behaviorKind ?? undefined,
      unit: body.unit ?? undefined,
      isChargeable: typeof body.isChargeable === "boolean" ? body.isChargeable : undefined,
      hasLimitedQuantity: typeof body.hasLimitedQuantity === "boolean" ? body.hasLimitedQuantity : undefined,
      defaultQuantity: typeof body.defaultQuantity === "number" ? body.defaultQuantity : undefined,
      defaultPrice: typeof body.defaultPrice === "number" ? body.defaultPrice : null,
      allowPriceOverride: typeof body.allowPriceOverride === "boolean" ? body.allowPriceOverride : undefined,
      allowDuplicateClaim: typeof body.allowDuplicateClaim === "boolean" ? body.allowDuplicateClaim : undefined,
      claimMode: body.claimMode ?? undefined,
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : undefined,
      note: typeof body.note === "string" ? body.note : null,
    },
    operatorName
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath("/offering-center/settings");
  return NextResponse.json({ id: result.data.id }, { status: 201 });
}
