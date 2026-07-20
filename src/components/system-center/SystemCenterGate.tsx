"use client";

import { useOperator } from "@/lib/operatorClient";
import { canSystem, type SystemAction } from "@/lib/permissions";

/**
 * 【系統管理】整個選單的畫面層級守門（對應指令「十四」：一般使用者不得
 * 看到Backup）。這裡只負責「看不看得到」，真正的安全防線在每一支 API
 * 內部呼叫的 assertSystemPermissionForOperator()——就算有人繞過這層畫面
 * 直接呼叫 API，一樣會被伺服器拒絕。
 *
 * 這裡刻意不在伺服器端（page.tsx）預先撈任何備份/GoogleDrive資料：
 * 「目前操作人員是誰」只存在瀏覽器的 localStorage，伺服器端渲染
 * page.tsx 的當下並不知道操作人員是誰，如果在那個階段就先把備份紀錄／
 * Google Drive 狀態撈出來塞進 HTML，等於讓「還沒選擇操作人員」的瀏覽器
 * 也能在網頁原始碼裡看到這些內容——所以系統管理中心底下的每個頁面都
 * 設計成「先看得到操作人員身分，才透過 API 用 useEffect 抓資料」的純
 * client 元件，不透過 Server Component 預先帶資料。
 *
 * V12「信眾資料中心正式建置」新增 action 這個選填參數（預設仍然是
 * "viewSystemCenter"，既有 6 個子頁面沒有傳這個參數，行為完全不變）：
 * 「使用者帳號管理」「信眾資料匯入」這兩個頁面改成分別檢查
 * "manageUsers"／"manageDataImport"，讓 ADMIN 可以個別使用這兩個功能，
 * 但不會因此打開 viewSystemCenter、看到備份/還原/Google Drive 這些
 * 仍然維持 SUPER_ADMIN 專屬的敏感功能（見 src/lib/permissions.ts
 * SYSTEM_PERMISSIONS 的說明）。
 */
export default function SystemCenterGate({
  children,
  action = "viewSystemCenter",
}: {
  children: React.ReactNode;
  action?: SystemAction;
}) {
  const { operatorUser, loading } = useOperator();

  if (loading) {
    return <p className="text-sm text-ink-faint">載入中…</p>;
  }

  if (!operatorUser || !canSystem(operatorUser.role, action)) {
    return (
      <div className="rounded-3xl bg-white/70 p-8 text-center shadow-card">
        <p className="text-sm text-ink-soft">
          這個功能目前操作人員沒有權限使用。請先在上方選擇具有對應權限的操作人員。
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
