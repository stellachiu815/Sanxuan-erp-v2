import { NextRequest, NextResponse } from "next/server";
import { handleOAuthCallback } from "@/lib/googleDrive";
import { consumePendingOAuthState } from "@/lib/oauthStateStore";

/**
 * GET /api/system-center/google-drive/oauth-callback?code=...&state=...
 * Google 完成授權後導回的網址（這個網址本身要設定成 Google Cloud
 * Console OAuth 用戶端的 Authorized redirect URI，也就是環境變數
 * GOOGLE_OAUTH_REDIRECT_URI 的值）。
 *
 * 成功／失敗都會導回 /system-center/google-drive 頁面，用 query string
 * 帶結果，畫面上顯示對應訊息（不在這裡直接輸出 JSON，因為這是瀏覽器
 * 導頁行為，不是給前端 fetch() 呼叫的 API）。
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const redirectBase = `${origin}/system-center/google-drive`;

  const error = searchParams.get("error");
  if (error) {
    return NextResponse.redirect(`${redirectBase}?error=${encodeURIComponent(`Google 拒絕授權：${error}`)}`);
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const operatorName = consumePendingOAuthState(state);
  if (!operatorName) {
    return NextResponse.redirect(
      `${redirectBase}?error=${encodeURIComponent("授權連結已過期或不正確，請重新按一次「連結Google Drive」")}`
    );
  }
  if (!code) {
    return NextResponse.redirect(`${redirectBase}?error=${encodeURIComponent("Google 沒有回傳授權碼")}`);
  }

  try {
    const { email } = await handleOAuthCallback(code, operatorName);
    // email 可能是 null（Google 沒有回傳可辨識的帳號資訊，對應指令
    // 「三」：不得自行猜測或寫死帳號）——這裡忠實反映在導頁參數裡，
    // 畫面（GoogleDriveConnectionScreen）會依 status API 實際回傳的
    // boundEmail 顯示「已連線，但尚未取得帳號識別資料」。
    return NextResponse.redirect(`${redirectBase}?connected=${encodeURIComponent(email ?? "（尚未取得帳號識別資料）")}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "連結 Google Drive 失敗";
    return NextResponse.redirect(`${redirectBase}?error=${encodeURIComponent(message)}`);
  }
}
