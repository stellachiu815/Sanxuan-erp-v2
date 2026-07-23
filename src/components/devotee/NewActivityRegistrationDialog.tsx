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
 * V14.1：信眾詳情頁「新增活動報名」——主活動下項目**多選（checkbox）**。
 *
 * 修正兩個實際部署問題：
 *  ① 「建立報名並填寫內容」不能建立：改走整批 API /api/registrations/batch，
 *     一次交易建立多個 RitualRegistrationItem，成功後直接進報名內容編輯頁。
 *  ② 同一活動只能選一項：項目改為 checkbox 多選，可一次勾選多項，各自帶
 *     數量／自訂名稱／贊普收費方式。
 *
 * 手機：底部按鈕固定、點擊區夠大；不因 modal 高度而按不到。
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

type Selection = {
  quantity: number;
  customName: string;
  feeChoice: "FIXED" | "CUSTOM";
  customAmount: string;
};

type Props = { memberId: string; onClose: () => void };

export default function NewActivityRegistrationDialog({ memberId, onClose }: Props) {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupView[] | null>(null);
  const [openYears, setOpenYears] = useState<Record<string, OpenYear[]>>({});
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<number | "">("");
  const [selected, setSelected] = useState<Record<string, Selection>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    } catch {
      setError("網路連線問題，請稍後再試一次。");
    }
  }, [memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  const group = groups?.find((g) => g.activityGroup === selectedGroup) ?? null;

  // 這個主活動可選的年度（跨其項目 activityType 的開放年度聯集）。
  const groupYears: number[] = (() => {
    if (!group) return [];
    const set = new Set<number>();
    for (const it of group.items) for (const y of openYears[it.activityType] ?? []) set.add(y.year);
    return Array.from(set).sort((a, b) => b - a);
  })();

  function yearOpenForItem(it: ItemView, year: number): boolean {
    return (openYears[it.activityType] ?? []).some((y) => y.year === year);
  }

  function toggleItem(it: ItemView) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[it.id]) delete next[it.id];
      else
        next[it.id] = {
          quantity: it.defaultQuantity,
          customName: "",
          feeChoice: "FIXED",
          customAmount: "",
        };
      return next;
    });
  }

  function patch(id: string, p: Partial<Selection>) {
    setSelected((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));
  }

  const selectedIds = Object.keys(selected);
  const canSubmit = selectedYear !== "" && selectedIds.length > 0;

  async function submit() {
    if (!group || selectedYear === "") return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const entries = selectedIds.map((id) => {
        const it = group.items.find((x) => x.id === id)!;
        const s = selected[id];
        const needsAmount =
          it.feeMode === "CUSTOM" || (it.feeMode === "FIXED_OR_CUSTOM" && s.feeChoice === "CUSTOM");
        return {
          memberId,
          registrationItemTypeId: id,
          year: selectedYear,
          quantity: s.quantity,
          customName: s.customName.trim() || undefined,
          customAmount: needsAmount ? Number(s.customAmount) : undefined,
          feeChoice: it.feeMode === "FIXED_OR_CUSTOM" ? s.feeChoice : undefined,
        };
      });
      const res = await fetchRegistration(`/api/registrations/batch`, {
        method: "POST",
        body: JSON.stringify({ entries }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      const already = (data.outcomes ?? []).filter((o: { outcome: string }) => o.outcome === "ALREADY_EXISTS").length;
      if (already > 0) setMessage(`有 ${already} 個項目先前已報名，已略過不重複建立。`);
      if (data.editorUrl) router.push(`${data.editorUrl}?from=${memberId}`);
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
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pb-2">
          {error && <p className={errorTextClass}>{error}</p>}
          {message && <p className="rounded-2xl bg-yolk-100 px-4 py-2 text-xs text-ink">{message}</p>}

          {/* ① 主活動 */}
          <div>
            <label className={labelClass}>① 選擇主活動</label>
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <button
                  key={g.activityGroup}
                  type="button"
                  onClick={() => {
                    setSelectedGroup(g.activityGroup);
                    setSelected({});
                    setSelectedYear("");
                  }}
                  className={`min-h-11 rounded-full px-4 py-2 text-sm transition ${
                    selectedGroup === g.activityGroup ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft hover:bg-cream-200"
                  }`}
                >
                  {g.activityGroupName}
                </button>
              ))}
            </div>
          </div>

          {/* ② 年度 */}
          {group && (
            <div>
              <label className={labelClass}>② 年度</label>
              {groupYears.length === 0 ? (
                <p className="rounded-2xl bg-cream-100 px-4 py-2 text-xs text-ink-soft">本活動目前沒有開放報名的年度。</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {groupYears.map((y) => (
                    <button
                      key={y}
                      type="button"
                      onClick={() => setSelectedYear(y)}
                      className={`min-h-9 rounded-full px-3 py-1.5 text-xs ${selectedYear === y ? "bg-mist-200 text-ink" : "bg-cream-100 text-ink-soft"}`}
                    >
                      民國 {y} 年
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ③ 項目多選 */}
          {group && selectedYear !== "" && (
            <div>
              <label className={labelClass}>③ 勾選報名項目（可多選）</label>
              <div className="flex flex-col gap-2">
                {group.items.map((it) => {
                  const open = yearOpenForItem(it, selectedYear as number);
                  const on = Boolean(selected[it.id]);
                  const s = selected[it.id];
                  const needsQty =
                    it.feeMode === "PER_UNIT" ||
                    it.contentKind === "TURTLE" ||
                    it.contentKind === "RICE" ||
                    it.contentKind === "POCKET" ||
                    it.contentKind === "SPONSOR"; // 贊普／隨喜贊普 份數
                  const needsFeeChoice = it.feeMode === "FIXED_OR_CUSTOM";
                  const needsAmount = it.feeMode === "CUSTOM" || (needsFeeChoice && s?.feeChoice === "CUSTOM");
                  const canName = it.contentKind === "POCKET" || it.contentKind === "SPONSOR";
                  return (
                    <div key={it.id} className={`rounded-2xl px-4 py-3 ${on ? "bg-sage-50" : "bg-cream-50"} ${!open ? "opacity-50" : ""}`}>
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          className="h-5 w-5"
                          disabled={!open}
                          checked={on}
                          onChange={() => toggleItem(it)}
                        />
                        <span className="text-sm text-ink">{it.name}</span>
                        {!open && <span className="text-xs text-ink-faint">（本年度未開放）</span>}
                      </label>
                      {on && (
                        <div className="mt-2 flex flex-wrap items-center gap-3 pl-8">
                          {needsQty && (
                            <label className="flex items-center gap-1 text-xs text-ink-soft">
                              數量
                              <input
                                type="number"
                                min={1}
                                value={s.quantity}
                                onChange={(e) => patch(it.id, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                                className="w-20 rounded-lg border border-cream-300 px-2 py-1 text-sm"
                              />
                              {it.contentKind === "RICE" && <span className="text-ink-faint">斤</span>}
                            </label>
                          )}
                          {canName && (
                            <label className="flex items-center gap-1 text-xs text-ink-soft">
                              名稱
                              <input
                                type="text"
                                value={s.customName}
                                placeholder={it.contentKind === "SPONSOR" ? "本人／公司…" : "指定對象"}
                                onChange={(e) => patch(it.id, { customName: e.target.value })}
                                className="w-32 rounded-lg border border-cream-300 px-2 py-1 text-sm"
                              />
                            </label>
                          )}
                          {needsFeeChoice && (
                            <div className="flex gap-1">
                              <button type="button" onClick={() => patch(it.id, { feeChoice: "FIXED" })} className={`rounded-full px-2 py-1 text-xs ${s.feeChoice === "FIXED" ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft"}`}>固定費用</button>
                              <button type="button" onClick={() => patch(it.id, { feeChoice: "CUSTOM" })} className={`rounded-full px-2 py-1 text-xs ${s.feeChoice === "CUSTOM" ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft"}`}>自訂金額</button>
                            </div>
                          )}
                          {needsAmount && (
                            <label className="flex items-center gap-1 text-xs text-ink-soft">
                              金額
                              <input
                                type="number"
                                min={0}
                                value={s.customAmount}
                                onChange={(e) => patch(it.id, { customAmount: e.target.value })}
                                className="w-24 rounded-lg border border-cream-300 px-2 py-1 text-sm"
                              />
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-ink-faint">
                提示：贊普可多份、寶袋可多個且各自指定名稱，可在下一步「填寫本次報名內容」再逐筆調整。
              </p>
            </div>
          )}
        </div>
      )}

      {groups !== null && (
        <div className="sticky bottom-0 -mx-6 mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-cream-200 bg-cream-50 px-6 py-3">
          <span className="text-xs text-ink-faint">已選 {selectedIds.length} 項</span>
          <div className="flex gap-2">
            <button type="button" className={secondaryButtonClass} onClick={onClose}>取消</button>
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
