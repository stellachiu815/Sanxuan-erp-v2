import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { reorderOfferingTypes } from "@/lib/offeringTypes";

/** POST /api/offering-types/reorder  body: { "orderedIds": ["id1", "id2", ...] } */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.orderedIds)) {
    return NextResponse.json({ error: "請提供 orderedIds 陣列" }, { status: 400 });
  }
  const result = await reorderOfferingTypes(body.orderedIds.filter((v: unknown) => typeof v === "string"));
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  revalidatePath("/offering-center/settings");
  return NextResponse.json({ count: result.data.count });
}
