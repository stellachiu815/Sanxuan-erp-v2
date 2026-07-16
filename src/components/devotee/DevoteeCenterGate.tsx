"use client";

import { useOperator } from "@/lib/operatorClient";
import { canSeeDevoteeMenu } from "@/lib/permissions";

/**
 * 【信眾關係中心】選單/頁面層級守門，比照 SystemCenterGate 同一套模式
 * （對應指令「十六」：STAFF/FINANCE_CLERK 完全看不到這個中心，READONLY
 * 只能查看）。這裡只負責「看不看得到」，真正的安全防線在每一支 API
 * 內部呼叫的 assertDevoteePermissionForOperator()。
 */
export default function DevoteeCenterGate({ children }: { children: React.ReactNode }) {
  const { operatorUser, loading } = useOperator();

  if (loading) {
    return <p className="text-sm text-ink-faint">載入中…</p>;
  }

  if (!operatorUser || !canSeeDevoteeMenu(operatorUser.role)) {
    return (
      <div className="rounded-3xl bg-white/70 p-8 text-center shadow-card">
        <p className="text-sm text-ink-soft">
          【信眾關係中心】目前操作人員沒有查看權限。請先在上方選擇具有查看權限的操作人員。
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
