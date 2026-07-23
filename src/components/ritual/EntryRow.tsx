"use client";

import { useState, type KeyboardEvent } from "react";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";
import AdditionalPrintItemsPanel from "./AdditionalPrintItemsPanel";
import YangshangEditor from "./YangshangEditor";
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
  /** 超拔祖先／乙位正魂才顯示陽上人與地址欄。 */
  supportsYangshang?: boolean;
};

/** 已加入陽上人的既有值（相容舊單一 yangshangName）。 */
function initialNames(entry: EntryJSON): string[] {
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
  supportsYangshang = false,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(entry.displayName);
  const [yangshangNames, setYangshangNames] = useState<string[]>(initialNames(entry));
  const [tabletAddress, setTabletAddress] = useState(entry.tabletAddress ?? "");
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [submitting, setSubmitting] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPrintItems, setShowPrintItems] = useState(false);

  function cancelEdit() {
    setEditing(false);
    setError(null);
    setDisplayName(entry.displayName);
    setYangshangNames(initialNames(entry));
    setTabletAddress(entry.tabletAddress ?? "");
    setNotes(entry.notes ?? "");
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
        </div>
        {supportsYangshang && (
          <>
            <div>
              <label className={labelClass}>陽上人（可多位）</label>
              <YangshangEditor
                value={yangshangNames}
                onChange={setYangshangNames}
                householdMemberNames={householdMemberNames}
              />
            </div>
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
          </>
        )}
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
          <p className="text-sm text-ink">{entry.displayName}</p>
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
          sourceDisplayName={entry.displayName}
        />
      )}
    </div>
  );
}
