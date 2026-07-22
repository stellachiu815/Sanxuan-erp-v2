"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";
import {
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";

/**
 * V14：信眾詳情頁「新增活動報名」——兩段式多項目報名。
 *
 * 流程（指令八）：
 *   ① 先選主活動（普渡／年度燈／宮慶／補褲／龍鳳燈，動態來自 RegistrationItemType）
 *   ② 顯示該主活動的報名項目 → 選一個具體項目 + 年度 + 成員
 *   ③ 建立報名項目（掛在既有 RitualRecord 之下）→ 進統一報名編輯頁
 *
 * ⚠️ 不再有舊版那種「未設定報名表就整個不能按」的死路：只要該項目的
 *    活動類型有開放年度即可報名。
 * 同一位信眾可在同一主活動下報名多個不同項目（回編輯頁再加即可）。
 */

type ItemView = {
  id: string;
  key: string;
  name: string;
  activityType: string;
  activityGroup: string;
  activityGroupName: string;
  contentKind: string;
  feeMode: string;
  defaultUnitPrice: number | null;
  defaultQuantity: number;
  allowMultiplePerMember: boolean;
};
type GroupView = { activityGroup: string; activityGroupName: string; items: ItemView[] };
type OpenYear = { year: number; templeEventId: string; name: string };
type HouseholdMember = { id: string; name: string; role: string; isDeceased: boolean };

type Props = { memberId: string; onClose: () => void };

export default function NewActivityRegistrationDialog({ memberId, onClose }: Props) {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupView[] | null>(null);
  const [openYears, setOpenYears] = useState<Record<string, OpenYear[]>>({});
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<number | "">("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState<number>(1);
  const [feeChoice, setFeeChoice] = useState<"FIXED" | "CUSTOM">("FIXED");
  const [customAmount, setCustomAmount] = useState<string>("");
  const [customName, setCustomName] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchRegistration(`/api/devotee-center/${memberId}/activity-groups`);
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setGroups(data.groups);
      setOpenYears(data.openYearsByActivityType ?? {});
      setMembers(data.householdMembers ?? []);
      setSelectedMemberIds([memberId]);
    } catch {
      setError("網路連線問題，請稍後再試一次。");
    }
  }, [memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  const group = groups?.find((g) => g.activityGroup === selectedGroup) ?? null;
  const item = group?.items.find((i) => i.id === selectedItemId) ?? null;
  const yearsForItem = item ? openYears[item.activityType] ?? [] : [];

  useEffect(() => {
    // 選了項目後自動帶入預設數量與可選年度
    if (item) {
      setQuantity(item.defaultQuantity);
      if (yearsForItem.length > 0) setSelectedYear(yearsForItem[0].year);
      else setSelectedYear("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemId]);

  function toggleMember(id: string) {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  const needsQuantity = item ? ["PER_UNIT"].includes(item.feeMode) || item.contentKind === "TURTLE" : false;
  const needsFeeChoice = item?.feeMode === "FIXED_OR_CUSTOM";
  const needsCustomAmount =
    item?.feeMode === "CUSTOM" || (needsFeeChoice && feeChoice === "CUSTOM");
  const canCustomName = item ? ["POCKET"].includes(item.contentKind) : false;

  const canSubmit =
    item !== null &&
    selectedYear !== "" &&
    selectedMemberIds.length > 0 &&
    (!needsCustomAmount || Number(customAmount) >= 0);

  async function submit() {
    if (!item || selectedYear === "") return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchRegistration(
        `/api/devotee-center/${memberId}/registration-items`,
        {
          method: "POST",
          body: JSON.stringify({
            registrationItemTypeId: item.id,
            year: selectedYear,
            participantMemberIds: selectedMemberIds,
            quantity: needsQuantity ? quantity : undefined,
            customName: canCustomName && customName.trim() ? customName.trim() : undefined,
            customAmount: needsCustomAmount ? Number(customAmount) : undefined,
            feeChoice: needsFeeChoice ? feeChoice : undefined,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      router.push(`${data.editorUrl}?from=${memberId}`);
    } catch {
      setError("網路連線問題，請稍後再試一次。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="新增活動報名" onClose={onClose}>
      {groups === null ? (
        <p className="py-8 text-center text-sm text-ink-soft">{error ?? "讀取中…"}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {error && <p className={errorTextClass}>{error}</p>}

          {/* ── ① 選主活動 ── */}
          <div>
            <label className={labelClass}>① 選擇主活動</label>
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <button
                  key={g.activityGroup}
                  type="button"
                  onClick={() => {
                    setSelectedGroup(g.activityGroup);
                    setSelectedItemId("");
                  }}
                  className={`min-h-11 rounded-full px-4 py-2 text-sm transition ${
                    selectedGroup === g.activityGroup
                      ? "bg-sage-200 text-ink"
                      : "bg-cream-100 text-ink-soft hover:bg-cream-200"
                  }`}
                >
                  {g.activityGroupName}
                </button>
              ))}
            </div>
          </div>

          {/* ── ② 選報名項目 ── */}
          {group && (
            <div>
              <label className={labelClass}>② 選擇報名項目（{group.activityGroupName}）</label>
              <div className="flex flex-col gap-1.5">
                {group.items.map((i) => {
                  const hasYear = (openYears[i.activityType] ?? []).length > 0;
                  return (
                    <button
                      key={i.id}
                      type="button"
                      disabled={!hasYear}
                      onClick={() => setSelectedItemId(i.id)}
                      className={`rounded-xl px-4 py-3 text-left text-sm transition ${
                        selectedItemId === i.id
                          ? "bg-sage-100 text-ink"
                          : hasYear
                            ? "bg-cream-50 text-ink-soft hover:bg-cream-100"
                            : "cursor-not-allowed bg-cream-100 text-ink-faint"
                      }`}
                    >
                      <span className="text-ink">{i.name}</span>
                      {!hasYear && (
                        <span className="ml-2 text-xs text-ink-faint">（本年度尚未開放此活動）</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── ③ 年度 + 成員 + 收費 ── */}
          {item && (
            <>
              <div>
                <label className={labelClass}>年度</label>
                <div className="flex flex-wrap gap-2">
                  {yearsForItem.map((y) => (
                    <button
                      key={y.templeEventId}
                      type="button"
                      onClick={() => setSelectedYear(y.year)}
                      className={`min-h-9 rounded-full px-3 py-1.5 text-xs transition ${
                        selectedYear === y.year ? "bg-mist-200 text-ink" : "bg-cream-100 text-ink-soft"
                      }`}
                    >
                      民國 {y.year} 年
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelClass}>本次報名成員</label>
                <div className="flex flex-wrap gap-1.5">
                  {members.map((m) => {
                    const on = selectedMemberIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleMember(m.id)}
                        className={`min-h-9 rounded-full px-3 py-1.5 text-xs transition ${
                          on ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft hover:bg-cream-200"
                        }`}
                      >
                        {on ? "✓ " : ""}
                        {m.name}
                        {m.id === memberId && <span className="ml-1 text-ink-faint">本人</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {needsQuantity && (
                <div>
                  <label className={labelClass}>數量</label>
                  <input
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                    className="w-24 rounded-xl border border-cream-300 px-3 py-2 text-sm"
                  />
                </div>
              )}

              {canCustomName && (
                <div>
                  <label className={labelClass}>自訂名稱（額外寶袋，可空）</label>
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="例如：地基主寶袋"
                    className="w-full rounded-xl border border-cream-300 px-3 py-2 text-sm"
                  />
                </div>
              )}

              {needsFeeChoice && (
                <div>
                  <label className={labelClass}>贊普收費方式</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFeeChoice("FIXED")}
                      className={`min-h-9 rounded-full px-3 py-1.5 text-xs ${feeChoice === "FIXED" ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft"}`}
                    >
                      每年固定費用
                    </button>
                    <button
                      type="button"
                      onClick={() => setFeeChoice("CUSTOM")}
                      className={`min-h-9 rounded-full px-3 py-1.5 text-xs ${feeChoice === "CUSTOM" ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft"}`}
                    >
                      其他自訂金額
                    </button>
                  </div>
                </div>
              )}

              {needsCustomAmount && (
                <div>
                  <label className={labelClass}>自訂金額</label>
                  <input
                    type="number"
                    min={0}
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className="w-32 rounded-xl border border-cream-300 px-3 py-2 text-sm"
                  />
                </div>
              )}
            </>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button type="button" className={secondaryButtonClass} onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => void submit()}
              disabled={busy || !canSubmit}
            >
              {busy ? "處理中…" : "建立報名並填寫內容"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
