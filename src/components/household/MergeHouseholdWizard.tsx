"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { useOperator } from "@/lib/operatorClient";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "./formStyles";

type Props = {
  targetHouseholdId: string;
  onClose: () => void;
  onSuccess: () => void;
};

const FIELD_LABEL: Record<string, string> = {
  name: "戶名",
  contactName: "主要聯絡人",
  address: "地址",
  phone: "電話",
  mobile: "手機",
  notes: "備註",
};

type Preview = {
  target: { id: string; name: string; headMemberId: string | null; headName: string | null };
  source: { id: string; name: string; headMemberId: string | null; headName: string | null };
  conflicts: { field: string; targetValue: string | null; sourceValue: string | null }[];
  membersToMove: { id: string; name: string; role: string }[];
  suspectedDuplicates: { reason: string; a: { name: string }; b: { name: string } }[];
  ancestorsToMerge: { id: string; displayName: string; duplicate: boolean }[];
  individualsToMerge: { id: string; displayName: string; duplicate: boolean }[];
  affectedCounts: Record<string, number>;
};

/**
 * V12.1「家戶管理中心」指令「十一、家戶合併」。
 *
 * 目標家戶固定為目前這一戶（targetHouseholdId，從家戶詳細頁進入）；來源
 * 家戶用家戶編號輸入（沿用既有家戶編號查詢，不另外做一套搜尋 UI）。
 * 合併不是刪除來源戶後重建，只搬動成員與歷代祖先/乙位正魂，來源戶封存
 * （可從回收區還原），詳見 src/lib/householdManagement.ts 說明。
 */
