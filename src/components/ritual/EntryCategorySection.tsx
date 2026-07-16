"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";
import EntryRow from "./EntryRow";
import DuplicateConfirmDialog from "./DuplicateConfirmDialog";
import type { EntryAddMode, EntryCategory, EntryJSON, RecordJSON } from "./types";

type Props = {
  householdId: string;
  year: number;
  category: EntryCategory;
  title: string;
  tone: string;
  addMode: EntryAddMode;
  fixedDisplayName?: string;
  entries: EntryJSON[];
  onRecordUpdated: (record: RecordJSON) => void;
};

/**
 * 一個登記分類的區塊（例如「歷代祖先」），列出目前的登記項目、可新增/編輯/刪除。
 *
 * V3.1「行政流程優化」：新增的填寫方式依分類不同（見 types.ts 的 addMode 說明）。
 * V3.2「大量登記優化」：歷代祖先／個人乙位正魂改成 Enter 直接新增、新增後自動
 * 清空並回到輸入框，方便連續輸入很多戶；冤親債主／無緣子女可以一次輸入數量
 * 建立多筆；新增前如果本年度已經有同名項目，會先跳出確認提示。
 * 名稱組成規則、重複檢查都只在這裡（畫面）處理，送到後端的 API 完全沒有變，
 * 一律還是傳完整的 displayName 字串，也沒有新增任何 API。
 */
