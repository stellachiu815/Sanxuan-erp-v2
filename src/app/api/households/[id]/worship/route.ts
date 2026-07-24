import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { WorshipType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeYangshangName } from "@/lib/printChinese";
import { worshipTypeLabel } from "@/lib/labels";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

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
    return NextResponse.json({ success: false, error: "找不到這個家戶" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ success: false, error: "請求格式錯誤" }, { status: 400 });
  }

  // V12.1 一次性修正指令「二之4」：這支 API 原本完全沒有權限檢查（既有
  // 缺口）。沿用既有 assertDevoteePermissionForOperator(..., "updateProfile")，
  // 跟新增家人／修改家戶資料同一個權限動作，不另外建立第二套權限機制。
  const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "updateProfile");
  if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

  const type = typeof body.type === "string" ? body.type : "";
  if (!(type in worshipTypeLabel)) {
    return NextResponse.json({ success: false, error: "請選擇祭祀資料類型" }, { status: 400 });
  }

  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!displayName) {
    return NextResponse.json({ success: false, error: "請輸入名稱" }, { status: 400 });
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
      /**
       * V13.1 指令六：陽上人一律經過 normalizeYangshangName() 正規化——
       * 頓號／逗號／換行統一成「、」、去空白、去重複。
       * 絕不附加「叩薦」（那只在列印時由 printYangshangName 加上）。
       */
      yangshangName: normalizeYangshangName(body.yangshangName),
      /** V13.1 指令七：牌位地址。可留空（待補資料），不阻擋建立。 */
      location: toNullableString(body.location),
      notes: toNullableString(body.notes),
      /** V13.1 指令七：建立人（建立日期用既有的 createdAt） */
      createdByName: check.operator.name,
    },
  });

  revalidatePath(`/household/${householdId}`);

  return NextResponse.json({ success: true, data: { worshipRecord } }, { status: 201 });
}
