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
  const [me, setMe] = useState<OperatorUser | null>(null);
  const [users, setUsers] = useState<OperatorUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setOperatorUserIdState(stored);
    } catch {
      // localStorage 在部分瀏覽器隱私模式可能不可用，忽略即可。
    }
  }, []);

  /**
   * V14.3 正式登入：操作人一律是「目前登入的使用者」（讀 /api/auth/me 的 session），
   * 不再由畫面自行挑選。仍把 id 寫進 localStorage，讓既有 fetch 包裝（會帶
   * operatorUserId）相容；伺服器端一律以 session 為準，前端送的只是相容用途。
   */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((data) => {
        if (cancelled) return;
        const u = data?.user ?? null;
        setMe(u);
        if (u?.id) {
          setOperatorUserIdState(u.id);
          try {
            window.localStorage.setItem(STORAGE_KEY, u.id);
          } catch {
            /* 忽略 */
          }
        }
      })
      .catch(() => {
        /* 未登入或取不到；middleware 會導向 /login */
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

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

  // V14.3：目前操作人優先用登入的 session 使用者（me）；退回名單比對（相容）。
  const operatorUser = me ?? users.find((u) => u.id === operatorUserId) ?? null;

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

/**
 * 「目前操作人員」的無 Context 版讀取器（V12.2 新增）。
 *
 * ⚠️ 這**不是**第二套身分機制——它讀的就是上面 OperatorProvider 寫入的
 * 同一個 localStorage key，是同一個單一來源，只是不需要元件樹上有
 * <OperatorProvider>。真正的權限驗證一律仍在伺服器端用這個 userId 重新查
 * 資料庫（見 src/lib/operator.ts），這裡跟 useOperator() 一樣都只是負責
 * 「把使用者選過的身分帶給 API」。
 *
 * 為什麼需要它：V12.2 依指令「五」把 GET /api/search 補上了信眾 view 權限
 * 檢查，但這支 API 除了首頁搜尋框之外，還有 6 個既有元件在用它做「挑一個
 * 人」的搜尋——收款中心快速收款、祭改報名、活動主畫面、爐主登錄、鮮花
 * 名冊、供品認捐。這些模組屬於本次指令「九、明確不做」的範圍外模組，不應該
 * 為了這件事去重構它們的元件樹（有些是深層的 Server Component 結構）；但
 * 如果放著不管，補上權限後這 6 個畫面的搜尋會對所有人回 401，等於用一個
 * 安全修正換掉六個正在用的功能。
 *
 * 折衷作法就是這個讀取器：那 6 個元件只要多一行就能帶上身分，不需要改動
 * 它們的結構，也不需要在那些畫面上新增操作人員選單（使用者只要在首頁或
 * 任一個既有的 OperatorBar 選過一次，這裡就讀得到）。
 */
export function readStoredOperatorUserId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useStoredOperatorUserId(): string | null {
  const [id, setId] = useState<string | null>(null);
  // localStorage 只能在瀏覽器端讀取，用 effect 避免 SSR/CSR 內容不一致。
  useEffect(() => {
    setId(readStoredOperatorUserId());
  }, []);
  return id;
}

/** 角色顯示名稱（跟 src/lib/permissions.ts 的 Role 保持一致）。 */
export const roleLabel: Record<string, string> = {
  SUPER_ADMIN: "最高管理員",
  ADMIN: "管理員",
  STAFF: "一般工作人員",
  READONLY: "唯讀人員",
  FINANCE_CLERK: "財務人員",
};
