import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { updateMemberForHousehold } from "@/lib/memberCreate";
import { toHouseholdApiError } from "@/lib/householdManagement";
import { prisma } from "@/lib/prisma";

/**
 * V40 家戶成員「個人資料」讀取／更新 API。
 *
 *  GET  /api/households/F00009/members/<memberId>
 *    → 回目前值供「修改成員資料」表單預填（姓名／性別／生日／地址／辭世／備註）。
 *  PATCH 同一路徑，body 同「新增家人」格式（birthdayType + solar/lunar 欄位）。
 *
 * 只改個人資料；身份／主要聯絡人／身分證／手機各有專屬入口，這裡不動。
 * 權限沿用 assertDevoteePermissionForOperator(..., "updateProfile")。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const { id, memberId } = await params;
  const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "updateProfile");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const m = await prisma.member.findFirst({
    where: { id: memberId, householdId: id, deletedAt: null },
    select: {
      id: true, name: true, gender: true, isDeceased: true, notes: true, address: true,
      solarBirthDate: true, lunarBirthYear: true, lunarBirthMonth: true, lunarBirthDay: true, lunarIsLeapMonth: true,
    },
  });
  if (!m) return NextResponse.json({ error: "找不到這位成員（可能已被封存或移出）" }, { status: 404 });

  return NextResponse.json({
    member: {
      ...m,
      // 生日以 yyyy-MM-dd 回傳（BirthdayField 內部用）；農曆維持數字。
      solarBirthDate: m.solarBirthDate ? m.solarBirthDate.toISOString().slice(0, 10) : null,
    },
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const { id, memberId } = await params;
  const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "updateProfile");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  // 確認這位成員確實屬於這一戶（避免跨戶誤改）。
  const belongs = await prisma.member.findFirst({
    where: { id: memberId, householdId: id, deletedAt: null },
    select: { id: true },
  });
  if (!belongs) return NextResponse.json({ error: "找不到這位成員（可能已被封存或移出）" }, { status: 404 });

  try {
    const { member } = await updateMemberForHousehold(memberId, body, check.operator.name);
    revalidatePath(`/household/${id}`);
    return NextResponse.json({ member: { id: member.id } });
  } catch (e) {
    return toHouseholdApiError(e);
  }
}
