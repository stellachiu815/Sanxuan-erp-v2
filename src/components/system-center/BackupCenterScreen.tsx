"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useOperator } from "@/lib/operatorClient";
import { canSystem } from "@/lib/permissions";
import { backupErrorCodeLabel } from "@/lib/labels";

type BackupResult = {
  ok: true;
  backupLogId: string;
  fileName: string;
  fileSizeBytes: number;
  googleDriveFileId: string;
  googleDriveFolder: string;
  sha256Checksum: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * 需求「四、立即備份」＋「七、備份執行防重複機制」＋「八、備份失敗處理」。
 *
 * 這個元件不會在伺服器端預先撈任何資料（見 SystemCenterGate 的說明），
 * 「立即備份」是一個真的會花時間（pg_dump + zip + 上傳 Google Drive）
 * 的動作：按下去之後按鈕立刻 disabled，並且每隔 1.5 秒輪詢一次
 * GET /api/system-center/backup/run-status 顯示目前卡在哪個階段——
 * 這是真實的階段字串，不是假造的百分比進度條。
 */
export default function BackupCenterScreen() {
  const { operatorUserId, operatorUser } = useOperator();
  const [running, setRunning] = useState(false);
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<BackupResult | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const canRun = operatorUser?.role ? canSystem(operatorUser.role, "runBackup") : false;
  const canDownload = operatorUser?.role ? canSystem(operatorUser.role, "downloadBackup") : false;

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer.current = setInterval(async () => {
      if (!operatorUserId) return;
      try {
        const res = await fetch(`/api/system-center/backup/run-status?operatorUserId=${encodeURIComponent(operatorUserId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.currentStageLabel) setStageLabel(data.currentStageLabel);
        // 這個輪詢也負責偵測「頁面載入時偵測到的別處執行中備份」何時
        // 結束——本分頁自己發出的 runBackup() 有自己的 finally 收尾，
        // 這裡的判斷只在「不是本分頁觸發、單純偵測到現狀」時才有意義，
        // 用 status 不是 IN_PROGRESS 當作結束訊號，重新整理一次畫面狀態。
        if (data.status && data.status !== "IN_PROGRESS") {
          stopPolling();
          setRunning(false);
          setStageLabel(null);
          setMessage(data.status === "SUCCESS" ? "先前偵測到的備份已完成，請重新整理查看結果。" : null);
        }
      } catch {
        // 輪詢失敗不影響主要的備份請求本身，安靜略過，等下一次輪詢。
      }
    }, 1500);
  }

  // 對應指令「七、1. 同一時間只能執行一個備份工作」：頁面剛載入、或從
  // 另一個分頁/裝置重新整理時，也要能偵測到「其實已經有備份在別的地方
  // 執行中」，而不是只靠這個元件自己 state 裡的 `running`（重新整理後
  // 會歸零，但伺服器端的鎖不會）。
  useEffect(() => {
    if (!operatorUserId) return;
    let cancelled = false;
    fetch(`/api/system-center/backup/run-status?operatorUserId=${encodeURIComponent(operatorUserId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (data.status === "IN_PROGRESS") {
          setRunning(true);
          setMessage("目前已有備份正在執行，請勿重複操作。");
          setStageLabel(data.currentStageLabel ?? "執行中");
          startPolling();
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatorUserId]);

  async function runBackup() {
    if (!operatorUserId) {
      setMessage("請先在上方選擇目前操作人員");
      return;
    }
    setRunning(true);
    setMessage(null);
    setLastResult(null);
    setStageLabel("準備開始");
    // POST /backup/run 要等整個備份做完才會回應（見該路由註解），這裡
    // 在送出請求的「同時」另外每 1.5 秒輪詢一次目前進度階段——伺服器是
    // 單一長時間執行的 Node process，兩個請求可以並行處理，不互相阻塞。
    startPolling();
    try {
      const res = await fetch("/api/system-center/backup/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId }),
      });
      const data = await res.json();
      if (res.status === 409 && data.locked) {
        setMessage("目前已有備份正在執行，請勿重複操作。");
        return;
      }
      if (!res.ok) {
        const codeLabel = data.errorCode ? backupErrorCodeLabel[data.errorCode] ?? data.errorCode : null;
        setMessage(`備份失敗${codeLabel ? `（${codeLabel}）` : ""}：${data.error ?? "未知錯誤"}`);
        return;
      }
      setLastResult(data);
    } catch {
      setMessage("備份失敗：無法連線到伺服器");
    } finally {
      setRunning(false);
      setStageLabel(null);
      stopPolling();
    }
  }

  function downloadResult() {
    if (!lastResult || !operatorUserId) return;
    const url = `/api/system-center/backup/download?operatorUserId=${encodeURIComponent(operatorUserId)}&fileId=${encodeURIComponent(lastResult.googleDriveFileId)}&fileName=${encodeURIComponent(lastResult.fileName)}`;
    window.open(url, "_blank");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl bg-white/70 p-6 shadow-card">
        <h2 className="text-sm text-ink">立即備份</h2>
        <p className="mt-2 text-xs text-ink-faint">
          會完整備份：PostgreSQL資料庫、Prisma Schema版本、系統設定、使用者、權限、信眾資料、家戶資料、
          活動資料、普渡資料、祭改資料、收款、收據、上傳圖片／PDF、收據流水號、系統版本、原始環境識別
          資訊、SHA-256校驗碼，打包成 SanxuanERP_Manual_YYYY-MM-DD_HHmmss.zip 上傳到 Google Drive 的
          Daily 資料夾。
        </p>

        {!canRun && (
          <p className="mt-4 text-xs text-blossom-600">目前操作人員沒有執行備份的權限。</p>
        )}

        <button
          type="button"
          disabled={!canRun || running}
          onClick={runBackup}
          className="mt-4 min-h-11 rounded-full bg-sage-200 px-6 text-sm text-ink transition hover:bg-sage-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? `備份進行中…${stageLabel ? `（${stageLabel}）` : ""}` : "立即備份"}
        </button>

        {message && <p className="mt-3 text-sm text-ink-soft">{message}</p>}

        {lastResult && (
          <div className="mt-4 rounded-2xl bg-sage-100 p-4 text-sm text-ink">
            <p>✅ 備份成功</p>
            <p className="mt-1 text-xs text-ink-faint">檔名：{lastResult.fileName}</p>
            <p className="text-xs text-ink-faint">大小：{formatBytes(lastResult.fileSizeBytes)}</p>
            <p className="text-xs text-ink-faint">位置：Google Drive／三玄宮ERP_Backup／{lastResult.googleDriveFolder}</p>
            <p className="text-xs text-ink-faint break-all">SHA-256：{lastResult.sha256Checksum}</p>
            {canDownload && (
              <button
                type="button"
                onClick={downloadResult}
                className="mt-3 min-h-9 rounded-full bg-white px-4 text-xs text-ink shadow-soft transition hover:bg-cream-100"
              >
                下載這份備份
              </button>
            )}
          </div>
        )}
      </div>

      <div className="rounded-3xl bg-white/70 p-6 text-xs text-ink-faint shadow-soft">
        <p>
          自動備份不需要在這裡手動觸發：每日 02:00／每週日 03:00／每月 1 號 04:00（Asia/Taipei）由外部
          排程服務呼叫排程觸發 API 自動執行，執行紀錄可以在【系統Log】查詢，下載某一份歷史備份可以到
          【還原中心】瀏覽 Daily/Weekly/Monthly/Before_Update 資料夾後下載。
        </p>
        <Link href="/system-center/restore" className="mt-2 inline-block text-ink-soft underline-offset-4 hover:underline">
          前往還原中心瀏覽歷史備份 →
        </Link>
      </div>
    </div>
  );
}
