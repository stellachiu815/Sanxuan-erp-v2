import { NextRequest, NextResponse } from "next/server";
import { MemberRole } from "@prisma/client";
import { updateDevoteeBase, type BirthdayEditInput } from "@/lib/devoteeBaseEdit";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { validateLunarBirthdayInput, parseSolarDateString } from "@/lib/lunar";
import { memberRoleLabel, birthHourLabel } from "@/lib/labels";

/**
 * PATCH /api/devotee-center/xxx/base
 *
 * 對應指令「四、信眾完整資料編輯頁」的「基本資料」＋「家戶資料」（不含
 * 家戶編號，見 src/lib/devoteeBaseEdit.ts 說明）。跟既有的
 * PATCH /api/devotee-center/xxx/profile（只改 DevoteeProfile 延伸資料）
 * 是兩支不同的 API，分開的原因同 devoteeBaseEdit.ts 開頭說明。
 *
 * 權限沿用既有的 DevoteeAction.updateProfile——src/lib/permissions.ts 對
 * 這個動作原本的註解就寫「SUPER_ADMIN 全部欄位；ADMIN 僅一般信眾資料」，
 * 這裡就是「一般信眾資料（基本資料＋家戶資料）」的實際實作，沒有另外定義
 * 新的權限動作。
 *
 * body 範例：
 * {
 *   "operatorUserId": "xxx",
 *   "name": "王小明",
 *   "gender": "男",
 *   "role": "SON",
 *   "isPrimaryContact": false,
 *   "isDeceased": false,
 *   "yangshangName": null,
 *   "notes": "備註",
 *   "birthHour": "ZI",              // 或 null
 *   "birthdayType": "solar",         // "solar" | "lunar" | "none"
 *   "solarBirthDate": "1990-05-10",
 *   // 或者
 *   "birthdayType": "lunar",
 *   "lunarBirthYear": 1990,
 *   "lunarBirthMonth": 4,
 *   "lunarBirthDay": 20,
 *   "lunarIsLeapMonth": false,
 *   "household": { "name": "王家", "contactName": "王小明", "address": "...", "phone": "..." }
 * }
 *
 * 任何一個欄位如果沒有出現在 body 裡，代表這次不修改那個欄位（維持原值）。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const check = await assertDevoteePermissionForOperator(body.operatorUserId, "updateProfile");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const toNullableString = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed ? trimmed : null;
  };

  // ---- 信眾基本資料 ----
  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "姓名為必填，不能清空" }, { status: 400 });
    }
  }

  if ("role" in body && body.role !== undefined && !(body.role in memberRoleLabel)) {
    return NextResponse.json({ error: "身份選項不正確" }, { status: 400 });
  }

  if ("birthHour" in body && body.birthHour !== null && body.birthHour !== undefined && !(body.birthHour in birthHourLabel)) {
    return NextResponse.json({ error: "出生時辰選項不正確" }, { status: 400 });
  }

  let birthday: BirthdayEditInput | undefined;
  if (body.birthdayType === "solar") {
    const raw = typeof body.solarBirthDate === "string" ? body.solarBirthDate : "";
    const solarBirthDate = parseSolarDateString(raw);
    if (!solarBirthDate) {
      return NextResponse.json({ error: "國曆生日格式不正確" }, { status: 400 });
    }
    birthday = { type: "solar", solarBirthDate };
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
    birthday = { type: "lunar", lunarBirthYear: y, lunarBirthMonth: m, lunarBirthDay: d, lunarIsLeapMonth: leap };
  } else if (body.birthdayType === "none") {
    birthday = { type: "none" };
  }
  // birthdayType 沒有帶（undefined）代表這次不修改生日欄位

  let deceasedAt: Date | null | undefined;
  if ("deceasedAt" in body) {
    if (body.deceasedAt === null || body.deceasedAt === "") {
      deceasedAt = null;
    } else if (typeof body.deceasedAt === "string") {
      const parsed = parseSolarDateString(body.deceasedAt);
      if (!parsed) {
        return NextResponse.json({ error: "往生日期格式不正確" }, { status: 400 });
      }
      deceasedAt = parsed;
    }
  }

  // ---- 家戶資料（不含家戶編號，見 devoteeBaseEdit.ts 說明） ----
  let household: { name?: string; contactName?: string | null; address?: string | null; phone?: string | null } | undefined;
  if (body.household && typeof body.household === "object") {
    household = {};
    if ("name" in body.household) {
      const householdName = typeof body.household.name === "string" ? body.household.name.trim() : "";
      if (!householdName) {
        return NextResponse.json({ error: "戶名為必填，不能清空" }, { status: 400 });
      }
      household.name = householdName;
    }
    if ("contactName" in body.household) household.contactName = toNullableString(body.household.contactName);
    if ("address" in body.household) household.address = toNullableString(body.household.address);
    if ("phone" in body.household) household.phone = toNullableString(body.household.phone);
  }

  try {
    const result = await updateDevoteeBase(
      memberId,
      {
        name: "name" in body ? String(body.name).trim() : undefined,
        gender: "gender" in body ? toNullableString(body.gender) : undefined,
        role: "role" in body ? (body.role as MemberRole) : undefined,
        isPrimaryContact: typeof body.isPrimaryContact === "boolean" ? body.isPrimaryContact : undefined,
        isDeceased: typeof body.isDeceased === "boolean" ? body.isDeceased : undefined,
        deceasedAt,
        yangshangName: "yangshangName" in body ? toNullableString(body.yangshangName) : undefined,
        notes: "notes" in body ? toNullableString(body.notes) : undefined,
        birthHour: "birthHour" in body ? ((body.birthHour as string | null) ?? null) : undefined,
        birthday,
        household,
      },
      check.operator.name
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "儲存失敗" }, { status: 400 });
  }
}
