import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { hashPassword } from "@/lib/auth";

/**
 * V14.3：重設某帳號的登入密碼（帳號管理，manageUsers 權限）。
 * PATCH /api/system-center/users/[id]/password  { password, loginId? }
 * 一律 hash 後儲存；可同時設定登入帳號 loginId。重設會使該帳號既有 session 失效。
 */
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertSystemPermissionForOperator(operatorUserId, "manageUsers");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await readJsonBody(request);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "密碼至少 6 碼" }, { status: 400 });
  }
  const loginId = typeof body?.loginId === "string" && body.loginId.trim() ? body.loginId.trim() : undefined;

  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "找不到這個帳號" }, { status: 404 });

  if (loginId && loginId !== target.loginId) {
    const dup = await prisma.user.findUnique({ where: { loginId } });
    if (dup) return NextResponse.json({ error: "這個登入帳號已被使用" }, { status: 409 });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data: { passwordHash: await hashPassword(password), ...(loginId ? { loginId } : {}) },
    }),
    // 重設密碼即撤銷該帳號所有既有 session（強制重新登入）。
    prisma.session.deleteMany({ where: { userId: id } }),
    prisma.auditLog.create({
      data: { entityType: "User", entityId: id, action: "RESET_PASSWORD", operatorId: check.operator.id },
    }),
  ]);

  return NextResponse.json({ ok: true, message: "已重設密碼，該帳號需以新密碼重新登入。" });
}
