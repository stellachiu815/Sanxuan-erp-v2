"use client";

import { useEffect, useState } from "react";
import { useOperator } from "@/lib/operatorClient";
import { canSystem } from "@/lib/permissions";
import {
  backupTypeLabel,
  backupStatusLabel,
  backupStatusColor,
  backupErrorCodeLabel,
  integrityCheckStatusLabel,
} from "@/lib/labels";

type BackupLogEntry = {
  id: string;
  type: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationSeconds: number | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  googleDriveFileId: string | null;
  googleDriveFolder: string | null;
  googleDriveFileWebViewLink: string | null;
  failureReason: string | null;
  failedStage: string | null;
  errorCode: string | null;
  sha256Checksum: string | null;
  reason: string | null;
  executedByName: string;
  isAutomatic: boolean;
  lastIntegrityCheckAt: string | null;
  lastIntegrityCheckStatus: string | null;
  lastIntegrityCheckDetail: string | null;
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "－";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 需求「九、備份紀錄頁面補強」＋「十、檢查備份完整性」。
 *
 * 「只有成功且檔案仍存在的備份，才能啟用下載及還原按鈕」：這裡的下載
 * 按鈕只依 `status === "SUCCESS" && googleDriveFileId` 顯示（前端判斷，
 * 體驗優化）；「檔案仍存在」這件事本身無法只靠 BackupLog 欄位確認
 * （Google Drive 那邊可能事後被手動刪除），真正確認要靠「檢查備份完整性」
 * 按鈕——這裡刻意不因為 status=SUCCESS 就自動判定完整，需要使用者主動
 * 執行檢查（對應指令「十、不得因 BackupLog 顯示 SUCCESS，就直接判定
 * 備份完整」）。還原本身在【還原中心】操作，這裡只提供「查看詳細資料」
 * 與「開啟 Google Drive」「下載」「檢查備份」四個動作。
 */
export default function BackupLogScreen() {
  const { operatorUserId, operatorUser } = useOperator();
  const [logs, setLogs] = useState<BackupLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const canDownload = operatorUser?.role ? canSystem(operatorUser.role, "downloadBackup") : false;

  function load() {
    if (!operatorUserId) return;
    setLoading(true);
    fetch(`/api/system-center/backup/logs?operatorUserId=${encodeURIComponent(operatorUserId)}`)
      .then((res) => res.json().then((d) => ({ ok: res.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          setError(d.error ?? "載入失敗");
          return;
        }
        setLogs(Array.isArray(d.logs) ? d.logs : []);
        setError(null);
      })
      .catch(() => setError("無法連線到伺服器"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatorUserId]);

  function downloadFile(log: BackupLogEntry) {
    if (!operatorUserId || !log.googleDriveFileId || !log.fileName) return;
    const url = `/api/system-center/backup/download?operatorUserId=${encodeURIComponent(operatorUserId)}&fileId=${encodeURIComponent(log.googleDriveFileId)}&fileName=${encodeURIComponent(log.fileName)}`;
    window.open(url, "_blank");
  }

  async function checkIntegrity(log: BackupLogEntry) {
    if (!operatorUserId) return;
    setCheckingId(log.id);
    try {
      const res = await fetch("/api/system-center/backup/check-integrity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId, backupLogId: log.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setLogs((prev) =>
          prev.map((l) =>
            l.id === log.id
              ? { ...l, lastIntegrityCheckAt: new Date().toISOString(), lastIntegrityCheckStatus: data.status, lastIntegrityCheckDetail: data.detail }
              : l
          )
        );
      }
    } finally {
      setCheckingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {loading && <p className="text-sm text-ink-faint">載入中…</p>}
      {error && <p className="text-sm text-blossom-600">{error}</p>}

      {!loading && !error && logs.length === 0 && (
        <p className="rounded-3xl bg-white/70 p-6 text-center text-sm text-ink-faint shadow-card">尚無備份紀錄</p>
      )}

      {logs.map((log) => {
        const canEnableDownload = canDownload && log.status === "SUCCESS" && !!log.googleDriveFileId;
        const expanded = expandedId === log.id;
        return (
          <div key={log.id} className="rounded-3xl bg-white/70 p-5 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-cream-200 px-3 py-1 text-xs text-ink">
                  {backupTypeLabel[log.type] ?? log.type}
                  {log.reason === "BEFORE_RESTORE" ? "（還原前保護性備份）" : ""}
                </span>
                <span className={`rounded-full px-3 py-1 text-xs ${backupStatusColor[log.status] ?? ""}`}>
                  {backupStatusLabel[log.status] ?? log.status}
                </span>
                <span className="text-xs text-ink-faint">{log.isAutomatic ? "自動" : "手動"}</span>
              </div>
              <p className="text-xs text-ink-faint">{new Date(log.startedAt).toLocaleString("zh-Hant")}</p>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-soft sm:grid-cols-4">
              <p>完成時間：{log.finishedAt ? new Date(log.finishedAt).toLocaleString("zh-Hant") : "－"}</p>
              <p>執行秒數：{log.durationSeconds !== null ? `${log.durationSeconds} 秒` : "－"}</p>
              <p>檔案大小：{formatBytes(log.fileSizeBytes)}</p>
              <p>執行者：{log.executedByName}</p>
              <p>Google Drive位置：{log.googleDriveFolder ?? "－"}</p>
            </div>

            {log.fileName && <p className="mt-2 text-xs text-ink-faint">檔名：{log.fileName}</p>}

            {log.status === "FAILED" && (
              <div className="mt-2 rounded-2xl bg-blossom-100 p-3 text-xs text-ink">
                <p>失敗階段：{log.failedStage ?? "未知"}</p>
                <p>錯誤類型：{log.errorCode ? backupErrorCodeLabel[log.errorCode] ?? log.errorCode : "未知系統錯誤"}</p>
                {log.failureReason && <p className="mt-1 text-ink-soft">{log.failureReason}</p>}
              </div>
            )}

            {log.lastIntegrityCheckStatus && (
              <p className="mt-2 text-xs text-ink-soft">
                完整性檢查：{integrityCheckStatusLabel[log.lastIntegrityCheckStatus] ?? log.lastIntegrityCheckStatus}
                {log.lastIntegrityCheckAt ? `（${new Date(log.lastIntegrityCheckAt).toLocaleString("zh-Hant")}）` : ""}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {canEnableDownload && (
                <button
                  type="button"
                  onClick={() => downloadFile(log)}
                  className="min-h-9 rounded-full bg-white px-4 text-xs text-ink shadow-soft transition hover:bg-cream-100"
                >
                  下載
                </button>
              )}
              {log.googleDriveFileWebViewLink && (
                <a
                  href={log.googleDriveFileWebViewLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-9 items-center rounded-full bg-white px-4 text-xs text-ink shadow-soft transition hover:bg-cream-100"
                >
                  開啟 Google Drive
                </a>
              )}
              {canEnableDownload && (
                <button
                  type="button"
                  disabled={checkingId === log.id}
                  onClick={() => checkIntegrity(log)}
                  className="min-h-9 rounded-full bg-yolk-200 px-4 text-xs text-ink transition hover:bg-yolk-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {checkingId === log.id ? "檢查中…" : "檢查備份"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : log.id)}
                className="min-h-9 rounded-full bg-white px-4 text-xs text-ink-soft shadow-soft transition hover:bg-cream-100"
              >
                {expanded ? "收合詳細資料" : "查看詳細資料"}
              </button>
            </div>

            {expanded && (
              <div className="mt-3 rounded-2xl bg-cream-50 p-3 text-xs text-ink-soft">
                <p className="break-all">SHA-256：{log.sha256Checksum ?? "（此筆備份建立於加入校驗碼功能之前，無記錄）"}</p>
                <p className="break-all">Google Drive File ID：{log.googleDriveFileId ?? "－"}</p>
                {log.lastIntegrityCheckDetail && <p className="mt-1">完整性檢查詳情：{log.lastIntegrityCheckDetail}</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
