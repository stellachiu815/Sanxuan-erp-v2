import { NextRequest, NextResponse } from "next/server";
import { MemberRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateLunarBirthdayInput, parseSolarDateString } from "@/lib/lunar";
import { memberRoleLabel } from "@/lib/labels";
import { recordVersion } from "@/lib/recordVersion";
import { assertDevoteePermissionForOperator } from "@/lib/operator";

/**
 * POST /api/devotee-center/xxx/household-members
 *
 * 對應指令「四、其他資料：家戶成員」——在信眾完整資料編輯頁，直接為目前
 * 這位信眾所屬的家戶新增一位新成員，不需要跳去 /household/[id] 頁面。
 *
 * 這支 API 刻意「不是」呼叫既有的 POST /api/households/[id]/members——
 * 那支既有 API 完全沒有權限檢查（見交付報告已知限制說明），是家戶模組
 * 既有的既有行為，這次指令「不要順便修改其他模組」，所以不去動那支既有
 * API 本身。但信眾資料中心是本輪要交付的模組，這裡的新增邏輯需要跟
 * DEVOTEE_PERMISSIONS 的 updateProfile 權限掛勾，所以另外寫一支邏輯幾乎
 * 一致、但會先驗證操作人員權限的獨立路由，資料表跟驗證規則完全比照既有的
 * /household/[id]/members 新增邏輯，不是重新設計一套。
 *
 * body 同既有 /household/[id]/members 的格式，另外多帶 operatorUserId。
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
    return NextResponse.json({ error: "找不到這位信眾，無法為其家戶新增成員" }, { status: 404 });
  }
  const householdId = anchor.householdId;

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

  if (body.birthdayType === "solar") {
    const raw = typeof body.solarBirthDate === "string" ? body.solarBirthDate : "";
    const parsed = parseSolarDateString(raw);
    if (!parsed) {
      return NextResponse.json({ error: "國曆生日格式不正確" }, { status: 400 });
    }
    solarBirthDate = parsed;
  } else if (body.birthdayType === "lunar") {
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
        operatorName: check.operator.name,
        changeNote: "信眾資料中心：透過信眾完整資料編輯頁新增家戶成員",
      },
      tx
    );

    return created;
  });

  return NextResponse.json({ member }, { status: 201 });
}
