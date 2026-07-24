import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSessionToken, getSessionUser, destroySession, SESSION_COOKIE } from "@/lib/auth";

/** V14.3：登出。POST /api/auth/logout —— 刪除 session、清 cookie、記錄稽核。 */
export const dynamic = "force-dynamic";

export async function POST() {
  const token = await getCurrentSessionToken();
  const user = await getSessionUser();
  await destroySession(token);
  if (user) {
    await prisma.auditLog.create({
      data: { entityType: "User", entityId: user.id, action: "LOGOUT", operatorId: user.id },
    });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
