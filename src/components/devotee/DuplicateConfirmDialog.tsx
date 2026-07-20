"use client";

import Modal from "@/components/Modal";
import { errorTextClass, primaryButtonClass, secondaryButtonClass } from "@/components/household/formStyles";

/**
 * 疑似重複信眾的人工確認畫面（V12.2）。
 *
 * 兩個建立信眾的流程共用同一個元件，避免兩邊各自維護一份確認 UI 而慢慢分歧：
 *
 *   1. CreateDevoteeModal        （首頁／信眾名單的「新增信眾」）
 *   2. AddMemberModal            （家戶詳情頁的「新增家人」）
 *
 * ⚠️ 這個元件**只負責顯示與收集使用者的決定**，不做任何比對、不呼叫任何
 * API、也不會自己送出建立請求。比對一律由後端既有的
 * findPreCreateDuplicates()／findDuplicateMatches() 完成。
 *
 * ⚠️「疑似重複僅供人工確認，系統不會自動刪除或合併資料。」是 V12.0 指令
 * 「十三」的原文要求，必須顯示在畫面上。
 */

export type DuplicateView = {
  memberId: string;
  name: string;
  householdId: string;
  householdName: string;
  phone: string | null;
  address: string | null;
  birthdayDisplay: string | null;
  reasons: string[];
};

type Props = {
  duplicates: DuplicateView[];
  submitting: boolean;
  error: string | null;
  /** 標題可依情境調整（新增信眾／新增家人），預設通用。 */
  title?: string;
  /** 返回修改：關掉這個確認畫面，回到原本的表單。 */
  onBack: () => void;
  /** 查看既有信眾：導向該位信眾的詳細頁（由呼叫端決定要不要一併關閉表單）。 */
  onViewExisting: (memberId: string) => void;
  /** 確認仍要建立：呼叫端必須在這裡把「已確認」旗標同步設為 true 再送出。 */
  onConfirm: () => void;
};

export default function DuplicateConfirmDialog({
  duplicates,
  submitting,
  error,
  title = "偵測到疑似重複的信眾",
  onBack,
  onViewExisting,
  onConfirm,
}: Props) {
  // 觸控友善尺寸，跟兩個表單一致。
  const touchPrimary = `${primaryButtonClass} min-h-11 w-full sm:w-auto`;
  const touchSecondary = `${secondaryButtonClass} min-h-11 w-full sm:w-auto`;

  return (
    <Modal title={title} onClose={onBack}>
      <div className="flex flex-col gap-4">
        <p className="rounded-2xl bg-yolk-50 px-4 py-3 text-xs leading-relaxed text-ink-soft">
          系統找到下列可能是同一個人的既有資料。
          <span className="font-medium text-ink">疑似重複僅供人工確認，系統不會自動刪除或合併資料。</span>
          請確認後再決定是否要繼續建立。
        </p>

        <div className="flex flex-col gap-2">
          {duplicates.map((d) => (
            <div key={d.memberId} className="rounded-2xl bg-white/80 px-4 py-3 shadow-soft">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base text-ink">{d.name}</span>
                <span className="rounded-full bg-cream-100 px-2.5 py-0.5 text-xs text-ink-soft">
                  {d.householdName}（{d.householdId}）
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-soft">
                手機／電話：{d.phone || "—"}　生日：{d.birthdayDisplay || "—"}
              </p>
              <p className="mt-0.5 text-xs text-ink-faint">地址：{d.address || "—"}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {d.reasons.map((r) => (
                  <span key={r} className="rounded-full bg-blossom-100 px-2 py-0.5 text-xs text-ink-soft">
                    {r}
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onViewExisting(d.memberId)}
                className="mt-2 min-h-11 text-xs text-ink-soft underline-offset-4 hover:text-ink hover:underline"
              >
                取消建立，查看這位現有信眾 →
              </button>
            </div>
          ))}
        </div>

        {error && <p className={errorTextClass}>{error}</p>}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={touchSecondary} onClick={onBack} disabled={submitting}>
            返回修改
          </button>
          <button type="button" className={touchPrimary} onClick={onConfirm} disabled={submitting}>
            {submitting ? "建立中…" : "確認仍要建立"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
