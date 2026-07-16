"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Role } from "@/lib/permissions";

/**
 * 「目前操作人員」的前端狀態管理（V11.1.1 新增）。
 *
 * 設計原則（呼應 src/lib/operator.ts 的伺服器端說明）：這不是登入系統，只是
 * 讓使用者從既有人員名單裡「選出自己是誰」，選擇結果存在瀏覽器
 * localStorage，之後每次呼叫收據相關 API 都會帶上這個 userId。真正的權限
 * 檢查一律在伺服器端用這個 userId 重新查資料庫完成（見 src/lib/operator.ts），
 * 前端這裡只是負責「記住使用者選了誰」以及「把目前角色顯示出來，方便畫面
 * 隱藏未授權按鈕、減少誤操作」——前端隱藏按鈕不是安全機制，只是體驗優化。
 */

const STORAGE_KEY = "sanxuan.receiptCenter.operatorUserId";

/**
 * role 直接採用 src/lib/permissions.ts 的 Role 型別（跟 prisma/schema.prisma
 * 的 Role enum 對齊），不是隨便一個 string——GET /api/system/users 回傳的值
 * 保證是 Role enum 的其中一員，這裡用真正的型別而不是 string，才能讓
 * canReceipt(role, action) 這類呼叫在編譯期就檢查正確，不需要任何型別斷言。
 */
export type OperatorUser = { id: string; name: string; role: Role };

type OperatorContextValue = {
  operatorUserId: string | null;
  operatorUser: OperatorUser | null;
  users: OperatorUser[];
  loading: boolean;
  error: string | null;
  setOperatorUserId: (id: string | null) => void;
  reload: () => void;
};

const OperatorContext = createContext<OperatorContextValue | null>(null);

export function OperatorProvider({ children }: { children: React.ReactNode }) {
  const [operatorUserId, setOperatorUserIdState] = useState<string | null>(null);
  const [users, setUsers] = useState<OperatorUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setOperatorUserIdState(stored);
    } catch {
      // localStorage 在部分瀏覽器隱私模式可能不可用，忽略即可，操作人員仍可
      // 在畫面上重新選一次。
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/system/users")
      .then((res) => {
        if (!res.ok) throw new Error("無法載入操作人員名單");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setUsers(Array.isArray(data.users) ? data.users : []);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("無法載入操作人員名單，請重新整理頁面");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  const setOperatorUserId = useCallback((id: string | null) => {
    setOperatorUserIdState(id);
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 同上，忽略即可。
    }
  }, []);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  const operatorUser = users.find((u) => u.id === operatorUserId) ?? null;

  return (
    <OperatorContext.Provider
      value={{ operatorUserId, operatorUser, users, loading, error, setOperatorUserId, reload }}
    >
      {children}
    </OperatorContext.Provider>
  );
}

export function useOperator(): OperatorContextValue {
  const ctx = useContext(OperatorContext);
  if (!ctx) {
    throw new Error("useOperator() 必須在 <OperatorProvider> 內使用");
  }
  return ctx;
}

/** 角色顯示名稱（跟 src/lib/permissions.ts 的 Role 保持一致）。 */
export const roleLabel: Record<string, string> = {
  SUPER_ADMIN: "最高管理員",
  ADMIN: "管理員",
  STAFF: "一般工作人員",
  READONLY: "唯讀人員",
  FINANCE_CLERK: "財務人員",
};
