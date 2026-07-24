import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { recordVersion } from "@/lib/recordVersion";

const VALID_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "STAFF", "READONLY", "FINANCE_CLERK"];

/**
 * PATCH /api/system-center/users/xxx
 * body: { operatorUserId, name?, role?, isActive? }
 *
 * 對應指令「九、2/3/4」：修改姓名／啟用停用／指定角色。跟建立帳號同一支
 * 權限（manageUsers），同樣不涉及密碼／登入。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request), "manageUsers");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "找不到這位使用者" }, { status: 404 });
  }

  const data: { name?: string; role?: Role; isActive?: boolean } = {};

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "姓名為必填，不能清空" }, { status: 400 });
    }
    data.name = name;
  }

  if ("role" in body) {
    const role = typeof body.role === "string" ? body.role : "";
    if (!VALID_ROLES.includes(role as Role)) {
      return NextResponse.json({ error: "角色選項不正確" }, { status: 400 });
    }
    // 跟建立帳號同一個限制：這個畫面不開放把任何人指定成 SUPER_ADMIN／
    // FINANCE_CLERK，也不開放把既有的 SUPER_ADMIN 帳號改成其他角色（避免
    // 一般管理員誤操作把系統唯一的最高管理員降級，導致沒有人能再進入
    // 系統管理中心）。
    if (role === "SUPER_ADMIN" || role === "FINANCE_CLERK") {
      return NextResponse.json({ error: "這個角色不開放從此畫面指定" }, { status: 400 });
    }
    if (existing.role === "SUPER_ADMIN") {
      return NextResponse.json({ error: "不開放從此畫面修改最高管理員帳號的角色" }, { status: 400 });
    }
    data.role = role as Role;
  }

  if ("isActive" in body) {
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "啟用狀態格式不正確" }, { status: 400 });
    }
    if (existing.role === "SUPER_ADMIN" && body.isActive === false) {
      return NextResponse.json({ error: "不開放從此畫面停用最高管理員帳號" }, { status: 400 });
    }
    data.isActive = body.isActive;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "沒有要修改的欄位" }, { status: 400 });
  }

  const user = await prisma.user.update({ where: { id }, data });

  await recordVersion({
    entityType: "User",
    entityId: id,
    action: "UPDATE",
    beforeData: existing,
    afterData: user,
    operatorName: check.operator.name,
    changeNote: "使用者帳號管理：修改操作人員",
  });

  return NextResponse.json({ user });
}
