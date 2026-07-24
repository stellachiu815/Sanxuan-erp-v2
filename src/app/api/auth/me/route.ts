import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

/** V14.3：取得目前登入使用者（供前端 OperatorProvider 使用）。未登入回 { user: null }。 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  // 拿得到 user 即代表 session 有效且帳號未停用（getSessionUser 對停用帳號
  // 回 null），因此明確帶 isActive: true 供前端 useCurrentUser 使用。
  return NextResponse.json({ user: user ? { ...user, isActive: true } : null });
}
