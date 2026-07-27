"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
 * V15R6：家戶「多人 × 多項目」中元普渡合併報名。
 *
 * 同一畫面列出整戶成員，每位可各自勾選多個普渡項目，一次送出整戶所有選擇——
 * 沿用既有 /api/registrations/batch 單一交易，不建第二套 API／報名架構。
 * 已存在的草稿清楚標示「已報名」，不重複建立（後端 batch 亦冪等）。
 * 手機版：每位成員一張卡片、項目為大點擊區 checkbox。
 */

type Member = { id: string; name: string; role: string; isDeceased: boolean };
type Item = {
  id: string;
  key: string;
  name: string;
  contentKind: string;
  feeMode: string;
  defaultUnitPrice: number | null;
  defaultQuantity: number;
  allowMultiplePerMember: boolean;
};
type Selection = { quantity: number; customName: string; feeChoice: "FIXED" | "CUSTOM"; customAmount: string };

type Props = { householdId: string; onClose: () => void };

export default function HouseholdUniversalSalvationPicker({ householdId, onClose }: Props) {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [openYears, setOpenYears] = useState<number[]>([]);
  const [year, setYear] = useState<number | "">("");
  const [existing, setExisting] = useState<Record<string, number>>({});
  // selected[memberId][itemId] = Selection
  const [selected, setSelected] = useState<Record<string, Record<string, Selection>>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(
    async (y?: number) => {
      try {
        const qs = y ? `?year=${y}` : "";
        const res = await fetchRegistration(`/api/households/${householdId}/universal-salvation-batch-options${qs}`);
        const data = await res.json();
        if (!res.ok) {
          setError(toFriendlyError(res.status, data?.error));
          return;
        }
        setMembers(Array.isArray(data.members) ? data.members : []);
        setItems(Array.isArray(data.items) ? data.items : []);
        setOpenYears(Array.isArray(data.openYears) ? data.openYears : []);
        setExisting(data.existingByMemberItem ?? {});
        setYear((prev) => (prev === "" ? data.year : prev));
        setLoaded(true);
      } catch {
        setError("網路連線問題，請稍後再試一次。");
      }
    },
    [householdId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // 切換年度：重新讀既有草稿標示（既有清單依年度不同）。
  useEffect(() => {
    if (year === "" || !loaded) return;
    void load(year as number);
    // 切年度不清空使用者已勾選的內容。
  }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  const alive = useMemo(() => members, [members]);

  function isExisting(memberId: string, itemKey: string): boolean {
    return (existing[`${memberId}::${itemKey}`] ?? 0) > 0;
  }

  function toggle(memberId: string, it: Item) {
    setSelected((prev) => {
      const forMember = { ...(prev[memberId] ?? {}) };
      if (forMember[it.id]) delete forMember[it.id];
      else
        forMember[it.id] = {
          quantity: it.defaultQuantity,
          customName: "",
          feeChoice: "FIXED",
          customAmount: "",
        };
      return { ...prev, [memberId]: forMember };
    });
  }

  function patch(memberId: string, itemId: string, p: Partial<Selection>) {
    setSelected((prev) => ({
      ...prev,
      [memberId]: { ...prev[memberId], [itemId]: { ...prev[memberId][itemId], ...p } },
    }));
  }

  const totalSelected = Object.values(selected).reduce((n, m) => n + Object.keys(m).length, 0);
  const canSubmit = year !== "" && totalSelected > 0;

  async function submit() {
    if (year === "" || totalSelected === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const entries: Record<string, unknown>[] = [];
      for (const [memberId, itemsForMember] of Object.entries(selected)) {
        for (const [itemId, s] of Object.entries(itemsForMember)) {
          const it = items.find((x) => x.id === itemId);
          if (!it) continue;
          const needsAmount =
            it.feeMode === "CUSTOM" || (it.feeMode === "FIXED_OR_CUSTOM" && s.feeChoice === "CUSTOM");
          entries.push({
            memberId,
            registrationItemTypeId: itemId,
            year,
            quantity: s.quantity,
            customName: s.customName.trim() || undefined,
            customAmount: needsAmount ? Number(s.customAmount) : undefined,
            feeChoice: it.feeMode === "FIXED_OR_CUSTOM" ? s.feeChoice : undefined,
          });
        }
      }
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
      if (data.editorUrl) router.push(data.editorUrl);
    } catch {
      setError("網路連線問題，請稍後再試一次。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="整戶中元普渡報名（多人多項目）" onClose={onClose}>
      {!loaded ? (
        <p className="py-8 text-center text-sm text-ink-soft">{error ?? "讀取中…"}</p>
      ) : (
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pb-2">
          {error && <p className={errorTextClass}>{error}</p>}
          {message && <p className="rounded-2xl bg-yolk-100 px-4 py-2 text-xs text-ink">{message}</p>}

          <div>
            <label className={labelClass}>年度</label>
            {openYears.length === 0 ? (
              <p className="rounded-2xl bg-cream-100 px-4 py-2 text-xs text-ink-soft">
                目前沒有開放報名的普渡年度，仍可用本年度（民國 {year} 年）建立草稿。
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {openYears.map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => setYear(y)}
                    className={`min-h-9 rounded-full px-3 py-1.5 text-xs ${year === y ? "bg-mist-200 text-ink" : "bg-cream-100 text-ink-soft"}`}
                  >
                    民國 {y} 年
                  </button>
                ))}
              </div>
            )}
          </div>

          {items.length === 0 && (
            <p className="rounded-2xl bg-blossom-100 px-4 py-3 text-sm text-ink">
              尚未設定中元普渡的報名項目，請先於活動設定頁建立項目。
            </p>
          )}

          {/* 每位成員一張卡片，卡片內逐項目勾選 */}
          {alive.map((m) => {
            const forMember = selected[m.id] ?? {};
            return (
              <div key={m.id} className="rounded-2xl bg-cream-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm text-ink">
                    {m.name}
                    {m.isDeceased && <span className="ml-2 text-xs text-ink-faint">（已往生）</span>}
                  </span>
                  <span className="text-xs text-ink-faint">已選 {Object.keys(forMember).length} 項</span>
                </div>
                <div className="flex flex-col gap-2">
                  {items.map((it) => {
                    const on = Boolean(forMember[it.id]);
                    const s = forMember[it.id];
                    const already = isExisting(m.id, it.key);
                    const needsQty =
                      it.feeMode === "PER_UNIT" ||
                      it.contentKind === "RICE" ||
                      it.contentKind === "POCKET" ||
                      it.contentKind === "SPONSOR";
                    const needsFeeChoice = it.feeMode === "FIXED_OR_CUSTOM";
                    const needsAmount = it.feeMode === "CUSTOM" || (needsFeeChoice && s?.feeChoice === "CUSTOM");
                    const canName = it.contentKind === "POCKET" || it.contentKind === "SPONSOR";
                    return (
                      <div key={it.id} className={`rounded-xl px-3 py-2 ${on ? "bg-sage-50" : "bg-white/60"}`}>
                        <label className="flex items-center gap-3">
                          <input type="checkbox" className="h-5 w-5" checked={on} onChange={() => toggle(m.id, it)} />
                          <span className="text-sm text-ink">{it.name}</span>
                          {already && (
                            <span className="rounded-full bg-yolk-100 px-2 py-0.5 text-xs text-ink">已報名</span>
                          )}
                          {already && it.allowMultiplePerMember && (
                            <span className="text-xs text-ink-faint">（可再新增一筆）</span>
                          )}
                        </label>
                        {on && (needsQty || canName || needsFeeChoice || needsAmount) && (
                          <div className="mt-2 flex flex-wrap items-center gap-3 pl-8">
                            {needsQty && (
                              <label className="flex items-center gap-1 text-xs text-ink-soft">
                                數量
                                <input
                                  type="number"
                                  min={1}
                                  value={s.quantity}
                                  onChange={(e) => patch(m.id, it.id, { quantity: Math.max(1, Number(e.target.value) || 1) })}
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
                                  onChange={(e) => patch(m.id, it.id, { customName: e.target.value })}
                                  className="w-32 rounded-lg border border-cream-300 px-2 py-1 text-sm"
                                />
                              </label>
                            )}
                            {needsFeeChoice && (
                              <div className="flex gap-1">
                                <button type="button" onClick={() => patch(m.id, it.id, { feeChoice: "FIXED" })} className={`rounded-full px-2 py-1 text-xs ${s.feeChoice === "FIXED" ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft"}`}>固定費用</button>
                                <button type="button" onClick={() => patch(m.id, it.id, { feeChoice: "CUSTOM" })} className={`rounded-full px-2 py-1 text-xs ${s.feeChoice === "CUSTOM" ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft"}`}>自訂金額</button>
                              </div>
                            )}
                            {needsAmount && (
                              <label className="flex items-center gap-1 text-xs text-ink-soft">
                                金額
                                <input
                                  type="number"
                                  min={0}
                                  value={s.customAmount}
                                  onChange={(e) => patch(m.id, it.id, { customAmount: e.target.value })}
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
              </div>
            );
          })}
          <p className="text-xs text-ink-faint">
            送出後會建立整戶草稿並進入報名編輯頁；祖先／乙位正魂會自動帶入本戶所有既有牌位。建立草稿不會計入已收，應收於編輯頁補齊、收款另行辦理。
          </p>
        </div>
      )}

      {loaded && (
        <div className="sticky bottom-0 -mx-6 mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-cream-200 bg-cream-50 px-6 py-3">
          <span className="text-xs text-ink-faint">整戶共選 {totalSelected} 項</span>
          <div className="flex gap-2">
            <button type="button" className={secondaryButtonClass} onClick={onClose}>取消</button>
            <button type="button" className={primaryButtonClass} onClick={() => void submit()} disabled={busy || !canSubmit}>
              {busy ? "處理中…" : "建立整戶報名並填寫內容"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
