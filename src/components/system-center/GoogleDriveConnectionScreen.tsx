"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useOperator } from "@/lib/operatorClient";
import { canSystem } from "@/lib/permissions";

type ConnectionTestItem = { key: string; label: string; ok: boolean; detail: string };
type ConnectionTestResult = { ranAt: string; overallOk: boolean; items: ConnectionTestItem[] };

type StatusResponse = {
  status: "DISCONNECTED" | "CONNECTED" | "ERROR";
  tokenStatus: string;
  boundEmail: string | null;
  connectedAt: string | null;
  connectedByName: string | null;
  lastVerifiedAt: string | null;
  lastUploadAt: string | null;
  lastError: string | null;
  rootFolderName: string | null;
  rootFolderWebViewLink: string | null;
  folders: { root: boolean; daily: boolean; weekly: boolean; monthly: boolean; beforeUpdate: boolean };
  lastTestResult: ConnectionTestResult | null;
};

const STATUS_LABEL: Record<string, string> = {
  DISCONNECTED: "尚未連結",
  CONNECTED: "已連結",
  ERROR: "連線異常",
};

const STATUS_COLOR: Record<string, string> = {
  DISCONNECTED: "bg-cream-200 text-ink-faint",
  CONNECTED: "bg-sage-100 text-ink",
  ERROR: "bg-blossom-100 text-ink",
};

/**
 * 需求「二、Google Drive連線」＋「三、連線頁面補強」＋「四、測試連線」。
 *
 * 這裡刻意固定只用 fa0225234163@gmail.com 當作 login_hint（見
 * /api/system-center/google-drive/connect），但實際綁定的帳號是以
 * Google 授權完成後回傳的帳號為準（login_hint 只是方便輸入，不是安全
 * 控制），這裡忠實顯示伺服器實際記錄的 boundEmail；如果 Google 沒有
 * 回傳可辨識的帳號資訊，明確顯示「已連線，但尚未取得帳號識別資料」，
 * 不猜測、不寫死帳號（對應指令「三」）。
 */
