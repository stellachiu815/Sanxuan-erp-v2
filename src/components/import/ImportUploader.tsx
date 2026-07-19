"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";
import { useOperator } from "@/lib/operatorClient";

type RowStatus = "OK" | "ERROR" | "DUPLICATE_PENDING" | "IMPORTED";

type ExistingHousehold = {
  name: string;
  contactName: string | null;
  phone: string | null;
  address: string | null;
} | null;

type RowResult = {
  rowNumber: number;
  householdId: string;
  memberName: string | null;
  status: RowStatus;
  errors: string[];
  warnings: string[];
  existingHousehold?: ExistingHousehold;
};

type Summary = { total: number; ok: number; error: number; duplicatePending: number; imported?: number };

type BatchState = {
  batchId: string;
  fileName: string;
  status: "PREVIEWED" | "COMMITTED";
  summary: Summary;
  rows: RowResult[];
};

const statusBadge: Record<RowStatus, string> = {
  OK: "bg-sage-100 text-ink-soft",
  ERROR: "bg-blossom-100 text-ink-soft",
  DUPLICATE_PENDING: "bg-yolk-100 text-ink-soft",
  IMPORTED: "bg-sage-200 text-ink-soft",
};

const statusLabel: Record<RowStatus, string> = {
  OK: "可匯入",
  ERROR: "錯誤",
  DUPLICATE_PENDING: "待確認（家戶編號重複）",
  IMPORTED: "已匯入",
};

