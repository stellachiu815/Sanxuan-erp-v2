"use client";

import React, { useState, type KeyboardEvent } from "react";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";
import AdditionalPrintItemsPanel from "./AdditionalPrintItemsPanel";
import YangshangEditor from "./YangshangEditor";
import { displayDebtCreditorName } from "@/lib/debtCreditorName";
import { ritualCoreName, resolveRitualDisplayName } from "@/lib/ritualDisplayName";
import type { EntryJSON, RecordJSON } from "./types";

import { fetchUniversalSalvation } from "@/lib/universalSalvationFetch";
type Props = {
  householdId: string;
  year: number;
  entry: EntryJSON;
  onRecordUpdated: (record: RecordJSON) => void;
  /** V14.1：家戶成員姓名（供陽上人快速加入）與家戶地址（供帶入牌位地址）。 */
  householdMemberNames?: string[];
  householdAddress?: string | null;
  /** V14.2：本戶固定陽上人名單與「存入本戶固定名單」的回呼。 */
  householdYangshangNames?: string[];
  onAddToHouseholdYangshang?: (name: string) => void | Promise<void>;
  /**
   * V27：四類牌位（歷代祖先／乙位正魂／累世冤親債主／無緣子女）都可查看並增修
   * 既有陽上人——重新開啟時直接以 entry.yangshangNames（相容舊 yangshangName）
   * 回填 YangshangEditor，儲存仍寫回同一筆 UniversalSalvationEntry.yangshangNames。
   */
  showYangshang?: boolean;
  /** 牌位地址欄與「同步家戶永久名單」：僅歷代祖先／乙位正魂顯示（維持原行為）。 */
  showTabletAddress?: boolean;
  /** 確認前「尚缺」提示：是否要求陽上人（歷代祖先／乙位正魂／累世冤親債主為 true）。 */
  requireYangshang?: boolean;
  /** 確認前「尚缺」提示：是否要求牌位地址（僅歷代祖先／乙位正魂）。 */
  requireTabletAddress?: boolean;
};

/** 已加入陽上人的既有值（相容舊單一 yangshangName）。四種牌位共用；
 *  同時作為 useState 初值與 V27 entry 變動時同步 state 的唯一推導來源。 */
export function initialNames(entry: EntryJSON): string[] {
  if (entry.yangshangNames && entry.yangshangNames.length > 0) return entry.yangshangNames;
  return entry.yangshangName ? [entry.yangshangName] : [];
}

