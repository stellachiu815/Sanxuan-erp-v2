import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { MemberRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateLunarBirthdayInput } from "@/lib/lunar";
import { memberRoleLabel } from "@/lib/labels";
import { recordVersion } from "@/lib/recordVersion";

/**
 * 新增家人 API
 *
 * POST /api/households/F00009/members
 *
 * body 範例：
 * {
 *   "name": "王小美",
 *   "gender": "女",
 *   "role": "DAUGHTER",
 *   "isPrimaryContact": false,
 *   "isDeceased": false,
 *   "notes": "備註",
 *   "birthdayType": "solar",       // "solar" | "lunar" | "none"
 *   "solarBirthDate": "1990-05-10",
 *   // 或者
 *   "birthdayType": "lunar",
 *   "lunarBirthYear": 1990,
 *   "lunarBirthMonth": 4,
 *   "lunarBirthDay": 20,
 *   "lunarIsLeapMonth": false
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

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "請輸入姓名" }, { status: 400 });
  }

  const role = typeof body.role === "string" ? body.role : "OTHER";
  if (!(role in memberRoleLabel)) {
    return NextResponse.json({ error: "身份選項不正確" }, { status: 400 });
  }

  const gender = typeof body.gender === "string" && body.gender ? body.gender : null;
  const isPrimaryContact = Boolean(body.isPrimaryContact);
  const isDeceased = Boolean(body.isDeceased);
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  let solarBirthDate: Date | null = null;
  let lunarBirthYear: number | null = null;
  let lunarBirthMonth: number | null = null;
  let lunarBirthDay: number | null = null;
  let lunarIsLeapMonth = false;

  const birthdayType = body.birthdayType;

  if (birthdayType === "solar") {
    const raw = typeof body.solarBirthDate === "string" ? body.solarBirthDate : "";
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!match) {
      return NextResponse.json({ error: "國曆生日格式不正確" }, { status: 400 });
    }
    const [, y, m, d] = match;
    solarBirthDate = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  } else if (birthdayType === "lunar") {
    const y = Number(body.lunarBirthYear);
    const m = Number(body.lunarBirthMonth);
    const d = Number(body.lunarBirthDay);
    const leap = Boolean(body.lunarIsLeapMonth);
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
      return NextResponse.json({ error: "農曆生日請完整輸入年、月、日" }, { status: 400 });
    }
    const error = validateLunarBirthdayInput(y, m, d, leap);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }
    lunarBirthYear = y;
    lunarBirthMonth = m;
    lunarBirthDay = d;
    lunarIsLeapMonth = leap;
  }
  // birthdayType === "none"（或沒填）就整組留空，之後可以再補資料

  // V8.0「資料版本紀錄」：新增也留一筆版本紀錄（修改前＝null），這樣「修改
  // 紀錄」畫面才能完整看到這位成員從建立以來的所有異動，不是只有之後的修改。
  // 建立資料跟寫入版本紀錄放在同一個交易裡，避免只成功一半。
  const operatorName = typeof body.operatorName === "string" ? body.operatorName : null;
  const member = await prisma.$transaction(async (tx) => {
    const created = await tx.member.create({
      data: {
        householdId,
        name,
        gender,
        role: role as MemberRole,
        isPrimaryContact,
        isDeceased,
        notes,
        solarBirthDate,
        lunarBirthYear,
        lunarBirthMonth,
        lunarBirthDay,
        lunarIsLeapMonth,
      },
    });

    await recordVersion(
      {
        entityType: "Member",
        entityId: created.id,
        action: "CREATE",
        afterData: created,
        operatorName,
      },
      tx
    );

    return created;
  });

  revalidatePath(`/household/${householdId}`);

  return NextResponse.json({ member }, { status: 201 });
}
