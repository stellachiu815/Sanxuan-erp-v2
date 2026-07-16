"use client";

import { useEffect, useState } from "react";
import { useOperator } from "@/lib/operatorClient";
import { backupTypeLabel, backupStatusLabel, integrityCheckStatusLabel } from "@/lib/labels";

type HealthResponse = {
  googleDrive: { connected: true; email: string } | { connected: false; reason: string };
  googleDriveFolders: { root: boolean; daily: boolean; weekly: boolean; monthly: boolean; beforeUpdate: boolean };
  database: { ok: boolean; error?: string };
  diskSpace: { availableBytes: number; usedPercent: number } | null;
  latestMigration: string | null;
  latestBackup: { type: string; status: string; startedAt: string; finishedAt: string | null } | null;
  daysSinceLastSuccessfulBackup: number | null;
  lastIntegrityCheck: { checkedAt: string | null; status: string | null } | null;
  systemTools: Record<string, boolean>;
  requiredEnvVars: Record<string, boolean>;
  systemVersion: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const TOOL_LABEL: Record<string, string> = {
  pg_dump: "pg_dump",
  pg_restore: "pg_restore",
  zip: "zip",
  unzip: "unzip",
};

/** 需求「十三、系統健康檢查」＋「十四、健康檢查補強」：異常時要立即顯示警示。 */
export default function HealthCheckScreen() {
  const { operatorUserId } = useOperator();
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!operatorUserId) return;
    setLoading(true);
    fetch(`/api/system-center/health?operatorUserId=${encodeURIComponent(operatorUserId)}`)
      .then((res) => res.json().then((d) => ({ ok: res.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          setError(d.error ?? "載入失敗");
          return;
        }
        setData(d);
        setError(null);
      })
      .catch(() => setError("無法連線到伺服器"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatorUserId]);

  const missingEnvVars = data ? Object.entries(data.requiredEnvVars).filter(([, ok]) => !ok) : [];
  const missingTools = data ? Object.entries(data.systemTools).filter(([, ok]) => !ok) : [];

  const abnormal =
    data &&
    (!data.database.ok ||
      !data.googleDrive.connected ||
      (data.diskSpace && data.diskSpace.usedPercent >= 90) ||
      missingEnvVars.length > 0 ||
      missingTools.length > 0 ||
      (data.daysSinceLastSuccessfulBackup !== null && data.daysSinceLastSuccessfulBackup >= 2));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-faint">按重新檢查可以取得最新狀態，不會自動輪詢。</p>
        <button
          type="button"
          onClick={load}
          className="min-h-9 rounded-full bg-white px-4 text-xs text-ink shadow-soft transition hover:bg-cream-100"
        >
          重新檢查
        </button>
      </div>

      {loading && <p className="text-sm text-ink-faint">檢查中…</p>}
      {error && <p className="text-sm text-blossom-600">{error}</p>}

      {data && abnormal && (
        <div className="rounded-3xl bg-blossom-100 p-4 text-sm text-ink">
          ⚠️ 偵測到異常項目，請檢查下方紅色標示的項目。
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className={`rounded-2xl p-4 ${data.database.ok ? "bg-sage-100" : "bg-blossom-100"}`}>
            <p className="text-xs text-ink-faint">資料庫連線</p>
            <p className="mt-1 text-sm text-ink">{data.database.ok ? "🟢 正常" : `🔴 異常：${data.database.error}`}</p>
          </div>

          <div className={`rounded-2xl p-4 ${data.googleDrive.connected ? "bg-sage-100" : "bg-blossom-100"}`}>
            <p className="text-xs text-ink-faint">Google Drive OAuth 狀態／access token 換發</p>
            <p className="mt-1 text-sm text-ink">
              {data.googleDrive.connected ? `🟢 正常（${data.googleDrive.email || "已連線，尚未取得帳號"}）` : `🔴 異常：${data.googleDrive.reason}`}
            </p>
          </div>

          <div className="rounded-2xl bg-cream-200 p-4 sm:col-span-2">
            <p className="text-xs text-ink-faint">備份資料夾</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {(["root", "daily", "weekly", "monthly", "beforeUpdate"] as const).map((k) => (
                <span
                  key={k}
                  className={`rounded-full px-3 py-1 ${data.googleDriveFolders[k] ? "bg-sage-100 text-ink" : "bg-blossom-100 text-ink"}`}
                >
                  {k === "root" ? "根資料夾" : k === "daily" ? "Daily" : k === "weekly" ? "Weekly" : k === "monthly" ? "Monthly" : "Before_Update"}
                  {data.googleDriveFolders[k] ? " ✓" : " ✗"}
                </span>
              ))}
            </div>
          </div>

          <div
            className={`rounded-2xl p-4 ${
              data.diskSpace === null ? "bg-cream-200" : data.diskSpace.usedPercent >= 90 ? "bg-blossom-100" : "bg-sage-100"
            }`}
          >
            <p className="text-xs text-ink-faint">Render 暫存空間</p>
            <p className="mt-1 text-sm text-ink">
              {data.diskSpace
                ? `${data.diskSpace.usedPercent >= 90 ? "🔴" : "🟢"} 可用 ${formatBytes(data.diskSpace.availableBytes)}（已使用 ${data.diskSpace.usedPercent}%）`
                : "－ 無法取得"}
            </p>
          </div>

          <div className="rounded-2xl bg-mist-100 p-4">
            <p className="text-xs text-ink-faint">Migration 版本</p>
            <p className="mt-1 text-sm text-ink">{data.latestMigration ?? "－"}</p>
          </div>

          <div className="rounded-2xl bg-yolk-100 p-4">
            <p className="text-xs text-ink-faint">系統版本</p>
            <p className="mt-1 text-sm text-ink">V{data.systemVersion}</p>
          </div>

          <div
            className={`rounded-2xl p-4 ${
              data.daysSinceLastSuccessfulBackup === null || data.daysSinceLastSuccessfulBackup >= 2 ? "bg-blossom-100" : "bg-sage-100"
            }`}
          >
            <p className="text-xs text-ink-faint">最近一次備份</p>
            <p className="mt-1 text-sm text-ink">
              {data.latestBackup
                ? `${backupTypeLabel[data.latestBackup.type] ?? data.latestBackup.type}・${backupStatusLabel[data.latestBackup.status] ?? data.latestBackup.status}`
                : "尚無備份紀錄"}
            </p>
            {data.latestBackup && (
              <p className="text-xs text-ink-faint">{new Date(data.latestBackup.startedAt).toLocaleString("zh-Hant")}</p>
            )}
            <p className="mt-1 text-xs text-ink-faint">
              距最近一次成功備份：
              {data.daysSinceLastSuccessfulBackup === null ? "尚無成功紀錄" : `${data.daysSinceLastSuccessfulBackup} 天`}
            </p>
          </div>

          <div className="rounded-2xl bg-cream-200 p-4">
            <p className="text-xs text-ink-faint">最近一次備份完整性檢查</p>
            <p className="mt-1 text-sm text-ink">
              {data.lastIntegrityCheck?.status
                ? integrityCheckStatusLabel[data.lastIntegrityCheck.status] ?? data.lastIntegrityCheck.status
                : "尚未執行過"}
            </p>
            {data.lastIntegrityCheck?.checkedAt && (
              <p className="text-xs text-ink-faint">{new Date(data.lastIntegrityCheck.checkedAt).toLocaleString("zh-Hant")}</p>
            )}
          </div>

          <div className={`rounded-2xl p-4 sm:col-span-2 ${missingTools.length > 0 ? "bg-blossom-100" : "bg-sage-100"}`}>
            <p className="text-xs text-ink-faint">系統工具（pg_dump／pg_restore／zip／unzip 是否可執行）</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {Object.entries(data.systemTools).map(([tool, ok]) => (
                <span key={tool} className={`rounded-full px-3 py-1 ${ok ? "bg-white text-ink" : "bg-blossom-200 text-ink"}`}>
                  {TOOL_LABEL[tool] ?? tool}
                  {ok ? " ✓" : " ✗"}
                </span>
              ))}
            </div>
          </div>

          <div className={`rounded-2xl p-4 sm:col-span-2 ${missingEnvVars.length > 0 ? "bg-blossom-100" : "bg-sage-100"}`}>
            <p className="text-xs text-ink-faint">重要環境變數（只顯示已設定／未設定，不顯示內容）</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {Object.entries(data.requiredEnvVars).map(([name, ok]) => (
                <span key={name} className={`rounded-full px-3 py-1 ${ok ? "bg-white text-ink" : "bg-blossom-200 text-ink"}`}>
                  {name}
                  {ok ? "：已設定" : "：未設定"}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
