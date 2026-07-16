"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OperatorProvider, useOperator } from "@/lib/operatorClient";
import { canSystem } from "@/lib/permissions";

type StatusResponse = {
  lastSuccessAt: string | null;
  googleDriveEmail: string | null;
  googleDriveStatus: string;
  nextScheduledAt: string;
  statusColor: "green" | "yellow" | "red";
};

const DOT: Record<string, string> = { green: "🟢", yellow: "🟡", red: "🔴" };

/**
 * 需求「十一、首頁顯示備份狀態」：最後成功備份時間、綁定的 Google Drive
 * 帳號、下一次排程時間、狀態燈號。
 *
 * 需求「十四」：一般使用者不得看到Backup——所以這張卡片整個只在「目前
 * 操作人員是 SUPER_ADMIN」時才顯示，一般使用者／尚未選擇操作人員時，
 * 這裡完全不渲染任何內容（不是隱藏起來的空殼，是連 DOM 都不輸出），
 * 首頁其他人看起來就跟系統管理中心不存在一樣。
 *
 * 這裡自己包一層 OperatorProvider：跟收據中心頁面共用同一組
 * localStorage（見 operatorClient.tsx），所以只要使用者之前在任何一個
 * 中心選過操作人員，首頁會自動沿用同一個身分，不需要重選。
 */
function SystemCenterHomeCardInner() {
  const { operatorUserId, operatorUser } = useOperator();
  const [status, setStatus] = useState<StatusResponse | null>(null);

  const canView = operatorUser?.role ? canSystem(operatorUser.role, "viewSystemCenter") : false;

  useEffect(() => {
    if (!operatorUserId || !canView) return;
    fetch(`/api/system-center/backup/status?operatorUserId=${encodeURIComponent(operatorUserId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setStatus(data))
      .catch(() => setStatus(null));
  }, [operatorUserId, canView]);

  if (!canView || !status) return null;

  return (
    <section className="w-full max-w-3xl rounded-3xl bg-white/70 p-6 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-ink">🛠️ 系統管理｜備份狀態</h2>
        <Link href="/system-center" className="text-sm text-ink-faint underline-offset-4 hover:underline">
          前往系統管理 →
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl bg-cream-200 p-4">
          <p className="text-xs text-ink-faint">備份狀態</p>
          <p className="mt-1 text-lg text-ink">{DOT[status.statusColor]}</p>
        </div>
        <div className="rounded-2xl bg-sage-100 p-4">
          <p className="text-xs text-ink-faint">最後成功備份</p>
          <p className="mt-1 text-sm text-ink">
            {status.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleString("zh-Hant") : "尚無成功紀錄"}
          </p>
        </div>
        <div className="rounded-2xl bg-mist-100 p-4">
          <p className="text-xs text-ink-faint">Google Drive帳號</p>
          <p className="mt-1 text-sm text-ink">{status.googleDriveEmail ?? "尚未連結"}</p>
        </div>
        <div className="rounded-2xl bg-yolk-100 p-4">
          <p className="text-xs text-ink-faint">下次排程</p>
          <p className="mt-1 text-sm text-ink">{new Date(status.nextScheduledAt).toLocaleString("zh-Hant")}</p>
        </div>
      </div>
    </section>
  );
}

export default function SystemCenterHomeCard() {
  return (
    <OperatorProvider>
      <SystemCenterHomeCardInner />
    </OperatorProvider>
  );
}
