"use client";

/**
 * V14.3【前端角色顯示與操作收斂】唯一共用前端權限層。
 *
 * ── 設計原則（呼應指令）───────────────────────────────────────
 * 1. API 權限（assertXForOperator）才是唯一安全防線；這一層只負責「不要讓
 *    使用者看到／點到自己不能操作的功能」，避免誤操作與挫折。
 * 2. 這裡**不定義任何權限矩陣**——一律沿用 src/lib/permissions.ts 既有的
 *    canX(role, action)。本檔只提供「怎麼在畫面上套用它」的共用元件／hook，
 *    不複製、不改寫規則。
 * 3. 全站只有這一套共用方式（useCurrentUser / usePermission / <Can> /
 *    <PermissionGate>），不另立第二套角色判斷。
 *
 * 登入者來源：既有 OperatorProvider（operatorClient.tsx）已經在載入時打
 * /api/auth/me 取得 session 使用者。這裡直接沿用 useOperator()，不新增第二
 * 個登入或使用者查詢機制。
 */

import { useRouter } from "next/navigation";
import { useOperator, type OperatorUser } from "@/lib/operatorClient";
import type { Role } from "@/lib/permissions";

export type CurrentUser = {
  id: string;
  displayName: string;
  role: Role;
  isActive: boolean;
};

type CurrentUserState = {
  user: CurrentUser | null;
  role: Role | null;
  loading: boolean;
  /** 已載入且確定沒有登入者（middleware 理論上會先擋，但 client 端仍要能判斷）。 */
  isAnonymous: boolean;
};

/**
 * 取得目前登入者（單一來源：/api/auth/me 經 OperatorProvider）。
 * 若能取到 operatorUser 即代表 session 有效且帳號未停用（getSessionUser 會
 * 對停用帳號回 null），因此 isActive 對「拿得到的 user」恆為 true。
 */
export function useCurrentUser(): CurrentUserState {
  const { operatorUser, loading } = useOperator();
  const user: CurrentUser | null = operatorUser
    ? { id: operatorUser.id, displayName: operatorUser.name, role: operatorUser.role, isActive: true }
    : null;
  return {
    user,
    role: user?.role ?? null,
    loading,
    isAnonymous: !loading && !user,
  };
}

/**
 * 以「目前登入者的角色」套用任一個 permissions.ts 的 canX 判斷。
 * 用法：usePermission((role) => canSystem(role, "manageUsers"))
 * 沒有登入者或還在載入時回 false（畫面預設不顯示，較安全）。
 */
export function usePermission(check: (role: Role) => boolean): boolean {
  const { role } = useCurrentUser();
  return role ? check(role) : false;
}

/**
 * 條件顯示元件：權限通過才 render children，否則 render fallback（預設不顯示）。
 * 用來包住「新增／刪除／收款／列印」等寫入按鈕。
 *
 * <Can check={(role) => canOffering(role, "recordPayment")}>
 *   <button>收款</button>
 * </Can>
 */
export function Can({
  check,
  children,
  fallback = null,
}: {
  check: (role: Role) => boolean;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return <>{usePermission(check) ? children : fallback}</>;
}

/**
 * 頁面層守門：受限管理頁包在這裡面，處理「直接輸入網址」的情況。
 * - 載入中 → 顯示載入訊息
 * - 未登入 → 導回 /login（middleware 通常已擋，這是雙保險）
 * - 已登入但無權限 → 顯示 403 無權限畫面（不先渲染完整表單再等送出才報錯）
 *
 * 真正安全仍在 API；這裡是體驗與避免誤導。
 */
export function PermissionGate({
  check,
  children,
  title = "沒有權限",
  message = "您沒有使用這個功能的權限，若有需要請聯繫系統管理員。",
}: {
  check: (role: Role) => boolean;
  children: React.ReactNode;
  title?: string;
  message?: string;
}) {
  const router = useRouter();
  const { role, loading, isAnonymous } = useCurrentUser();

  if (loading) {
    return <p className="p-8 text-center text-sm text-ink-faint">載入中…</p>;
  }

  if (isAnonymous) {
    if (typeof window !== "undefined") {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      router.replace(`/login?next=${next}`);
    }
    return <p className="p-8 text-center text-sm text-ink-faint">請先登入…</p>;
  }

  if (!role || !check(role)) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-3xl bg-white/70 p-8 text-center shadow-card">
        <p className="text-base font-medium text-ink-soft">{title}</p>
        <p className="mt-2 text-sm text-ink-faint">{message}</p>
        <button
          onClick={() => router.push("/")}
          className="mt-6 rounded-full bg-butter-100 px-5 py-2 text-sm text-ink-soft hover:bg-butter-200"
        >
          回首頁
        </button>
      </div>
    );
  }

  return <>{children}</>;
}

export type { OperatorUser };
