"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useOperator } from "@/lib/operatorClient";
import { labelClass, inputClass, secondaryButtonClass, errorTextClass } from "./formStyles";

type Props = {
  householdId: string;
  memberCount: number;
  onClose: () => void;
  onSuccess: () => void;
};

type ArchivePreview = {
  canArchive: boolean;
  blockers: string[];
  activeMemberCount: number;
  draftActivityCount: number;
  unpaidClaimCount: number;
  unpaidAmount: number;
  mergedFromCount: number;
};

/**
 * V12.1「家戶管理中心」指令「十四、空家戶處理」＋ V28 封存前檢查。
 *
 * 封存前先向 GET /api/households/[id]/archive 取得檢查結果：在戶成員、未完成
 * （草稿）活動、未收款等任一項存在都會阻擋封存，並在畫面列出原因與處理指引，
 * 而不是只看成員數。沿用既有 Household.deletedAt／deletedByName，封存後可從
 * 既有回收區還原，不是永久刪除。
 */
export default function ArchiveHouseholdDialog({ householdId, onClose, onSuccess }: Props) {
  const { operatorUserId } = useOperator();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ArchivePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/households/${householdId}/archive`);
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setError(data.error ?? "封存前檢查失敗，請稍後再試一次。");
        } else {
          setPreview(data.data as ArchivePreview);
        }
      } catch {
        if (alive) setError("網路錯誤，請稍後再試一次。");
      } finally {
        if (alive) setLoadingPreview(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [householdId]);

  const canArchive = preview?.canArchive ?? false;

  async function handleConfirm() {
    if (submitting || !canArchive) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/households/${householdId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "封存失敗，請稍後再試一次。");
        return;
      }
      onSuccess();
      onClose();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="封存家戶" onClose={onClose}>
      {loadingPreview ? (
        <p className="text-sm text-ink-faint">封存前檢查中…</p>
      ) : !canArchive ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-soft">目前無法封存這個家戶，請先處理以下項目：</p>
          <ul className="flex flex-col gap-2">
            {(preview?.blockers ?? ["尚有使用中的關聯資料"]).map((b, i) => (
              <li key={i} className="rounded-2xl bg-blossom-50 px-4 py-2.5 text-sm text-ink">
                • {b}
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-faint">
            成員可用「管理家戶成員」轉移或封存；未完成活動請於報名畫面完成或取消；未收款請於收款中心處理。處理完成後再回到這裡即可封存。
          </p>
          {error && <p className={errorTextClass}>{error}</p>}
          <div className="mt-2 flex justify-end">
            <button type="button" className={`${secondaryButtonClass} min-h-11 w-full sm:w-auto`} onClick={onClose}>
              知道了
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="rounded-2xl bg-sage-50 px-4 py-3 text-sm text-ink-soft">
            檢查通過：這個家戶沒有在戶成員、未完成活動或未收款。封存後不會出現在一般家戶列表，但資料不會被刪除，可從「系統管理中心 → 回收區」隨時還原。
          </p>
          <div>
            <label className={labelClass}>封存原因（選填）</label>
            <input className={`${inputClass} min-h-11`} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {error && <p className={errorTextClass}>{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className={`${secondaryButtonClass} min-h-11 w-full sm:w-auto`} onClick={onClose} disabled={submitting}>
              取消
            </button>
            <button
              type="button"
              className="rounded-full bg-blossom-200 px-5 py-2.5 text-sm text-ink transition hover:bg-blossom-300 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleConfirm}
              disabled={submitting}
            >
              {submitting ? "處理中…" : "確認封存家戶"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
