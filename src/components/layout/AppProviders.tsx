"use client";

import { useEffect } from "react";
import { OperatorProvider } from "@/lib/operatorClient";
import { installGlobalAuthHandler } from "@/lib/apiClient";

/**
 * V14.3：全站共用 Provider。
 *
 * - OperatorProvider：載入 /api/auth/me 取得目前登入者（唯一來源），供
 *   useCurrentUser／usePermission／<Can>／<PermissionGate> 使用。頁面重新
 *   整理後仍會重新打 /api/auth/me，因此權限狀態能正確還原。
 * - installGlobalAuthHandler：全站攔截 /api/* 的 401，Session 過期一律導回
 *   登入頁。
 *
 * 既有頁面若自己還包了一層 <OperatorProvider> 也沒關係（就近取用、行為不變），
 * 這裡確保「沒有自己包的頁面」也有統一的登入者來源。
 */
export default function AppProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    installGlobalAuthHandler();
  }, []);
  return <OperatorProvider>{children}</OperatorProvider>;
}
