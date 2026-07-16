import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { WorshipType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { worshipTypeLabel } from "@/lib/labels";

/**
 * 新增祭祀資料 API
 *
 * POST /api/households/F00009/worship
 * body: {
 *   "type": "ANCESTOR_LINE" | "INDIVIDUAL",
 *   "displayName": "王姓歷代祖先",
 *   "yangshangName": "王小明",
 *   "location": "本宮祖先牌位區",
 *   "notes": "備註"
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: householdId } = await params;

  const household = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
  });
  if (!household) {
    return NextResponse.json({ error: "找不到這個家戶" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const type = typeof body.type === "string" ? body.type : "";
  if (!(type in worshipTypeLabel)) {
    return NextResponse.json({ error: "請選擇祭祀資料類型" }, { status: 400 });
  }

  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!displayName) {
    return NextResponse.json({ error: "請輸入名稱" }, { status: 400 });
  }

  const toNullableString = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed ? trimmed : null;
  };

  const worshipRecord = await prisma.worshipRecord.create({
    data: {
      householdId,
      type: type as WorshipType,
      displayName,
      yangshangName: toNullableString(body.yangshangName),
      location: toNullableString(body.location),
      notes: toNullableString(body.notes),
    },
  });

  revalidatePath(`/household/${householdId}`);

  return NextResponse.json({ worshipRecord }, { status: 201 });
}
