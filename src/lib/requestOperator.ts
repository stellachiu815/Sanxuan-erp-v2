
/**
 * V13.3A：從請求中安全取出 `operatorUserId`。
 *
 * ── 為什麼需要這一支 ────────────────────────────────────────
 * 普渡的 API 有兩種取得操作人的寫法混用（有的讀 body、有的讀 query），
 * 而且多支 route 在權限檢查之後仍然需要再次讀 body 取得業務資料。
 * `request.json()` **只能讀一次**（body 是 stream），第二次會拿到空值。
 *
 * 這支把「讀一次 body、快取起來、之後重複取用」封裝成單一入口，
 * 讓每支 route 都能先做權限檢查、再安全地取用同一份 body。
 *
 * ── 安全原則（V13.3A 指令四）────────────────────────────────
 * ⚠️ 這支**只取 operatorUserId**（一個要拿去資料庫查證的 id），
 * 絕不取 operatorName / createdBy / printedByName 這類「操作人是誰」的
 * 顯示名稱——那些一律由 resolveOperator() 從 User 資料表查出來。
 *
 * 前端即使繼續在 body 裡送 operatorName，伺服器也完全忽略。
 */

import { getSessionUserByToken, SESSION_COOKIE } from "@/lib/auth";

type CachedBody = Record<string, unknown> | null;

/**
 * 以 Request 物件為 key 快取已解析的 body。
 * 型別用標準 `Request`（不是 NextRequest）——Next.js 的 route handler
 * 兩種宣告都合法，用基底型別才能同時相容。
 */
const bodyCache = new WeakMap<object, CachedBody>();

/**
 * 讀取請求 body（已快取，可重複呼叫）。解析失敗回傳 null。
 */
export async function readJsonBody(request: Request): Promise<CachedBody> {
  if (bodyCache.has(request)) return bodyCache.get(request) ?? null;
  const parsed = await request
    .json()
    .then((v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null))
    .catch(() => null);
  bodyCache.set(request, parsed);
  return parsed;
}

/**
 * 取出 operatorUserId。
 *
 * 優先順序：body.operatorUserId → query string ?operatorUserId=
 * （部分既有前端呼叫用 query 傳遞，兩者都支援以免改動前端）。
 *
 * ⚠️ 回傳的只是一個**待查證的 id**，本身不代表任何權限。
 * 呼叫端必須再經過 assertUniversalSalvationPermissionForOperator()，
 * 由它查資料庫確認這個 id 對應到真實存在、未停用的 User，
 * 並用**資料庫查到的角色**做權限判斷。
 */
export async function readOperatorUserId(request: Request): Promise<string | null> {
  // V14.3 正式登入：操作人一律以「登入的 session」為準（唯一來源）。
  //
  // ⚠️ 重要安全決策：middleware 對 /api/* 一律放行（見 middleware.ts，API 不能被
  // 導向 /login 的 HTML），所以 API 的身分驗證「完全」倚賴這裡。若這裡在沒有
  // session 時退回讀 body/query 的 operatorUserId，未登入者只要送
  // `?operatorUserId=<某人的id>` 就能冒充該使用者——因此 V14.3 起**移除所有退回**，
  // 沒有有效 session 一律回傳 null（呼叫端的 assertXForOperator 會回 401）。
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  const sessionUser = await getSessionUserByToken(token);
  return sessionUser ? sessionUser.id : null;
}

/** 從 Cookie 標頭取單一 cookie 值（middleware 之外的 route 用；不依賴 next/headers）。 */
function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
