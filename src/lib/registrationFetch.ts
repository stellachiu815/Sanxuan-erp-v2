import { readStoredOperatorUserId } from "@/lib/operatorClient";

/**
 * V13.4：活動報名相關 API 的前端呼叫包裝。
 *
 * ⚠️ 這一支在**第一天**就建立，不是事後補救。
 *
 * V13.3A 的教訓：後端補了權限檢查，前端沒跟上，整個普渡模組被 401 鎖死。
 * 那次是「先寫後端、後來才發現前端沒帶身分」。這一輪所有新 API 從一開始
 * 就走這個包裝，並有靜態測試強制檢查沒有漏網的原生 fetch。
 *
 * 沿用既有的 readStoredOperatorUserId()（localStorage，與收款中心、
 * 祭改報名、供品面板、普渡模組同一套），**不新增第二套身分來源**。
 *
 * GET  → 自動附加 ?operatorUserId=xxx
 * 其他 → 自動在 JSON body 併入 operatorUserId
 *
 * 前端送的只是一個「待查證的 id」，真正的權限判斷在後端
 * assertRitualRegistrationPermissionForOperator()——由它查資料庫確認
 * 使用者存在、未停用，並用資料庫查到的角色決定能不能做這件事。
 */
export async function fetchRegistration(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const operatorUserId = readStoredOperatorUserId();
  const method = (init?.method ?? "GET").toUpperCase();

  if (method === "GET" || method === "HEAD") {
    const url = new URL(input, window.location.origin);
    if (operatorUserId) url.searchParams.set("operatorUserId", operatorUserId);
    return fetch(url.pathname + url.search, init);
  }

  let bodyObject: Record<string, unknown> = {};
  if (typeof init?.body === "string" && init.body.trim() !== "") {
    try {
      const parsed = JSON.parse(init.body);
      if (parsed && typeof parsed === "object") bodyObject = parsed as Record<string, unknown>;
    } catch {
      return fetch(input, init);
    }
  }

  return fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    body: JSON.stringify({ ...bodyObject, operatorUserId }),
  });
}

/**
 * 把伺服器回傳的錯誤轉成使用者看得懂的中文（V13.4 指令十二）。
 *
 * 不把技術錯誤直接丟給行政人員看。
 */
export function toFriendlyError(status: number, serverMessage?: string | null): string {
  // 伺服器已經給了中文說明就直接用——那些訊息都是寫給使用者看的
  if (serverMessage && !/^[A-Za-z0-9_\s.:{}[\]"'-]+$/.test(serverMessage)) {
    return serverMessage;
  }
  switch (status) {
    case 401:
      return "找不到目前的操作人員身分，請重新於右上角選擇操作人員後再試一次。";
    case 403:
      return "目前的操作人員沒有權限執行這個操作。";
    case 404:
      return "找不到這筆資料，可能已被移除或尚未建立。";
    case 409:
      return serverMessage || "目前的資料狀態無法完成這個操作，請重新整理後確認。";
    case 500:
      return "系統發生問題，請稍後再試一次；若持續發生請聯絡系統管理者。";
    default:
      return serverMessage || "操作失敗，請稍後再試一次。";
  }
}