export default function ImportUploader() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const existingBatchId = searchParams.get("batch");
  // V11.3 補上這一頁原本完全沒有的權限檢查（見 src/lib/operator.ts 的
  // manageDataImport 說明）：這裡只負責帶上 operatorUserId，真正的權限
  // 判斷一律在伺服器端的 4 支 API route 完成，不是只靠前端擋。
  const { operatorUserId } = useOperator();

  const [batch, setBatch] = useState<BatchState | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{
    householdsCreated: number;
    membersCreated: number;
    worshipCreated: number;
    skippedNowDuplicate: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const loadBatch = useCallback(
    async (batchId: string, userId: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/import/${batchId}?operatorUserId=${encodeURIComponent(userId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "讀取匯入結果失敗");
        setBatch(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "讀取匯入結果失敗");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // 重新整理頁面時，如果網址上有 batch 參數，重新讀取這個批次的結果，
  // 資料不會因為重新整理就消失。要等操作人員身分載入完成（operatorUserId
  // 有值）才能呼叫，否則一定會被伺服器以 401 拒絕。
  useEffect(() => {
    if (existingBatchId && operatorUserId) loadBatch(existingBatchId, operatorUserId);
  }, [existingBatchId, operatorUserId, loadBatch]);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCommitResult(null);
    if (!operatorUserId) {
      setError("請先在上方選擇目前操作人員");
      return;
    }
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) {
      setError("請先選擇 Excel 檔案");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("operatorUserId", operatorUserId);

    setLoading(true);
    try {
      const res = await fetch("/api/import/preview", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "上傳或驗證失敗");
      setBatch(data);
      router.push(`/import?batch=${data.batchId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上傳或驗證失敗");
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!batch || !operatorUserId) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/import/${batch.batchId}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "確認匯入失敗");
      setCommitResult(data);
      await loadBatch(batch.batchId, operatorUserId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "確認匯入失敗");
    } finally {
      setCommitting(false);
    }
  }

  function handleReset() {
    setBatch(null);
    setCommitResult(null);
    setError(null);
    setFileInputKey((k) => k + 1);
    router.push("/import");
  }

  return (
    <div className="flex flex-col gap-6">
      {!batch && (
        <form onSubmit={handleUpload} className="rounded-3xl bg-white/70 p-8 shadow-card">
          <h2 className="text-lg font-medium text-ink">上傳 Excel</h2>
          <p className="mt-1 text-sm text-ink-faint">
            請先用「5 戶測試資料」上傳一次，確認結果沒問題後，再上傳全部正式資料。
          </p>
          <input
            key={fileInputKey}
            type="file"
            name="file"
            accept=".xlsx,.xls"
            className="mt-5 block w-full text-sm text-ink-soft file:mr-4 file:rounded-full file:border-0 file:bg-mist-100 file:px-4 file:py-2 file:text-sm file:text-ink-soft hover:file:bg-mist-200"
          />
          <div className="mt-5 flex gap-3">
            <button type="submit" disabled={loading || !operatorUserId} className={primaryButtonClass}>
              {loading ? "檢查中…" : "上傳並檢查"}
            </button>
          </div>
          {!operatorUserId && (
            <p className="mt-3 text-xs text-ink-faint">請先在上方選擇目前操作人員（僅最高管理員可以匯入）。</p>
          )}
        </form>
      )}

      {error && <p className={errorTextClass}>{error}</p>}

      {batch && (
        <div className="rounded-3xl bg-white/70 p-8 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium text-ink">{batch.fileName}</h2>
              <p className="mt-1 text-sm text-ink-faint">
                {batch.status === "COMMITTED" ? "已確認匯入" : "已驗證，尚未匯入"}
              </p>
            </div>
            <button onClick={handleReset} className={secondaryButtonClass} type="button">
              上傳另一個檔案
            </button>
          </div>

          <div className="mt-5 flex flex-wrap gap-3 text-sm">
            <SummaryPill label="總筆數" value={batch.summary.total} tone="bg-cream-200" />
            <SummaryPill label="可匯入" value={batch.summary.ok} tone="bg-sage-100" />
            <SummaryPill label="錯誤" value={batch.summary.error} tone="bg-blossom-100" />
            <SummaryPill label="待確認（重複）" value={batch.summary.duplicatePending} tone="bg-yolk-100" />
            {batch.summary.imported !== undefined && batch.status === "COMMITTED" && (
              <SummaryPill label="已匯入列數" value={batch.summary.imported} tone="bg-sage-200" />
            )}
          </div>

          {batch.status === "PREVIEWED" && (
            <div className="mt-6 flex flex-wrap items-center gap-4">
              {batch.summary.error > 0 && (
                <p className={errorTextClass}>
                  有 {batch.summary.error} 筆資料驗證錯誤，這些列不會被匯入。可以先確認匯入其餘沒問題的資料，
                  之後修正 Excel 內容後再重新上傳一次即可（不會重複建立已匯入的家戶）。
                </p>
              )}
              {batch.summary.ok > 0 ? (
                <button
                  onClick={handleCommit}
                  disabled={committing}
                  className={primaryButtonClass}
                  type="button"
                >
                  {committing ? "匯入中…" : `確認匯入這 ${batch.summary.ok} 筆資料`}
                </button>
              ) : (
                <p className="text-sm text-ink-faint">目前沒有可以匯入的資料。</p>
              )}
            </div>
          )}

          {commitResult && (
            <div className="mt-6 rounded-2xl bg-sage-50 px-5 py-4 text-sm text-ink-soft">
              <p>
                匯入完成：新增 {commitResult.householdsCreated} 戶、
                {commitResult.membersCreated} 位家戶成員、
                {commitResult.worshipCreated} 筆祭祀資料。
              </p>
              {commitResult.skippedNowDuplicate.length > 0 && (
                <p className="mt-1 text-ink-faint">
                  另外有 {commitResult.skippedNowDuplicate.length} 戶（
                  {commitResult.skippedNowDuplicate.join("、")}）在確認匯入的當下發現已存在，
                  已改列為待確認，沒有覆蓋既有資料。
                </p>
              )}
            </div>
          )}

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="text-xs text-ink-faint">
                  <th className="pb-2 pr-4">列號</th>
                  <th className="pb-2 pr-4">家戶編號</th>
                  <th className="pb-2 pr-4">成員姓名</th>
                  <th className="pb-2 pr-4">狀態</th>
                  <th className="pb-2">說明</th>
                </tr>
              </thead>
              <tbody>
                {batch.rows.map((r) => (
                  <tr key={r.rowNumber} className="border-t border-cream-200 align-top">
                    <td className="py-2 pr-4 text-ink-faint">{r.rowNumber}</td>
                    <td className="py-2 pr-4 text-ink">{r.householdId || "（空白）"}</td>
                    <td className="py-2 pr-4 text-ink">{r.memberName || "（空白）"}</td>
                    <td className="py-2 pr-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${statusBadge[r.status]}`}>
                        {statusLabel[r.status]}
                      </span>
                    </td>
                    <td className="py-2 text-ink-soft">
                      {r.errors.length > 0 && (
                        <ul className="list-inside list-disc">
                          {r.errors.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      )}
                      {r.warnings.length > 0 && (
                        <ul className="list-inside list-disc text-ink-faint">
                          {r.warnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      )}
                      {r.status === "DUPLICATE_PENDING" && r.existingHousehold && (
                        <p className="text-xs text-ink-faint">
                          資料庫已有此家戶編號：{r.existingHousehold.name}
                          {r.existingHousehold.contactName ? `（${r.existingHousehold.contactName}）` : ""}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryPill({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className={`rounded-full px-3 py-1.5 text-ink-soft ${tone}`}>
      {label} {value}
    </span>
  );
}
