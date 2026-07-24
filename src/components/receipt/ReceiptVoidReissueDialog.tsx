"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";
import { useOperator, roleLabel } from "@/lib/operatorClient";
import { canApproveReceiptVoidOrReissue } from "@/lib/permissions";

export type VoidReissueSubmitInput = {
  reason: string;
  approverUserId: string;
  isEmergencyOverride: boolean;
  emergencyReason?: string;
  payerName?: string;
};

type Props = {
  title: string;
  actionLabel: string;
  showPayerName?: boolean;
  onCancel: () => void;
  onSubmit: (input: VoidReissueSubmitInput) => Promise<{ ok: boolean; error?: string }>;
};

/**
 * 作廢／換開共用的表單彈窗（V11.1.1 新增，對應指令「四、補齊收據作廢與換開
 * 的核准控制」）：跟舊版用 window.prompt 分別問「原因」「核准人姓名」不同，
 * 這裡核准人一律從實際的使用者名單裡選（存的是 userId，不是自由輸入的姓名），
 * 伺服器端才有辦法真的查資料庫驗證這個人是誰、是什麼角色。
 *
 * 「操作人不可等於核准人」在畫面上就先擋一次（下拉選單裡把自己設為
 * disabled、送出前也再檢查一次），但真正的強制驗證仍然在伺服器端
 * （src/lib/receipt.ts resolveVoidOrReissueParties()）——這裡的檢查只是
 * 避免使用者選錯之後才在送出時被拒絕，不是安全機制本身。
 */
export default function ReceiptVoidReissueDialog({ title, actionLabel, showPayerName, onCancel, onSubmit }: Props) {
  const { operatorUserId, operatorUser, users } = useOperator();
  const [reason, setReason] = useState("");
  const [approverUserId, setApproverUserId] = useState("");
  const [isEmergency, setIsEmergency] = useState(false);
  const [emergencyReason, setEmergencyReason] = useState("");
  const [payerName, setPayerName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 緊急覆核（操作人＝核准人）依規格僅 SUPER_ADMIN 可用，且後端
  // receipt.ts 也以 role === "SUPER_ADMIN" 強制把關。permissions.ts 目前沒有
  // 對應的獨立 action，這是刻意保留的單一角色顯示判斷（Category B）。
  const isSuperAdmin = operatorUser?.role === "SUPER_ADMIN";
  // 核准人候選：改用共用 canApproveReceiptVoidOrReissue，不再散落 role 字面值。
  const approverCandidates = users.filter((u) => canApproveReceiptVoidOrReissue(u.role));

  async function handleSubmit() {
    setError(null);
    if (!reason.trim()) {
      setError("請輸入原因");
      return;
    }
    if (!isEmergency) {
      if (!approverUserId) {
        setError("請選擇核准人");
        return;
      }
      if (approverUserId === operatorUserId) {
        setError("操作人與核准人不可為同一人（如為最高管理員緊急處理，請勾選下方選項）");
        return;
      }
    } else if (!emergencyReason.trim()) {
      setError("緊急處理請填寫特殊原因");
      return;
    }

    setBusy(true);
    const result = await onSubmit({
      reason: reason.trim(),
      approverUserId: isEmergency ? operatorUserId ?? "" : approverUserId,
      isEmergencyOverride: isEmergency,
      emergencyReason: isEmergency ? emergencyReason.trim() : undefined,
      payerName: showPayerName && payerName.trim() ? payerName.trim() : undefined,
    });
    setBusy(false);
    if (!result.ok) setError(result.error ?? "操作失敗");
  }

  return (
    <Modal title={title} onClose={onCancel}>
      <div className="flex flex-col gap-4">
        {showPayerName && (
          <div>
            <label className={labelClass}>更正付款人姓名（留空則沿用原姓名）</label>
            <input className={inputClass} value={payerName} onChange={(e) => setPayerName(e.target.value)} />
          </div>
        )}

        <div>
          <label className={labelClass}>原因（必填）</label>
          <textarea
            className={inputClass}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </div>

        {isSuperAdmin && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={isEmergency} onChange={(e) => setIsEmergency(e.target.checked)} />
            最高管理員緊急處理（操作人與核准人可為同一人，但必須填寫特殊原因）
          </label>
        )}

        {isEmergency ? (
          <div>
            <label className={labelClass}>緊急處理特殊原因（必填）</label>
            <textarea
              className={inputClass}
              rows={2}
              value={emergencyReason}
              onChange={(e) => setEmergencyReason(e.target.value)}
            />
          </div>
        ) : (
          <div>
            <label className={labelClass}>核准人（必填，須為授權管理人員，且不可為操作人本人）</label>
            <select
              className={inputClass}
              value={approverUserId}
              onChange={(e) => setApproverUserId(e.target.value)}
            >
              <option value="">－ 請選擇 －</option>
              {approverCandidates.map((u) => (
                <option key={u.id} value={u.id} disabled={u.id === operatorUserId}>
                  {u.name}（{roleLabel[u.role] ?? u.role}）
                  {u.id === operatorUserId ? "－不可選自己" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && <p className={errorTextClass}>{error}</p>}

        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className={secondaryButtonClass} onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="button" className={primaryButtonClass} onClick={handleSubmit} disabled={busy}>
            {busy ? "處理中…" : actionLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
