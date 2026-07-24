"use client";

/**
 * V14.3【前端角色顯示與操作收斂】：401／403 的統一前端處理。
 *
 * 即使畫面已經把按鈕藏起來，API 仍可能因為 Session 過期、角色被改、帳號被
 * 停用、多分頁舊畫面、或使用者手動呼叫而回 401／403。這裡集中處理，避免
 * 各頁各自解讀成「一般系統錯誤」或（更糟）誤判成成功。
 *
 * - 401（未登入／Session 失效）：清掉前端登入狀態並導回 /login，附
 *   session=expired 讓登入頁顯示「登入已失效，請重新登入」。
 * - 403（已登入但無權限）：丟出可辨識的 ApiPermissionError，畫面顯示
 *   「您沒有執行此操作的權限」，且呼叫端不得繼續更新狀態或當成功。
 *
 * 這不是安全機制（安全在 API 端），只是統一的體驗處理。
 */

export class ApiAuthError extends Error {
  constructor(message = "登入已失效，請重新登入") {
    super(message);
    this.name = "ApiAuthError";
  }
}

export class ApiPermissionError extends Error {
  constructor(message = "您沒有執行此操作的權限") {
    super(message);
    this.name = "ApiPermissionError";
  }
}

const STORAGE_KEY = "sanxuan.receiptCenter.operatorUserId";

/** 導回登入頁（保留原本要去的頁面）。只在瀏覽器端執行。 */
export function redirectToLogin(reason: "expired" | "anonymous" = "expired") {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 忽略 */
  }
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  // 用整頁導向確保清乾淨所有前端狀態（避免舊畫面殘留）。
  window.location.href = `/login?next=${next}&session=${reason}`;
}

/**
 * 統一的 API 呼叫包裝。新的寫入呼叫建議改用這支；既有 raw fetch 由
 * installGlobalAuthHandler() 的全域攔截兜底處理 401。
 *
 * 401 → 導回登入並丟 ApiAuthError；403 → 丟 ApiPermissionError。
 * 其餘（含 4xx/5xx 業務錯誤）原樣回傳 Response，交由呼叫端處理。
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    redirectToLogin("expired");
    throw new ApiAuthError();
  }
  if (res.status === 403) {
    let message = "您沒有執行此操作的權限";
    try {
      const data = await res.clone().json();
      if (data?.error && typeof data.error === "string") message = data.error;
    } catch {
      /* 保留預設訊息 */
    }
    throw new ApiPermissionError(message);
  }
  return res;
}

let installed = false;

/**
 * 全域兜底：攔截所有到 /api/*（登入相關除外）的 fetch，401 一律導回登入頁。
 * 這樣不需要把每一支既有 raw fetch 都改寫，也能確保 Session 過期時整站一致
 * 地回登入頁。只攔 401（安全關鍵的失效狀態）；403 交由 apiFetch／各頁處理，
 * 以免誤把「某個唯讀頁剛好碰到一支 403 的次要請求」整頁中斷。
 */
export function installGlobalAuthHandler() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await originalFetch(input, init);
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : (input as Request).url;
      const path = url.startsWith("http") ? new URL(url).pathname : url;
      const isApi = path.startsWith("/api/");
      const isAuthEndpoint = path.startsWith("/api/auth/");
      if (res.status === 401 && isApi && !isAuthEndpoint) {
        redirectToLogin("expired");
      }
    } catch {
      /* URL 解析失敗就不攔截，原樣回傳 */
    }
    return res;
  };
}