export default function GoogleDriveConnectionScreen() {
  const { operatorUserId, operatorUser } = useOperator();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const canManage = operatorUser?.role ? canSystem(operatorUser.role, "manageGoogleDriveConnection") : false;

  const loadStatus = useCallback(() => {
    if (!operatorUserId) return;
    setLoading(true);
    fetch(`/api/system-center/google-drive/status?operatorUserId=${encodeURIComponent(operatorUserId)}`)
      .then((res) => res.json())
      .then((data) => {
        setStatus(data);
        if (data.lastTestResult) setTestResult(data.lastTestResult);
      })
      .catch(() => setMessage("無法載入連線狀態"))
      .finally(() => setLoading(false));
  }, [operatorUserId]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (connected) {
      setMessage(`✅ 已成功連結 Google Drive：${connected}`);
      loadStatus();
    } else if (error) {
      setMessage(`❌ 連結失敗：${error}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function connect() {
    if (!operatorUserId) {
      setMessage("請先在上方選擇目前操作人員");
      return;
    }
    setConnecting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/system-center/google-drive/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`無法產生授權連結：${data.error ?? "未知錯誤"}`);
        return;
      }
      window.location.href = data.authUrl;
    } catch {
      setMessage("無法連線到伺服器");
      setConnecting(false);
    }
  }

  async function disconnect() {
    if (!operatorUserId) return;
    if (!window.confirm("確定要解除 Google Drive 授權嗎？解除後，自動備份將無法上傳，直到重新連結為止。")) {
      return;
    }
    setMessage(null);
    const res = await fetch("/api/system-center/google-drive/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operatorUserId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(`解除授權失敗：${data.error ?? "未知錯誤"}`);
      return;
    }
    setMessage("已解除 Google Drive 授權");
    setTestResult(null);
    loadStatus();
  }

  async function testConnection() {
    if (!operatorUserId) return;
    setTesting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/system-center/google-drive/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`測試連線失敗：${data.error ?? "未知錯誤"}`);
        return;
      }
      setTestResult(data);
      loadStatus();
    } catch {
      setMessage("無法連線到伺服器");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {message && <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink-soft shadow-soft">{message}</p>}

      <div className="rounded-3xl bg-white/70 p-6 shadow-card">
        <div className="flex items-center justify-between">
          <h2 className="text-sm text-ink">目前連線狀態</h2>
          {status && (
            <span className={`rounded-full px-3 py-1 text-xs ${STATUS_COLOR[status.status]}`}>
              {STATUS_LABEL[status.status]}
            </span>
          )}
        </div>

        {loading && <p className="mt-3 text-sm text-ink-faint">載入中…</p>}

        {status && status.status === "CONNECTED" && (
          <div className="mt-3 rounded-2xl bg-mist-100 p-3 text-xs text-ink-soft">
            {status.boundEmail
              ? `已固定綁定 Google Drive 帳號：${status.boundEmail}`
              : "已連線，但尚未取得帳號識別資料"}
            <br />
            系統備份使用以上固定綁定帳號，與目前瀏覽器登入的 Google 帳號無關。
          </div>
        )}

        {status && (
          <div className="mt-4 grid grid-cols-1 gap-3 text-sm text-ink-soft sm:grid-cols-2">
            <p>Token 狀態：{status.tokenStatus}</p>
            <p>
              連結時間：
              {status.connectedAt ? new Date(status.connectedAt).toLocaleString("zh-Hant") : "－"}
              {status.connectedByName ? `（由 ${status.connectedByName} 執行）` : ""}
            </p>
            <p>最近一次成功驗證：{status.lastVerifiedAt ? new Date(status.lastVerifiedAt).toLocaleString("zh-Hant") : "－"}</p>
            <p>最近一次成功上傳：{status.lastUploadAt ? new Date(status.lastUploadAt).toLocaleString("zh-Hant") : "尚無成功上傳紀錄"}</p>
            <p>備份根資料夾：{status.rootFolderName ?? "尚未建立"}</p>
            {status.lastError && <p className="text-blossom-600">連線錯誤原因：{status.lastError}</p>}
          </div>
        )}

        {status?.status === "CONNECTED" && status.rootFolderWebViewLink && (
          <a
            href={status.rootFolderWebViewLink}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block min-h-9 rounded-full bg-white px-4 py-2 text-xs text-ink shadow-soft transition hover:bg-cream-100"
          >
            開啟 Google Drive 備份資料夾 →
          </a>
        )}

        {status?.status === "CONNECTED" && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {(["root", "daily", "weekly", "monthly", "beforeUpdate"] as const).map((k) => (
              <span
                key={k}
                className={`rounded-full px-3 py-1 ${status.folders[k] ? "bg-sage-100 text-ink" : "bg-cream-200 text-ink-faint"}`}
              >
                {k === "root" ? "根資料夾" : k === "daily" ? "Daily" : k === "weekly" ? "Weekly" : k === "monthly" ? "Monthly" : "Before_Update"}
                {status.folders[k] ? " ✓" : " －"}
              </span>
            ))}
          </div>
        )}

        {!canManage && (
          <p className="mt-4 text-xs text-blossom-600">目前操作人員沒有管理 Google Drive 連線的權限。</p>
        )}

        {canManage && (
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={connecting}
              onClick={connect}
              className="min-h-10 rounded-full bg-mist-200 px-6 text-sm text-ink transition hover:bg-mist-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status?.status === "CONNECTED" ? "重新連結／重新授權" : "連結Google Drive"}
            </button>
            {status?.status === "CONNECTED" && (
              <>
                <button
                  type="button"
                  disabled={testing}
                  onClick={testConnection}
                  className="min-h-10 rounded-full bg-yolk-200 px-6 text-sm text-ink transition hover:bg-yolk-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {testing ? "測試中…" : "測試連線"}
                </button>
                <button
                  type="button"
                  onClick={disconnect}
                  className="min-h-10 rounded-full bg-white px-6 text-sm text-ink-soft shadow-soft transition hover:bg-cream-100"
                >
                  解除授權
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {testResult && (
        <div className="rounded-3xl bg-white/70 p-6 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="text-sm text-ink">測試連線結果</h2>
            <span className={`rounded-full px-3 py-1 text-xs ${testResult.overallOk ? "bg-sage-100 text-ink" : "bg-blossom-100 text-ink"}`}>
              {testResult.overallOk ? "全部通過" : "有項目失敗"}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-faint">執行時間：{new Date(testResult.ranAt).toLocaleString("zh-Hant")}</p>
          <ul className="mt-3 flex flex-col gap-2">
            {testResult.items.map((item) => (
              <li key={item.key} className="rounded-2xl bg-cream-50 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className={item.ok ? "text-sage-600" : "text-blossom-600"}>{item.ok ? "✅ 成功" : "❌ 失敗"}</span>
                  <span className="text-ink">{item.label}</span>
                </div>
                <p className="mt-1 text-xs text-ink-faint">{item.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-3xl bg-white/70 p-6 text-xs text-ink-faint shadow-soft">
        <p>
          按下【連結Google Drive】會導向 Google 的登入畫面，請使用 fa0225234163@gmail.com 登入並同意授權
          （這個帳號只是預先帶入畫面方便輸入，實際綁定哪個帳號以授權完成後 Google 回傳的帳號為準）。
          授權完成後系統會永久記住這個帳號，之後每天的自動備份都固定用這個帳號，
          不受目前電腦 Chrome 登入哪個 Google 帳號影響。
        </p>
      </div>
    </div>
  );
}
