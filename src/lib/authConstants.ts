/**
 * V14.3：登入相關的「無相依常數」。
 *
 * ⚠️ 這個檔案刻意**不** import prisma／crypto／next/headers，任何在 edge
 * runtime 執行的地方（middleware）都只能從這裡取常數，不可 import auth.ts
 * （那會把 Node-only 相依打包進 edge bundle 而失敗）。
 */

/** session cookie 名稱（httpOnly）。 */
export const SESSION_COOKIE = "sx_session";

/**
 * session 有效期。
 * V36.14：由 12 小時延長為 **90 天**——行政人員不必天天重打帳密（＝「保持登入／自動登入」）。
 * 每次登入都會重新起算 90 天；期間關瀏覽器再開仍是登入狀態。要登出就按登出。
 */
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
