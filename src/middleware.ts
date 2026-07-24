import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/authConstants";

/**
 * V14.3：未登入者一律導向 /login。
 *
 * ⚠️ middleware 在 edge 執行、不能查資料庫，這裡只檢查「有沒有 session cookie」
 * 這道**第一關**；真正的有效性（未過期、帳號未停用）由伺服器端 getSessionUser()
 * 與各 API 的權限檢查把關。放行：/login、/api/auth/*、Next 靜態資源。
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 放行：登入頁、所有 API（各 API 自己用 assertPermission 回 401/403，
  // 不能被導向 /login 的 HTML）、Next 靜態資源。
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // 排除 Next 內部與靜態檔；其餘頁面／API 一律經過登入檢查。
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
