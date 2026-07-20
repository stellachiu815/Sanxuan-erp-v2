import { NextRequest, NextResponse } from "next/server";
import { WorshipType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { worshipTypeLabel } from "@/lib/labels";
import { assertDevoteePermissionForOperator } from "@/lib/operator";

/**
 * POST /api/devotee-center/xxx/worship-records
 *
 * 對應指令「四、其他資料：歷代祖先／乙位正魂」——在信眾完整資料編輯頁，
 * 直接為目前這位信眾所屬的家戶新增一筆祭祀資料（WorshipRecord），不需要
 * 跳去 /household/[id] 頁面。跟 household-members/route.ts 同一種設計理由：
 * 不直接呼叫既有的 POST /api/households/[id]/worship（該既有 API 沒有權限
 * 檢查），而是在信眾資料中心這一側另外提供一支會驗證 DEVOTEE_PERMISSIONS
 * 的路由，資料驗證規則完全比照既有邏輯。
 *
 * body: { operatorUserId, type: "ANCESTOR_LINE" | "INDIVIDUAL", displayName,
 *         yangshangName?, location?, notes? }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const check = await assertDevoteePermissionForOperator(body.operatorUserId, "updateProfile");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const anchor = await prisma.member.findUnique({ where: { id: memberId } });
  if (!anchor || anchor.deletedAt) {
    return NextResponse.json({ error: "找不到這位信眾，無法為其家戶新增祭祀資料" }, { status: 404 });
  }
  const householdId = anchor.householdId;

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

  return NextResponse.json({ worshipRecord }, { status: 201 });
}
