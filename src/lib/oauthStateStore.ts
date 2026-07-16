import crypto from "node:crypto";

/**
 * Google OAuth「state」暫存（V11.2 新增）。
 *
 * Google 的 OAuth 導回（callback）請求是瀏覽器直接被導向我們的
 * callback 網址，不會帶著我們自己系統的 operatorUserId／任何驗證資訊
 * ——所以需要在「產生授權網址」的當下，先把「是誰按了連結按鈕」暫存
 * 起來，等 callback 回來時用 state 這個一次性亂數對回去，藉此：
 *   1. 防止 CSRF（state 不存在或已使用過就拒絕）。
 *   2. 知道要把 `connectedByName` 記錄成哪個操作人員。
 *
 * ⚠️ 這裡用「模組層級的記憶體 Map」暫存，不是資料庫——因為這只是短暫
 * （10 分鐘內）的一次性資訊，不需要永久保存。這個做法只在「單一、長時間
 * 執行的 Node process」下才正確（這個專案部署在 Render 的一般網站服務，
 * 符合這個條件；如果之後改成多實例/Serverless 部署，這裡需要改成存在
 * 資料庫或 Redis 等共用儲存，否則第一個實例產生的 state 可能被導到
 * 另一個實例的 callback，找不到對應資料）。
 */

type PendingState = { operatorName: string; createdAt: number };

const PENDING_STATES = new Map<string, PendingState>();
const TTL_MS = 10 * 60 * 1000; // 10 分鐘內沒完成授權就視為過期

function cleanupExpired() {
  const now = Date.now();
  for (const [key, value] of PENDING_STATES) {
    if (now - value.createdAt > TTL_MS) PENDING_STATES.delete(key);
  }
}

export function createPendingOAuthState(operatorName: string): string {
  cleanupExpired();
  const state = crypto.randomBytes(24).toString("hex");
  PENDING_STATES.set(state, { operatorName, createdAt: Date.now() });
  return state;
}

/** 驗證並「消耗」一個 state（一次性——驗證後立刻刪除，不能重複使用）。 */
export function consumePendingOAuthState(state: string | null | undefined): string | null {
  if (!state) return null;
  const pending = PENDING_STATES.get(state);
  PENDING_STATES.delete(state);
  if (!pending) return null;
  if (Date.now() - pending.createdAt > TTL_MS) return null;
  return pending.operatorName;
}
