import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { listOfferingTypes, createOfferingType } from "@/lib/offeringTypes";

/**
 * V10.1「供品認捐中心」需求「一、供品種類管理」。
 *
 * GET  /api/offering-types
 * POST /api/offering-types
 *   body: { "name": "平安米", "category": "其他供品", "behaviorKind": "GENERIC",
 *           "unit": "FEN", "defaultQuantity": 1, "defaultPrice": 100, ... }
 *
 * ⚠️ 需求「二十一」：只有 SUPER_ADMIN 能新增/修改供品種類。系統目前沒有
 * 登入/session 機制（見 src/lib/permissions.ts 說明），暫時無法在後端
 * 驗證操作者身份，這裡先開放給所有使用者操作，等登入機制做出來後補上
 * assertOfferingPermission() 檢查。
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

  const operatorName = typeof body.operatorName === "string" ? body.operatorName : null;
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
