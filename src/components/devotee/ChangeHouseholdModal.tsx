"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useOperator } from "@/lib/operatorClient";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass, errorTextClass } from "@/components/household/formStyles";

/**
 * V12.5「信眾資料完整化」指令五：從信眾詳情頁快速更換家戶。
 *
 * 流程：信眾詳情 → 更換家戶 → 搜尋家戶 → 確認 → 完成
 *
 * ⚠️ 這裡**沒有任何自己的搬遷邏輯**，一律呼叫既有的
 * POST /api/households/members/transfer（V12.3 的 transferHouseholdMembers）。
 * 那支已經在單一 transaction 內處理好：Member.householdId、六張去正規化表的
 * householdId 同步、來源戶戶長與主要聯絡人、RecordVersion。這個元件只是把
 * 「一位信眾換一戶」這個最常見的情境，做成不必繞到家戶管理的捷徑。
 *
 * 家戶搜尋沿用既有 GET /api/devotee-center/household-options（V12.2 建立，
 * 搜尋欄位來自共用規格，含 V12.4 的舊編號對照），不另外做一套搜尋。
 *
 * 權限：後端 transfer API 需要 transferMember（V12.3 起 STAFF 沒有這個權限），
 * 這裡不重複判斷，由呼叫端決定是否顯示按鈕，真正把關在 API。
 */

type HouseholdOption = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  address: string | null;
  memberCount: number;
};

type Props = {
  memberId: string;
  memberName: string;
  currentHouseholdId: string;
  currentHouseholdName: string;
  onClose: () => void;
  onChanged: () => void;
};

export default function ChangeHouseholdModal({
  memberId,
  memberName,
  currentHouseholdId,
  currentHouseholdName,
  onClose,
  onChanged,
}: Props) {
  const { operatorUserId } = useOperator();

  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<HouseholdOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<HouseholdOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setOptions([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q });
        if (operatorUserId) params.set("operatorUserId", operatorUserId);
        const res = await fetch(`/api/devotee-center/household-options?${params.toString()}`);
        const json = await res.json();
        if (res.ok) {
          // 不能轉到目前這一戶，先濾掉避免使用者選了才被後端擋。
          setOptions((json.data?.households ?? []).filter((h: HouseholdOption) => h.id !== currentHouseholdId));
        } else {
          setOptions([]);
        }
      } catch {
        setOptions([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, operatorUserId, currentHouseholdId]);

  async function confirm() {
    if (!selected || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/households/members/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorUserId,
          memberIds: [memberId],
          targetHouseholdId: selected.id,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        // 後端可能要求先指定來源戶新戶長／新主要聯絡人（這位信眾正好是戶長
        // 或主要聯絡人時）。這種情況照實顯示訊息，並指引改用完整流程，
        // 不在這裡重做一套戶長選擇畫面。
        setError(
          `${json.error ?? "更換家戶失敗，請稍後再試一次。"}${
            json.error?.includes("戶長") || json.error?.includes("主要聯絡人")
              ? "　（請改由家戶詳情頁的「家戶調整（進階）→ 轉移成員」完成，該流程可以指定原戶的新戶長與主要聯絡人。）"
              : ""
          }`
        );
        return;
      }
      onChanged();
      onClose();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  const touchInput = `${inputClass} min-h-11`;
  const touchPrimary = `${primaryButtonClass} min-h-11 w-full sm:w-auto`;
  const touchSecondary = `${secondaryButtonClass} min-h-11 w-full sm:w-auto`;

  // ---- 確認步驟 ----
  if (selected) {
    return (
      <Modal title="確認更換家戶" onClose={onClose}>
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl bg-cream-50 px-4 py-3 text-sm">
            <p className="text-ink">
              將<span className="font-medium">{memberName}</span>
            </p>
            <p className="mt-2 text-ink-soft">
              從　{currentHouseholdName}（{currentHouseholdId}）
            </p>
            <p className="mt-1 text-ink-soft">
              移至
              <span className="font-medium text-ink">
                {selected.name}（{selected.id}）
              </span>
            </p>
          </div>

          <p className="rounded-2xl bg-mist-50 px-4 py-3 text-xs leading-relaxed text-ink-soft">
            這位信眾名下的收款、收據、供品認捐、爐主登錄與附加列印項目，會一併改掛到新家戶。
            <br />
            以家戶為單位的歷史紀錄（祭祀、活動）維持在原家戶，不會搬動。
          </p>

          {error && <p className={errorTextClass}>{error}</p>}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={touchSecondary} onClick={() => setSelected(null)} disabled={submitting}>
              重新選擇
            </button>
            <button type="button" className={touchPrimary} onClick={confirm} disabled={submitting}>
              {submitting ? "更換中…" : "確認更換"}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // ---- 搜尋步驟 ----
  return (
    <Modal title="更換家戶" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="rounded-2xl bg-cream-50 px-4 py-3 text-xs text-ink-soft">
          目前所屬家戶：
          <span className="text-ink">
            {currentHouseholdName}（{currentHouseholdId}）
          </span>
        </p>

        <div>
          <label className={labelClass}>搜尋要移入的家戶（編號／舊編號／戶名／主要聯絡人／電話／地址）</label>
          <input
            className={touchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="例如 F00009、王家、0912…"
            autoFocus
          />
        </div>

        {searching && <p className="text-xs text-ink-faint">搜尋中…</p>}

        {options.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {options.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => setSelected(h)}
                  className="min-h-11 w-full rounded-xl bg-white px-3 py-2 text-left text-sm text-ink
                             shadow-soft transition hover:bg-yolk-50"
                >
                  <span>{h.name}</span>
                  <span className="ml-2 text-xs text-ink-faint">
                    {h.id}・{h.memberCount} 位成員
                  </span>
                  {h.address && <span className="block text-xs text-ink-faint">{h.address}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        {!searching && query.trim() && options.length === 0 && (
          <p className="text-xs text-ink-faint">找不到符合的家戶。</p>
        )}

        {error && <p className={errorTextClass}>{error}</p>}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={touchSecondary} onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </Modal>
  );
}