export default function EntryCategorySection({
  householdId,
  year,
  category,
  title,
  tone,
  addMode,
  fixedDisplayName,
  entries,
  onRecordUpdated,
}: Props) {
  async function postEntry(payload: {
    displayName: string;
    yangshangName?: string | null;
    notes?: string | null;
  }) {
    const res = await fetch(
      `/api/households/${householdId}/rituals/universal-salvation/${year}/entries`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, ...payload }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "新增失敗，請稍後再試一次。");
    }
    return data.record as RecordJSON;
  }

  return (
    <div className={`rounded-2xl p-5 ${tone}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium text-ink">{title}</h3>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-ink-soft">
          {entries.length} 筆
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {entries.length === 0 && (
          <p className="text-sm text-ink-faint">尚無登記項目。</p>
        )}
        {entries.map((entry) => (
          <EntryRow
            key={entry.id}
            householdId={householdId}
            year={year}
            entry={entry}
            onRecordUpdated={onRecordUpdated}
          />
        ))}
      </div>

      {addMode === "surname" && (
        <SurnameAddForm entries={entries} onAdd={postEntry} onRecordUpdated={onRecordUpdated} />
      )}

      {addMode === "name" && (
        <NameAddForm entries={entries} onAdd={postEntry} onRecordUpdated={onRecordUpdated} />
      )}

      {addMode === "batch" && (
        <BatchAddForm
          fixedDisplayName={fixedDisplayName ?? title}
          onAdd={postEntry}
          onRecordUpdated={onRecordUpdated}
        />
      )}
    </div>
  );
}

/**
 * 歷代祖先：只填姓氏，Enter 直接新增「○○姓歷代祖先」；新增成功後清空姓氏欄、
 * 游標自動回去，方便馬上輸入下一戶。Esc 清空目前輸入。本年度已有同名項目時，
 * 先跳出確認提示，不會直接新增。
 */
function SurnameAddForm({
  entries,
  onAdd,
  onRecordUpdated,
}: {
  entries: EntryJSON[];
  onAdd: (payload: { displayName: string; notes?: string | null }) => Promise<RecordJSON>;
  onRecordUpdated: (record: RecordJSON) => void;
}) {
  const [surname, setSurname] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDuplicate, setPendingDuplicate] = useState<string | null>(null);
  const surnameInputRef = useRef<HTMLInputElement>(null);

  async function submit(displayName: string) {
    setSubmitting(true);
    setError(null);
    try {
      const record = await onAdd({ displayName, notes: notes.trim() || null });
      onRecordUpdated(record);
      setSurname("");
      setNotes("");
      surnameInputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  function handleAddClick() {
    const trimmed = surname.trim();
    if (!trimmed) {
      setError("請輸入姓氏");
      return;
    }
    const displayName = `${trimmed}姓歷代祖先`;
    if (entries.some((e) => e.displayName === displayName)) {
      setPendingDuplicate(displayName);
      return;
    }
    submit(displayName);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddClick();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setSurname("");
      setNotes("");
      setError(null);
      (e.target as HTMLInputElement).blur();
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl bg-white/80 p-4">
      <div>
        <label className={labelClass}>姓氏</label>
        <input
          ref={surnameInputRef}
          className={inputClass}
          value={surname}
          onChange={(e) => setSurname(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="例如：王，輸入後按 Enter 新增"
          maxLength={10}
          disabled={submitting}
        />
        {surname.trim() && (
          <p className="mt-1 text-xs text-ink-faint">→ {surname.trim()}姓歷代祖先</p>
        )}
      </div>
      <div>
        <label className={labelClass}>備註（選填）</label>
        <input
          className={inputClass}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={submitting}
        />
      </div>
      {error && <p className={errorTextClass}>{error}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          className={primaryButtonClass}
          onClick={handleAddClick}
          disabled={submitting}
        >
          {submitting ? "新增中…" : "新增（Enter）"}
        </button>
      </div>

      {pendingDuplicate && (
        <DuplicateConfirmDialog
          displayName={pendingDuplicate}
          onCancel={() => setPendingDuplicate(null)}
          onConfirm={() => {
            const name = pendingDuplicate;
            setPendingDuplicate(null);
            submit(name);
          }}
        />
      )}
    </div>
  );
}

/**
 * 個人乙位正魂：只填姓名，Enter 直接新增「○○○ 乙位正魂」；新增成功後清空
 * 姓名欄、游標自動回去。Esc 清空目前輸入。本年度已有同名項目時，先跳出
 * 確認提示，不會直接新增。
 */
function NameAddForm({
  entries,
  onAdd,
  onRecordUpdated,
}: {
  entries: EntryJSON[];
  onAdd: (payload: {
    displayName: string;
    yangshangName?: string | null;
    notes?: string | null;
  }) => Promise<RecordJSON>;
  onRecordUpdated: (record: RecordJSON) => void;
}) {
  const [name, setName] = useState("");
  const [yangshangName, setYangshangName] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDuplicate, setPendingDuplicate] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  async function submit(displayName: string) {
    setSubmitting(true);
    setError(null);
    try {
      const record = await onAdd({
        displayName,
        yangshangName: yangshangName.trim() || null,
        notes: notes.trim() || null,
      });
      onRecordUpdated(record);
      setName("");
      setYangshangName("");
      setNotes("");
      nameInputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  function handleAddClick() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("請輸入姓名");
      return;
    }
    const displayName = `${trimmed} 乙位正魂`;
    if (entries.some((e) => e.displayName === displayName)) {
      setPendingDuplicate(displayName);
      return;
    }
    submit(displayName);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddClick();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setName("");
      setYangshangName("");
      setNotes("");
      setError(null);
      (e.target as HTMLInputElement).blur();
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl bg-white/80 p-4">
      <div>
        <label className={labelClass}>姓名</label>
        <input
          ref={nameInputRef}
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="例如：王小明，輸入後按 Enter 新增"
          autoFocus
        />
        {name.trim() && (
          <p className="mt-1 text-xs text-ink-faint">→ {name.trim()} 乙位正魂</p>
        )}
      </div>
      <div>
        <label className={labelClass}>陽上姓名（選填）</label>
        <input
          className={inputClass}
          value={yangshangName}
          onChange={(e) => setYangshangName(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div>
        <label className={labelClass}>備註（選填）</label>
        <input
          className={inputClass}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      {error && <p className={errorTextClass}>{error}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          className={primaryButtonClass}
          onClick={handleAddClick}
          disabled={submitting}
        >
          {submitting ? "新增中…" : "新增（Enter）"}
        </button>
      </div>

      {pendingDuplicate && (
        <DuplicateConfirmDialog
          displayName={pendingDuplicate}
          onCancel={() => setPendingDuplicate(null)}
          onConfirm={() => {
            const displayName = pendingDuplicate;
            setPendingDuplicate(null);
            submit(displayName);
          }}
        />
      )}
    </div>
  );
}

/**
 * 冤親債主／無緣子女：輸入數量、一次建立多筆。數量是 1 時維持原本做法
 * （單純一筆固定名稱，不加編號）；數量大於 1 時依序建立「名稱（1）」～
 * 「名稱（N）」。中途若失敗，已成功新增的部分仍會保留在畫面上。
 */
function BatchAddForm({
  fixedDisplayName,
  onAdd,
  onRecordUpdated,
}: {
  fixedDisplayName: string;
  onAdd: (payload: { displayName: string }) => Promise<RecordJSON>;
  onRecordUpdated: (record: RecordJSON) => void;
}) {
  const [quantity, setQuantity] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quantityInputRef = useRef<HTMLInputElement>(null);

  const parsedQuantity = Number(quantity);

  async function handleAdd() {
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1) {
      setError("請輸入至少 1 的整數");
      return;
    }
    setSubmitting(true);
    setError(null);
    let lastRecord: RecordJSON | null = null;
    try {
      if (parsedQuantity === 1) {
        lastRecord = await onAdd({ displayName: fixedDisplayName });
      } else {
        for (let i = 1; i <= parsedQuantity; i++) {
          lastRecord = await onAdd({ displayName: `${fixedDisplayName}（${i}）` });
        }
      }
      if (lastRecord) onRecordUpdated(lastRecord);
      setQuantity("1");
      quantityInputRef.current?.focus();
      quantityInputRef.current?.select();
    } catch (err) {
      // 中途失敗時，已經成功建立的那幾筆還是要反映在畫面上，不要整批消失。
      if (lastRecord) onRecordUpdated(lastRecord);
      setError(err instanceof Error ? err.message : "網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setQuantity("1");
      setError(null);
      (e.target as HTMLInputElement).blur();
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl bg-white/80 p-4">
      <label className={labelClass}>數量</label>
      <div className="flex items-center gap-2">
        <input
          ref={quantityInputRef}
          className={`${inputClass} w-24`}
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={submitting}
        />
        <button
          type="button"
          className={primaryButtonClass}
          onClick={handleAdd}
          disabled={submitting}
        >
          {submitting ? "新增中…" : `新增${fixedDisplayName}`}
        </button>
      </div>
      <p className="text-xs text-ink-faint">
        {Number.isInteger(parsedQuantity) && parsedQuantity > 1
          ? `會建立 ${fixedDisplayName}（1）～${fixedDisplayName}（${parsedQuantity}）共 ${parsedQuantity} 筆`
          : `會建立一筆「${fixedDisplayName}」`}
      </p>
      {error && <p className={errorTextClass}>{error}</p>}
    </div>
  );
}