/** 單一筆登記項目（歷代祖先／個人乙位正魂／冤親債主／無緣子女其中一筆）。 */
export default function EntryRow({
  householdId,
  year,
  entry,
  onRecordUpdated,
  householdMemberNames = [],
  householdAddress = null,
  householdYangshangNames = [],
  onAddToHouseholdYangshang,
  showYangshang = false,
  showTabletAddress = false,
  requireYangshang = false,
  requireTabletAddress = false,
}: Props) {
  const [editing, setEditing] = useState(false);
  // V33.1：編輯框只回填「核心名稱」（歷代祖先→王姓、乙位正魂→陳永育；依 entry.category 欄位，不猜名稱）。
  const [displayName, setDisplayName] = useState(ritualCoreName(entry.category, entry.displayName));
  const [yangshangNames, setYangshangNames] = useState<string[]>(initialNames(entry));
  const [tabletAddress, setTabletAddress] = useState(entry.tabletAddress ?? "");
  const [notes, setNotes] = useState(entry.notes ?? "");
  // V32 單筆自訂列印主文（空白＝用系統預設主文；有值只覆寫此筆）。
  const [printMainText, setPrintMainText] = useState((entry as { printMainText?: string | null }).printMainText ?? "");
  // V15R6.1：祖先／正魂編輯時，是否同步更新家戶永久名單（預設勾選，但不偷偷覆蓋）。
  const [syncToHousehold, setSyncToHousehold] = useState(true);
  const [submitting, setSubmitting] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPrintItems, setShowPrintItems] = useState(false);

  // V27.1 回歸修正：移除 d411768 引入的「entry 變動同步 effect」（原依賴 entry 與 editing）。
  //
  // 那個 effect 會在**每次 entry 參考變動**時重設本地 state。由於新增/儲存後
  // handleUpdated 會用整包新 record（每個 entry 都是新物件）取代舊 record，於是
  // 全部 EntryRow 的 entry 參考都改變、effect 同時觸發並以 initialNames 重新
  // 建構陣列重設 state，在新增/刷新循環中造成祖先／正魂列 render state 抖動，
  // 使**新加入的歷代祖先無法穩定顯示**（609a870 只在 mount 求值一次、穩定）。
  //
  // 四類陽上人回填仍保留：由下方 `useState(initialNames(entry))` 於 mount 完成；
  // 重新進入編輯器＝重新 mount，一樣會回填。讀取列顯示本就直接讀 entry（prop 驅動）。
  // 不再於 render 後用 effect 覆蓋 state，因此也不會蓋掉使用者尚未儲存的輸入。

  function cancelEdit() {
    setEditing(false);
    setError(null);
    setDisplayName(ritualCoreName(entry.category, entry.displayName));
    setYangshangNames(initialNames(entry));
    setTabletAddress(entry.tabletAddress ?? "");
    setNotes(entry.notes ?? "");
    setPrintMainText((entry as { printMainText?: string | null }).printMainText ?? "");
  }

  async function handleSave() {
    if (!displayName.trim()) {
      setError("請輸入名稱");
      return;
    }
    setSubmitting("save");
    setError(null);
    try {
      const res = await fetchUniversalSalvation(
        `/api/households/${householdId}/rituals/universal-salvation/${year}/entries/${entry.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: displayName.trim(),
            // 送出多位陽上人與此筆牌位地址；伺服器會清理並同步舊 yangshangName 首位。
            yangshangNames,
            tabletAddress: tabletAddress.trim() || null,
            notes: notes.trim() || null,
            // V32 單筆列印主文覆寫（空白→清除、用系統預設）。
            printMainText: printMainText.trim() || null,
            // V15R6.1：只有祖先／正魂顯示牌位地址時，才依使用者勾選同步永久名單。
            ...(showTabletAddress ? { syncToHousehold } : {}),
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "儲存失敗，請稍後再試一次。");
        return;
      }
      onRecordUpdated(data.record);
      setEditing(false);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(null);
    }
  }

  // V3.2「大量登記優化」：編輯狀態下支援 Enter 儲存、Esc 取消，不用一直拿滑鼠。
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  }

  async function handleDelete() {
    setSubmitting("delete");
    setError(null);
    try {
      const res = await fetchUniversalSalvation(
        `/api/households/${householdId}/rituals/universal-salvation/${year}/entries/${entry.id}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "刪除失敗，請稍後再試一次。");
        return;
      }
      onRecordUpdated(data.record);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(null);
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-xl bg-white/80 p-4">
        <div>
          <label className={labelClass}>名稱</label>
          <input
            className={inputClass}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          {/* V33.1：核心名稱輸入提示；完整顯示由系統自動組成，不需重複輸入後綴。 */}
          {entry.category === "ANCESTOR_LINE" && (
            <p className="mt-1 text-xs text-ink-faint">請輸入姓氏，例如「王姓」；系統會自動顯示為「{resolveRitualDisplayName("ANCESTOR_LINE", displayName || "王姓")}」。</p>
          )}
          {entry.category === "INDIVIDUAL_SOUL" && (
            <p className="mt-1 text-xs text-ink-faint">請輸入亡者姓名，例如「陳永育」；系統會自動顯示為「{resolveRitualDisplayName("INDIVIDUAL_SOUL", displayName || "陳永育")}」。</p>
          )}
        </div>
        {/* V27：四類牌位都可查看／增修既有陽上人（重新開啟時已由 initialNames 回填）。 */}
        {showYangshang && (
          <div>
            <label className={labelClass}>陽上人（可多位）</label>
            <YangshangEditor
              value={yangshangNames}
              onChange={setYangshangNames}
              householdMemberNames={householdMemberNames}
              householdYangshangNames={householdYangshangNames}
              onAddToHouseholdYangshang={onAddToHouseholdYangshang}
            />
          </div>
        )}
        {showTabletAddress && (
          <>
            <div>
              <label className={labelClass}>牌位地址</label>
              <div className="flex gap-2">
                <input
                  className={inputClass}
                  value={tabletAddress}
                  onChange={(e) => setTabletAddress(e.target.value)}
                  placeholder="此牌位的地址"
                />
                {householdAddress && (
                  <button
                    type="button"
                    onClick={() => setTabletAddress(householdAddress)}
                    className="min-h-10 shrink-0 rounded-full bg-cream-100 px-3 text-xs text-ink-soft hover:bg-cream-200"
                  >
                    帶入家戶地址
                  </button>
                )}
              </div>
            </div>
            {/* V15R6.1：同步更新家戶永久名單（預設勾選；不勾則只改本次活動草稿，不動永久名單）。 */}
            <label className="flex items-start gap-2 rounded-xl bg-sage-50 px-3 py-2 text-xs text-ink">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={syncToHousehold}
                onChange={(e) => setSyncToHousehold(e.target.checked)}
              />
              <span>
                同步更新家戶永久名單
                <span className="ml-1 text-ink-faint">（下次活動可自動帶入；不勾選則只修改本次活動草稿）</span>
              </span>
            </label>
          </>
        )}
        <div>
          <label className={labelClass}>自訂列印主文（選填）</label>
          <input
            className={inputClass}
            value={printMainText}
            onChange={(e) => setPrintMainText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="空白＝用系統預設主文；可填 本宅地基主／地基主／歷代地主…（只覆寫此筆列印主文，不改分類）"
          />
        </div>
        <div>
          <label className={labelClass}>備註</label>
          <input
            className={inputClass}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        {error && <p className={errorTextClass}>{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className={secondaryButtonClass} onClick={cancelEdit}>
            取消
          </button>
          <button
            type="button"
            className={primaryButtonClass}
            onClick={handleSave}
            disabled={submitting !== null}
          >
            {submitting === "save" ? "儲存中…" : "儲存"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white/80 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* V33.1：非編輯的唯讀顯示一律用共用 resolver 顯示完整名稱（依 category 欄位，不猜名稱）。 */}
          <p className="text-sm text-ink">{resolveRitualDisplayName(entry.category, entry.displayName)}</p>
          {(() => {
            const names = initialNames(entry);
            const hasAny = names.length > 0 || entry.tabletAddress || entry.notes;
            if (!hasAny) return null;
            return (
              <p className="mt-0.5 break-words text-xs text-ink-faint">
                {names.length > 0 && <>陽上人：{names.join("、")}</>}
                {names.length > 0 && (entry.tabletAddress || entry.notes) && "　"}
                {entry.tabletAddress && <>牌位地址：{entry.tabletAddress}</>}
                {entry.tabletAddress && entry.notes && "　"}
                {entry.notes && <>備註：{entry.notes}</>}
              </p>
            );
          })()}
          {/* V15R6：逐筆清楚提示尚缺的必要欄位（草稿可先存，正式確認前補齊即可）。
              祖先／乙位正魂需：牌位姓名＋陽上人＋牌位地址；冤親只需牌位姓名（不要求地址）。 */}
          {(() => {
            const names = initialNames(entry);
            const missing: string[] = [];
            if (!entry.displayName || !entry.displayName.trim()) missing.push("牌位姓名");
            // V27：依各牌位實際確認規則提示（歷代祖先/乙位正魂需陽上人＋地址；
            // 累世冤親債主只需陽上人；無緣子女兩者皆非必填）。
            if (requireYangshang && names.length === 0) missing.push("陽上人");
            if (requireTabletAddress && (!entry.tabletAddress || !entry.tabletAddress.trim())) missing.push("牌位地址");
            if (missing.length === 0) return null;
            return (
              <div className="mt-1 rounded-lg bg-yolk-50 px-3 py-2 text-xs text-ink">
                <p className="mb-0.5 text-ink-soft">尚缺欄位（草稿可先儲存，確認報名前補齊）：</p>
                <ul className="list-disc pl-4">
                  {missing.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            );
          })()}
          {error && <p className={`mt-1 ${errorTextClass}`}>{error}</p>}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setShowPrintItems((v) => !v)}
            className="rounded-full px-3 py-1.5 text-xs text-ink-soft transition hover:bg-mist-100 hover:text-ink"
          >
            {showPrintItems ? "收起寶袋" : "寶袋與附加列印"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-full px-3 py-1.5 text-xs text-ink-soft transition hover:bg-cream-200 hover:text-ink"
          >
            編輯
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={submitting !== null}
            className="rounded-full px-3 py-1.5 text-xs text-ink-soft transition hover:bg-blossom-100 hover:text-ink disabled:opacity-50"
          >
            {submitting === "delete" ? "刪除中…" : "刪除"}
          </button>
        </div>
      </div>

      {showPrintItems && (
        <AdditionalPrintItemsPanel
          householdId={householdId}
          year={year}
          entryId={entry.id}
          sourceDisplayName={resolveRitualDisplayName(entry.category, entry.displayName)}
        />
      )}
    </div>
  );
}
