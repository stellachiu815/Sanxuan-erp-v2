/**
 * V14.3：登入相關的「無相依常數」。
 *
 * ⚠️ 這個檔案刻意**不** import prisma／crypto／next/headers，任何在 edge
 * runtime 執行的地方（middleware）都只能從這裡取常數，不可 import auth.ts
 * （那會把 Node-only 相依打包進 edge bundle 而失敗）。
 */

/** session cookie 名稱（httpOnly）。 */
export const SESSION_COOKIE = "sx_session";

/** session 有效期：12 小時（行政系統一個班次）。 */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
