"use client";

import Link from "next/link";
import { useOperator } from "@/lib/operatorClient";
import { canSystem } from "@/lib/permissions";

/**
 * V12「信眾資料中心正式建置」指令「九」新增。
 *
 * 放在系統管理中心首頁、SystemCenterGate（SUPER_ADMIN 專屬的完整選單）
 * 之外——這裡各自用 manageUsers／manageDataImport 個別檢查，讓 ADMIN
 * 可以看到並使用「使用者帳號管理」「信眾資料匯入」這兩個功能，但不會
 * 因此看到備份／還原／Google Drive 連線這些仍然維持 SUPER_ADMIN 專屬的
 * 敏感功能（見 src/lib/permissions.ts SYSTEM_PERMISSIONS 的說明）。
 *
 * SUPER_ADMIN 兩個入口都看得到（原本 SystemCenterGate 底下的完整選單也
 * 有「信眾資料匯入」，這裡對 SUPER_ADMIN 來說是重複入口，但保留是為了
 * 讓 ADMIN／SUPER_ADMIN 看到的頁面結構一致，不用因為角色不同而有兩套
 * 不同的操作路徑）。
 */
export default function AdminToolsSection() {
  const { operatorUser, loading } = useOperator();

  if (loading || !operatorUser) return null;

  const canManageUsers = canSystem(operatorUser.role, "manageUsers");
  const canImport = canSystem(operatorUser.role, "manageDataImport");

  if (!canManageUsers && !canImport) return null;

  return (
    <section className="rounded-3xl bg-white/70 p-6 shadow-card">
      <h2 className="text-base font-medium text-ink">🔑 一般行政管理功能</h2>
      <p className="mt-1 text-xs text-ink-faint">依目前操作人員角色可使用的管理功能，跟下方僅最高管理員可見的系統維運功能分開。</p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {canManageUsers && (
          <Link href="/system-center/users" className="rounded-3xl bg-yolk-100 p-6 shadow-card transition hover:bg-yolk-200">
            <p className="text-base text-ink">👤 使用者帳號管理</p>
            <p className="mt-1 text-xs text-ink-faint">建立操作人員、修改姓名、啟用／停用、指定角色</p>
          </Link>
        )}
        {canImport && (
          <Link href="/system-center/data-import" className="rounded-3xl bg-sage-100 p-6 shadow-card transition hover:bg-sage-200">
            <p className="text-base text-ink">📥 信眾資料匯入</p>
            <p className="mt-1 text-xs text-ink-faint">正式家戶 Excel 欄位對照、預覽、匯入</p>
          </Link>
        )}
      </div>
    </section>
  );
}
