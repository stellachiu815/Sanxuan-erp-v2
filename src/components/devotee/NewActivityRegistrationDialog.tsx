"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";
import DebtCreditorMemberPicker from "@/components/ritual/DebtCreditorMemberPicker";
import { buildDebtCreditorEntries } from "@/lib/debtCreditorBatch";
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

type HouseholdMember = { id: string; name: string; role: string; isDeceased: boolean };

type Props = {
  memberId: string;
  onClose: () => void;
  /**
   * V17.3：從「活動報名」流程帶進來的活動上下文——直接預選對應主活動（例如中元普渡），
   * 不再要求使用者重新選活動。以 activityType（enum 值）比對，找到含該項目的主活動群組。
   */
  initialActivityType?: string | null;
  initialYear?: number | null;
};

export default function NewActivityRegistrationDialog({ memberId, onClose, initialActivityType, initialYear }: Props) {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupView[] | null>(null);
  const [openYears, setOpenYears] = useState<Record<string, OpenYear[]>>({});
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>([]);
  const [householdId, setHouseholdId] = useState<string>("");
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<number | "">("");
  const [selected, setSelected] = useState<Record<string, Selection>>({});
  /**
   * V14.2「全戶加入冤親債主」：當勾選冤親（US_YUANQIN）時，可展開全戶成員，
   * 每位各建一筆 US_YUANQIN（分別列印／取消／收款）。從信眾詳情頁進入預設只勾
   * 目前信眾（rule 7）；按「全戶加入」把全戶有效成員一次勾上，可再取消少數。
   */
  const [yuanqinMemberIds, setYuanqinMemberIds] = useState<Record<string, boolean>>({});
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
      setHouseholdMembers(Array.isArray(data.householdMembers) ? data.householdMembers : []);
      setHouseholdId(data.household?.id ?? "");
    } catch {
      setError("網路連線問題，請稍後再試一次。");
    }
  }, [memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  // V15R3（P0-1）：切換信眾時**重置整份表單狀態**，避免沿用上一位信眾的
  // 選取項目／贊普姓名／冤親勾選（React state 不得跨信眾殘留）。
  useEffect(() => {
    setSelected({});
    setYuanqinMemberIds({});
    setSelectedGroup("");
    setSelectedYear("");
    setMessage(null);
    setError(null);
  }, [memberId]);

  const group = groups?.find((g) => g.activityGroup === selectedGroup) ?? null;
  // 目前信眾姓名（供贊普／隨喜贊普姓名初始化）。
  const currentMemberName = householdMembers.find((m) => m.id === memberId)?.name ?? "";

  // 這個主活動可選的年度（跨其項目 activityType 的開放年度聯集）。
  const groupYears: number[] = (() => {
    if (!group) return [];
    const set = new Set<number>();
    for (const it of group.items) for (const y of openYears[it.activityType] ?? []) set.add(y.year);
    return Array.from(set).sort((a, b) => b - a);
  })();

  const currentRocYear = new Date().getFullYear() - 1911;

  /**
   * V14.1 回歸修正：選了主活動就自動帶入年度，讓報名項目**立即顯示且可勾選**。
   *
   * ⚠️ 修正先前的 stale closure：舊版 effect 依賴陣列只有 [selectedGroup] 並加了
   * eslint-disable，會捕捉到「還沒載入完 openYears 時」的舊 groupYears，導致
   * selectedYear 被設成該活動其實沒有開放的年度 → 所有項目 disabled → 勾不動
   * → selectedIds 一直是 0 → 按鈕永遠灰。
   *
   * 這裡改成：依 group / openYears 的**最新值**即時計算，依賴陣列完整；且只在
   * 「這個主活動尚未選定年度（selectedYear === ""）」時自動帶入，不覆蓋使用者
   * 的手動選擇。優先帶開放中的年度，沒有則退回本年度（批次 API 允許無 TempleEvent）。
   */
  useEffect(() => {
    if (!selectedGroup || !group) return;
    if (selectedYear !== "") return;
    const years = new Set<number>();
    for (const it of group.items) for (const y of openYears[it.activityType] ?? []) years.add(y.year);
    const sorted = Array.from(years).sort((a, b) => b - a);
    setSelectedYear(sorted.length > 0 ? sorted[0] : currentRocYear);
  }, [selectedGroup, group, openYears, selectedYear, currentRocYear]);

  // V17.3：帶入活動上下文時，直接預選對應主活動（例如中元普渡），跳過「選活動」步驟。
  // 以 activityType 找出包含該項目的主活動群組；年度由上方 effect 自動帶入（或用 initialYear）。
  useEffect(() => {
    if (!initialActivityType || !groups || selectedGroup) return;
    const g = groups.find((gr) => gr.items.some((it) => it.activityType === initialActivityType));
    if (g) {
      setSelectedGroup(g.activityGroup);
      if (initialYear) setSelectedYear(initialYear);
    }
  }, [initialActivityType, initialYear, groups, selectedGroup]);

  function yearOpenForItem(it: ItemView, year: number): boolean {
    // 這個主活動完全沒有開放中的年度時，一律視為可勾選（用本年度建立草稿報名，
    // 不因缺少已開放的 TempleEvent 而讓項目無法勾選）。
    if (groupYears.length === 0) return true;
    return (openYears[it.activityType] ?? []).some((y) => y.year === year);
  }

  function toggleItem(it: ItemView) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[it.id]) delete next[it.id];
      else
        next[it.id] = {
          quantity: it.defaultQuantity,
          // V15R3（P0-1）：贊普／隨喜贊普姓名預設帶入**目前信眾**姓名（可再修改），
          // 不留空、不沿用上一位信眾。其餘項目維持空字串。
          customName: it.contentKind === "SPONSOR" ? currentMemberName : "",
          feeChoice: "FIXED",
          customAmount: "",
        };
      return next;
    });
    // 勾選冤親債主時，預設只納入「目前信眾」（信眾入口 rule 7）；取消時清空。
    if (it.key === "US_YUANQIN") {
      setYuanqinMemberIds((prev) => (Object.keys(prev).length > 0 ? {} : { [memberId]: true }));
    }
  }

  /** 有效可帶入的家戶成員（已排除刪除；此清單本身已不含 deletedAt）。 */
  const eligibleMembers = householdMembers;

  function selectAllYuanqin() {
    const next: Record<string, boolean> = {};
    for (const m of eligibleMembers) next[m.id] = true;
    setYuanqinMemberIds(next);
  }

  function toggleYuanqinMember(id: string) {
    setYuanqinMemberIds((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
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
      const entries = selectedIds.flatMap((id) => {
        const it = group.items.find((x) => x.id === id)!;
        const s = selected[id];
        const needsAmount =
          it.feeMode === "CUSTOM" || (it.feeMode === "FIXED_OR_CUSTOM" && s.feeChoice === "CUSTOM");
        const base = {
          registrationItemTypeId: id,
          year: selectedYear,
          quantity: s.quantity,
          customName: s.customName.trim() || undefined,
          customAmount: needsAmount ? Number(s.customAmount) : undefined,
          feeChoice: it.feeMode === "FIXED_OR_CUSTOM" ? s.feeChoice : undefined,
        };
        // 冤親債主：每位勾選的成員各建一筆（分別列印／取消／收款）。未勾任何人
        // 時退回只納入目前信眾。用共用 buildDebtCreditorEntries 組（與家戶入口同一套）。
        if (it.key === "US_YUANQIN") {
          const ids = Object.keys(yuanqinMemberIds).filter((k) => yuanqinMemberIds[k]);
          const targets = ids.length > 0 ? ids : [memberId];
          return buildDebtCreditorEntries(targets, selectedYear as number, id).map((e) => ({
            ...base,
            ...e,
          }));
        }
        return [{ ...base, memberId }];
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

  // V15R5：沿用去年——把該家戶上一年度、此主活動類型的報名內容 carry-over 到選定年度
  //（依新年度單價重算、DRAFT、不帶付款/收據/列印；普渡另複製每筆牌位含 tabletAddress）。
  async function carryOver() {
    if (!group || selectedYear === "" || !householdId) return;
    const activityType = group.items[0]?.activityType;
    if (!activityType) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetchRegistration(`/api/registrations/carry-over`, {
        method: "POST",
        body: JSON.stringify({ householdId, activityType, toYear: selectedYear }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setMessage(data.message ?? "已沿用去年報名內容。");
      router.refresh();
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
            <div className="rounded-2xl bg-cream-100 p-3">
              <label className={labelClass}>建立方式</label>
              <div className="flex flex-wrap items-center gap-2">
                {/* V15R5：沿用去年 vs 全新建立（全新＝直接在下方勾選項目送出）。 */}
                <button
                  type="button"
                  onClick={carryOver}
                  disabled={busy || !householdId}
                  className="rounded-full bg-sage-100 px-4 py-1.5 text-sm text-ink transition hover:bg-sage-200 disabled:opacity-40"
                >
                  ↩ 沿用去年資料
                </button>
                <span className="text-xs text-ink-faint">或於下方直接勾選＝全新建立</span>
              </div>
              <p className="mt-1 text-xs text-ink-faint">
                沿用去年：以本年度單價重算、DRAFT，不含付款／收據／列印狀態；普渡會複製每筆牌位（含各自地址）。
              </p>
            </div>
          )}

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
                      {/* V14.2：冤親債主「全戶加入」——每位成員各建一筆（分別列印／取消／收款）。
                          與家戶入口共用同一個 DebtCreditorMemberPicker 與同一支 batch API。 */}
                      {on && it.key === "US_YUANQIN" && eligibleMembers.length > 0 && (
                        <div className="mt-2 pl-8">
                          <DebtCreditorMemberPicker
                            members={eligibleMembers}
                            selectedIds={yuanqinMemberIds}
                            onToggle={toggleYuanqinMember}
                            onAll={selectAllYuanqin}
                            onSelf={() => setYuanqinMemberIds({ [memberId]: true })}
                          />
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
