"use client";

import { useCallback, useEffect, useState } from "react";
import { useOperator } from "@/lib/operatorClient";
import { canSystem } from "@/lib/permissions";

type DriveFileInfo = { id: string; name: string; size: number; createdTime: string };
type BrowseFolder = "Daily" | "Weekly" | "Monthly" | "Before_Update";

const FOLDERS: { key: BrowseFolder; label: string }[] = [
  { key: "Daily", label: "每日" },
  { key: "Weekly", label: "每週" },
  { key: "Monthly", label: "每月" },
  { key: "Before_Update", label: "更新前" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * 需求「九、一鍵還原」。
 *
 * 兩層防呆機制（都在畫面上，伺服器端 restoreFromBackup() 也會再檢查一次
 * confirmFileName === fileName，不是只靠前端擋）：
 * 第一層：選好備份後彈出「是否確定覆蓋目前資料？」的確認區塊。
 * 第二層：要求使用者「輸入完整檔名」才會真的送出還原請求——比單純按
 * 「確定」多一道門檻，避免手滑點錯備份、或誤觸真的覆蓋掉現有資料。
 */
export default function RestoreCenterScreen() {
  const { operatorUserId, operatorUser } = useOperator();
  const [folder, setFolder] = useState<BrowseFolder>("Daily");
  const [files, setFiles] = useState<DriveFileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DriveFileInfo | null>(null);
  const [confirmInput, setConfirmInput] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canRestore = operatorUser?.role ? canSystem(operatorUser.role, "restoreBackup") : false;
  const canDownload = operatorUser?.role ? canSystem(operatorUser.role, "downloadBackup") : false;

  const loadFiles = useCallback(
    (f: BrowseFolder) => {
      if (!operatorUserId) return;
      setLoading(true);
      setLoadError(null);
      setSelected(null);
      setConfirmInput("");
      fetch(`/api/system-center/backup/browse?operatorUserId=${encodeURIComponent(operatorUserId)}&folder=${f}`)
        .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
        .then(({ ok, data }) => {
          if (!ok) {
            setLoadError(data.error ?? "載入失敗");
            setFiles([]);
            return;
          }
          setFiles(Array.isArray(data.files) ? data.files : []);
        })
        .catch(() => setLoadError("無法連線到伺服器"))
        .finally(() => setLoading(false));
    },
    [operatorUserId]
  );

  useEffect(() => {
    loadFiles(folder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, operatorUserId]);

  function downloadFile(f: DriveFileInfo) {
    if (!operatorUserId) return;
    const url = `/api/system-center/backup/download?operatorUserId=${encodeURIComponent(operatorUserId)}&fileId=${encodeURIComponent(f.id)}&fileName=${encodeURIComponent(f.name)}`;
    window.open(url, "_blank");
  }

  async function confirmRestore() {
    if (!selected || !operatorUserId) return;
    if (confirmInput !== selected.name) {
      setMessage("輸入的檔名跟選擇的備份不相符，請重新輸入完整檔名");
      return;
    }
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch("/api/system-center/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorUserId,
          googleDriveFileId: selected.id,
          fileName: selected.name,
          confirmFileName: confirmInput,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`還原失敗：${data.error ?? "未知錯誤"}`);
        return;
      }
      setMessage("✅ 還原完成，資料已覆蓋為所選備份的內容");
      setSelected(null);
      setConfirmInput("");
    } catch {
      setMessage("還原失敗：無法連線到伺服器");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        {FOLDERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFolder(f.key)}
            className={`min-h-9 rounded-full px-4 text-sm transition ${
              folder === f.key ? "bg-mist-200 text-ink" : "bg-white/70 text-ink-soft hover:bg-mist-100"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="rounded-3xl bg-white/70 p-6 shadow-card">
        {loading && <p className="text-sm text-ink-faint">載入中…</p>}
        {loadError && <p className="text-sm text-blossom-600">{loadError}</p>}
        {!loading && !loadError && files.length === 0 && (
          <p className="text-sm text-ink-faint">此資料夾目前沒有備份。</p>
        )}
        <ul className="flex flex-col gap-2">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex flex-col gap-2 rounded-2xl bg-cream-50 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm text-ink">{f.name}</p>
                <p className="text-xs text-ink-faint">
                  {formatBytes(f.size)} ・ {new Date(f.createdTime).toLocaleString("zh-Hant")}
                </p>
              </div>
              <div className="flex gap-2">
                {canDownload && (
                  <button
                    type="button"
                    onClick={() => downloadFile(f)}
                    className="min-h-9 rounded-full bg-white px-4 text-xs text-ink shadow-soft transition hover:bg-cream-100"
                  >
                    下載
                  </button>
                )}
                {canRestore && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(f);
                      setConfirmInput("");
                      setMessage(null);
                    }}
                    className="min-h-9 rounded-full bg-blossom-200 px-4 text-xs text-ink transition hover:bg-blossom-300"
                  >
                    還原
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {selected && (
        <div className="rounded-3xl bg-blossom-100 p-6 shadow-card">
          <p className="text-sm text-ink">⚠️ 是否確定覆蓋目前資料？</p>
          <p className="mt-2 text-xs text-ink-soft">
            即將用「{selected.name}」的內容完整覆蓋目前系統的所有資料（不是只還原部分項目），
            這個動作無法復原。確定要繼續的話，請在下方輸入完整檔名再按「確定還原」。
          </p>
          <input
            className="mt-4 min-h-10 w-full rounded-full border border-cream-200 bg-white px-4 text-sm"
            placeholder={selected.name}
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
          />
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              disabled={restoring || confirmInput !== selected.name}
              onClick={confirmRestore}
              className="min-h-10 rounded-full bg-blossom-300 px-6 text-sm text-ink transition hover:bg-blossom-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {restoring ? "還原中…" : "確定還原"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setConfirmInput("");
              }}
              className="min-h-10 rounded-full bg-white px-6 text-sm text-ink-soft transition hover:bg-cream-100"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {message && <p className="text-sm text-ink-soft">{message}</p>}

      {!canRestore && <p className="text-xs text-blossom-600">目前操作人員沒有執行還原的權限。</p>}
    </div>
  );
}
