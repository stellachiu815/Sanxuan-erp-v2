"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { useOperator } from "@/lib/operatorClient";
import {
  inputClass,
  labelClass,
  checkboxRowClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "./formStyles";

type Props = {
  householdId: string;
  members: { id: string; name: string; role: string }[];
  onClose: () => void;
  onSuccess: () => void;
};

type Preview = {
  members: { id: string; name: string; role: string; sourceHouseholdId: string; sourceHouseholdName: string }[];
  targetHousehold: { id: string; name: string };
  affectsSourceHead: boolean;
  affectsSourcePrimaryContact: boolean;
  suspectedDuplicatesAtTarget: { reason: string; a: { name: string }; b: { name: string } }[];
  sourceHouseholdsWillBecomeEmpty: string[];
};

/**
 * V12.1「家戶管理中心」指令「十三、成員轉移」。
 *
 * 從家戶詳細頁開啟，來源固定為目前這一戶（householdId）；目標家戶用家戶
 * 編號輸入，沿用既有家戶編號查詢，不另外做一套搜尋 UI（與合併精靈一致）。
 * 若轉移的成員包含目前戶長，且轉移後原家戶還有其他成員，必須先指定原
 * 家戶的新戶長才能送出——這條規則由 src/lib/householdManagement.ts 的
 * previewMemberTransfer()／transferHouseholdMembers() 在伺服器端強制檢查，
 * 這裡的前端檢查只是提早提示，真正把關以 API 回應為準。
 */
export default function TransferMembersWizard({ householdId, members, onClose, onSuccess }: Props) {
  const { operatorUserId } = useOperator();
  const [step, setStep] = useState<"select" | "preview" | "done">("select");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [targetCode, setTargetCode] = useState("");
  const [newHeadMemberId, setNewHeadMemberId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const currentHead = members.find((m) => m.role === "HOUSEHOLD_HEAD");
  const headIsMoving = !!currentHead && selected[currentHead.id];
  const remainingMembers = members.filter((m) => !selected[m.id]);
  const needsNewHeadChoice = headIsMoving && remainingMembers.length > 0;

  async function loadPreview() {
    if (selectedIds.length === 0 || !targetCode.trim() || loading) return;
    if (needsNewHeadChoice && !newHeadMemberId) {
      setError("原戶長將被轉移，請先指定原家戶的新戶長。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/households/members/transfer/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorUserId,
          memberIds: selectedIds,
          targetHouseholdId: targetCode.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "查詢失敗，請確認目標家戶編號是否正確。");
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

  async function handleExecute() {
    if (!preview || loading) return;
    setLoading(true);
    setError(null);
    try {
      const newHeadsForSourceHouseholds: Record<string, string> =
        needsNewHeadChoice && newHeadMemberId ? { [householdId]: newHeadMemberId } : {};
      const res = await fetch("/api/households/members/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorUserId,
          memberIds: selectedIds,
          targetHouseholdId: preview.targetHousehold.id,
          newHeadsForSourceHouseholds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "轉移失敗，請稍後再試一次。");
        return;
      }
      setResult(
        `轉移完成：已將 ${preview.members.length} 位成員轉移至家戶 ${preview.targetHousehold.id}（${preview.targetHousehold.name}）。`
      );
      setStep("done");
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="轉移成員至其他家戶" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {step === "select" && (
          <>
            <div>
              <label className={labelClass}>選擇要轉移的成員</label>
              {members.length === 0 ? (
                <p className="text-sm text-ink-soft">這個家戶目前沒有成員。</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {members.map((m) => (
                    <label key={m.id} className={checkboxRowClass}>
                      <input
                        type="checkbox"
                        checked={!!selected[m.id]}
                        onChange={(e) => setSelected((s) => ({ ...s, [m.id]: e.target.checked }))}
                      />
                      {m.name}
                      {m.role === "HOUSEHOLD_HEAD" && (
                        <span className="rounded-full bg-yolk-100 px-2 py-0.5 text-xs text-ink-soft">目前戶長</span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {selectedIds.length > 0 && (
              <>
                <div>
                  <label className={labelClass}>目標家戶編號</label>
                  <input
                    className={inputClass}
                    value={targetCode}
                    onChange={(e) => setTargetCode(e.target.value)}
                    placeholder="例如 F00012"
                  />
                </div>

                {needsNewHeadChoice && (
                  <div>
                    <label className={labelClass}>原戶長即將被轉移，請指定原家戶新戶長</label>
                    <select
                      className={inputClass}
                      value={newHeadMemberId}
                      onChange={(e) => setNewHeadMemberId(e.target.value)}
                    >
                      <option value="">請選擇</option>
                      {remainingMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {headIsMoving && remainingMembers.length === 0 && (
                  <p className="rounded-2xl bg-yolk-50 px-4 py-3 text-sm text-ink-soft">
                    ⚠️ 全部成員都將轉移，原家戶將成為沒有成員的空家戶（可於轉移後在家戶詳細頁選擇封存）。
                  </p>
                )}
              </>
            )}

            {error && <p className={errorTextClass}>{error}</p>}

            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className={secondaryButtonClass} onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className={primaryButtonClass}
                onClick={loadPreview}
                disabled={loading || selectedIds.length === 0 || !targetCode.trim()}
              >
                {loading ? "查詢中…" : "查看轉移預覽"}
              </button>
            </div>
          </>
        )}

        {step === "preview" && preview && (
          <>
            <div className="text-sm text-ink-soft">
              <p>
                將轉移 {preview.members.length} 位成員：{preview.members.map((m) => m.name).join("、")}
              </p>
              <p className="mt-1">
                目標家戶：{preview.targetHousehold.id}（{preview.targetHousehold.name}）
              </p>
              {preview.sourceHouseholdsWillBecomeEmpty.length > 0 && (
                <p className="mt-1 text-ink">
                  ⚠️ 以下家戶轉移後將成為空家戶：{preview.sourceHouseholdsWillBecomeEmpty.join("、")}
                </p>
              )}
              {preview.affectsSourceHead && <p className="mt-1 text-ink">⚠️ 本次轉移包含原家戶戶長。</p>}
              {preview.affectsSourcePrimaryContact && (
                <p className="mt-1 text-ink">⚠️ 本次轉移包含原家戶主要聯絡人。</p>
              )}
            </div>

            {preview.suspectedDuplicatesAtTarget.length > 0 && (
              <div className="rounded-2xl bg-mist-50 px-4 py-3 text-sm text-ink-soft">
                ⚠️ 目標家戶疑似有重複人物（僅供人工確認，系統不會自動合併或刪除資料）：
                {preview.suspectedDuplicatesAtTarget.map((d, i) => (
                  <p key={i}>
                    {d.a.name} ↔ {d.b.name}
                  </p>
                ))}
              </div>
            )}

            {error && <p className={errorTextClass}>{error}</p>}

            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className={secondaryButtonClass} onClick={() => setStep("select")} disabled={loading}>
                返回
              </button>
              <button
                type="button"
                className="rounded-full bg-blossom-200 px-5 py-2.5 text-sm text-ink transition hover:bg-blossom-300 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleExecute}
                disabled={loading}
              >
                {loading ? "處理中…" : "確認轉移成員"}
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
                className={primaryButtonClass}
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