export default function MergeHouseholdWizard({ targetHouseholdId, onClose, onSuccess }: Props) {
  const { operatorUserId } = useOperator();
  const [step, setStep] = useState<"input" | "preview" | "done">("input");
  const [sourceId, setSourceId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [resolution, setResolution] = useState<Record<string, "target" | "source">>({});
  const [keepHeadMemberId, setKeepHeadMemberId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function loadPreview() {
    if (!sourceId.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/households/merge/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId, targetId: targetHouseholdId, sourceId: sourceId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "查詢失敗，請確認家戶編號是否正確。");
        return;
      }
      setPreview(data.data as Preview);
      setStep("preview");
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setLoading(false);
    }
  }

  const needHeadChoice = !!(preview?.target.headMemberId && preview?.source.headMemberId);
  const allConflictsResolved = preview ? preview.conflicts.every((c) => resolution[c.field]) : true;
  const canExecute = allConflictsResolved && (!needHeadChoice || keepHeadMemberId);

  async function handleExecute() {
    if (!preview || loading || !canExecute) return;
    setLoading(true);
    setError(null);
    try {
      const fieldResolution: Record<string, { use: "target" | "source" }> = {};
      for (const c of preview.conflicts) {
        fieldResolution[c.field] = { use: resolution[c.field] ?? "target" };
      }
      const res = await fetch("/api/households/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorUserId,
          targetId: targetHouseholdId,
          sourceId: preview.source.id,
          fieldResolution,
          keepHeadMemberId: keepHeadMemberId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "合併失敗，請稍後再試一次。");
        return;
      }
      setResult(`合併完成：家戶 ${preview.source.id}（${preview.source.name}）已併入本戶，並已封存。`);
      setStep("done");
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="合併家戶" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {step === "input" && (
          <>
            <p className="text-sm text-ink-soft">
              目標家戶：<span className="text-ink">{targetHouseholdId}</span>（合併後保留這一戶）
            </p>
            <div>
              <label className={labelClass}>來源家戶編號（將被併入並封存）</label>
              <input
                className={`${inputClass} min-h-11`}
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                placeholder="例如 F00012"
                autoFocus
              />
            </div>
            {error && <p className={errorTextClass}>{error}</p>}
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className={`${secondaryButtonClass} min-h-11 w-full sm:w-auto`} onClick={onClose}>
                取消
              </button>
              <button type="button" className={`${primaryButtonClass} min-h-11 w-full sm:w-auto`} onClick={loadPreview} disabled={loading || !sourceId.trim()}>
                {loading ? "查詢中…" : "查看合併預覽"}
              </button>
            </div>
          </>
        )}

        {step === "preview" && preview && (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-sage-50 px-4 py-3">
                <p className="text-xs text-ink-faint">目標家戶（保留）</p>
                <p className="text-ink">{preview.target.id}｜{preview.target.name}</p>
                <p className="text-xs text-ink-soft">戶長：{preview.target.headName ?? "（未指定）"}</p>
              </div>
              <div className="rounded-2xl bg-blossom-50 px-4 py-3">
                <p className="text-xs text-ink-faint">來源家戶（將封存）</p>
                <p className="text-ink">{preview.source.id}｜{preview.source.name}</p>
                <p className="text-xs text-ink-soft">戶長：{preview.source.headName ?? "（未指定）"}</p>
              </div>
            </div>

            {preview.conflicts.length > 0 && (
              <div className="rounded-2xl bg-yolk-50 px-4 py-3">
                <p className="text-sm text-ink">以下欄位兩戶內容不同，請選擇合併後保留的值：</p>
                <div className="mt-2 flex flex-col gap-2">
                  {preview.conflicts.map((c) => (
                    <div key={c.field} className="text-sm">
                      <p className="text-ink-soft">{FIELD_LABEL[c.field] ?? c.field}</p>
                      <div className="mt-1 flex gap-2">
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            name={`field-${c.field}`}
                            checked={resolution[c.field] === "target"}
                            onChange={() => setResolution((r) => ({ ...r, [c.field]: "target" }))}
                          />
                          目標：{c.targetValue || "（空白）"}
                        </label>
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            name={`field-${c.field}`}
                            checked={resolution[c.field] === "source"}
                            onChange={() => setResolution((r) => ({ ...r, [c.field]: "source" }))}
                          />
                          來源：{c.sourceValue || "（空白）"}
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {needHeadChoice && (
              <div className="rounded-2xl bg-yolk-50 px-4 py-3">
                <p className="text-sm text-ink">兩戶都有戶長，請選擇合併後保留哪一位：</p>
                <div className="mt-2 flex gap-3 text-sm">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="keepHead"
                      checked={keepHeadMemberId === preview.target.headMemberId}
                      onChange={() => setKeepHeadMemberId(preview.target.headMemberId!)}
                    />
                    {preview.target.headName}（目標戶）
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="keepHead"
                      checked={keepHeadMemberId === preview.source.headMemberId}
                      onChange={() => setKeepHeadMemberId(preview.source.headMemberId!)}
                    />
                    {preview.source.headName}（來源戶）
                  </label>
                </div>
              </div>
            )}

            <div className="text-sm text-ink-soft">
              <p>將移入 {preview.membersToMove.length} 位成員：{preview.membersToMove.map((m) => m.name).join("、") || "（無）"}</p>
              <p className="mt-1">
                歷代祖先：{preview.ancestorsToMerge.length} 筆（其中 {preview.ancestorsToMerge.filter((a) => a.duplicate).length} 筆完全相同不重複建立）
              </p>
              <p>
                乙位正魂：{preview.individualsToMerge.length} 筆（其中 {preview.individualsToMerge.filter((a) => a.duplicate).length} 筆完全相同不重複建立）
              </p>
              <p className="mt-1">
                受影響資料（仍留在來源戶名下，不會被搬移或刪除）：活動 {preview.affectedCounts.activities}、普渡登記{" "}
                {preview.affectedCounts.ritualRecords}、收款 {preview.affectedCounts.paymentTransactions}、收據{" "}
                {preview.affectedCounts.receipts}
              </p>
            </div>

            {preview.suspectedDuplicates.length > 0 && (
              <div className="rounded-2xl bg-mist-50 px-4 py-3 text-sm text-ink-soft">
                ⚠️ 疑似重複人物（僅供人工確認，系統不會自動合併或刪除資料）：
                {preview.suspectedDuplicates.map((d, i) => (
                  <p key={i}>
                    {d.a.name} ↔ {d.b.name}
                  </p>
                ))}
              </div>
            )}

            {error && <p className={errorTextClass}>{error}</p>}

            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className={`${secondaryButtonClass} min-h-11 w-full sm:w-auto`} onClick={() => setStep("input")} disabled={loading}>
                返回
              </button>
              <button
                type="button"
                className="rounded-full bg-blossom-200 px-5 py-2.5 text-sm text-ink transition hover:bg-blossom-300 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleExecute}
                disabled={loading || !canExecute}
              >
                {loading ? "處理中…" : "確認合併家戶"}
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <p className="rounded-2xl bg-sage-50 px-4 py-3 text-sm text-ink">{result}</p>
            <div className="flex justify-end">
              <button
                type="button"
                className={`${primaryButtonClass} min-h-11 w-full sm:w-auto`}
                onClick={() => {
                  onSuccess();
                  onClose();
                }}
              >
                完成
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
