import { readStoredOperatorUserId } from "@/lib/operatorClient";

/**
 * V13.3B 驗收修正：普渡模組前端呼叫 API 的共用包裝。
 *
 * ── 這支存在的原因（誠實記錄一個我造成的迴歸）──────────────────
 * V13.3A 為普渡的 15 支 API 補上了權限檢查（那是必要的安全修正，全專案
 * 只有普渡整組漏掉）。但**前端從來沒有送過 operatorUserId**——因為在那
 * 之前那些 API 根本不檢查身分。
 *
 * 結果就是：權限檢查上線後，普渡登記頁的每一個請求都拿不到身分，
 * 一律回 401「找不到有效的操作人員身分」，整個模組被鎖死。
 *
 * 使用者的身分本身完全正常（同一帳號可以建立活動、改寶袋價格），
 * 問題純粹是普渡前端沒有跟上 V13.3A 的介面變更。
 *
 * ── 修法：補齊前端，不降低權限檢查 ─────────────────────────
 * 沿用既有的 readStoredOperatorUserId()（localStorage，與收款中心、
 * 祭改報名、供品面板等 6 個既有元件同一套機制），**不新增第二套身分來源**。
 *
 * GET  → 自動附加 ?operatorUserId=xxx
 * 其他 → 自動在 JSON body 併入 operatorUserId
 *
 * ⚠️ 這只是把「待查證的 id」帶給伺服器。真正的權限判斷仍然在後端
 * assertUniversalSalvationPermissionForOperator()，由它查資料庫確認
 * 使用者存在、未停用，並用**資料庫查到的角色**決定能不能做這件事。
 * 前端送什麼都不會提升權限。
 */
export async function fetchUniversalSalvation(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const operatorUserId = readStoredOperatorUserId();
  const method = (init?.method ?? "GET").toUpperCase();

  if (method === "GET" || method === "HEAD") {
    // 用相對路徑組 URL 時需要 base，取當前頁面來源
    const url = new URL(input, window.location.origin);
    if (operatorUserId) url.searchParams.set("operatorUserId", operatorUserId);
    return fetch(url.pathname + url.search, init);
  }

  // 非 GET：把 operatorUserId 併進 JSON body
  let bodyObject: Record<string, unknown> = {};
  if (typeof init?.body === "string" && init.body.trim() !== "") {
    try {
      const parsed = JSON.parse(init.body);
      if (parsed && typeof parsed === "object") bodyObject = parsed as Record<string, unknown>;
    } catch {
      // 不是 JSON body（理論上普渡模組沒有這種呼叫），原樣送出不動它
      return fetch(input, init);
    }
  }

  return fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    body: JSON.stringify({ ...bodyObject, operatorUserId }),
  });
}
