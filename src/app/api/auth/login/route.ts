import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSession, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth";

/**
 * V14.3：登入。POST /api/auth/login  { account, password }
 * account 可為 loginId 或 email。驗證成功建立 session、設 httpOnly cookie、記錄稽核。
 * 失敗一律回「帳號或密碼錯誤」，不洩漏帳號是否存在。
 */
export const dynamic = "force-dynamic";

function clientIp(request: NextRequest): string | null {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip");
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const account = typeof body?.account === "string" ? body.account.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!account || !password) {
    return NextResponse.json({ error: "請輸入帳號與密碼" }, { status: 400 });
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ loginId: account }, { email: account }] },
  });

  // 帳號不存在／已停用／未設定密碼／密碼錯誤——一律回同一個訊息，不洩漏細節。
  const ok = user && user.isActive && (await verifyPassword(password, user.passwordHash));
  if (!ok || !user) {
    return NextResponse.json({ error: "帳號或密碼錯誤，或帳號尚未啟用" }, { status: 401 });
  }

  const { token } = await createSession(user.id, clientIp(request), request.headers.get("user-agent"));

  await prisma.auditLog.create({
    data: {
      entityType: "User",
      entityId: user.id,
      action: "LOGIN",
      operatorId: user.id,
      reason: clientIp(request) ?? undefined,
    },
  });

  const res = NextResponse.json({
    ok: true,
    user: { id: user.id, name: user.name, role: user.role },
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
