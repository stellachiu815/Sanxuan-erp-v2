"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";
import EntryRow from "./EntryRow";
import YangshangEditor from "./YangshangEditor";
import DuplicateConfirmDialog from "./DuplicateConfirmDialog";
import type { EntryAddMode, EntryCategory, EntryJSON, RecordJSON, WorshipOptionJSON } from "./types";

import { fetchUniversalSalvation } from "@/lib/universalSalvationFetch";
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
  /** V14.1：家戶成員姓名與地址，供超拔祖先／乙位正魂的陽上人與牌位地址使用。 */
  householdMemberNames?: string[];
  householdAddress?: string | null;
  /** V14.2：本戶固定陽上人名單與「存入本戶固定名單」回呼。 */
  householdYangshangNames?: string[];
  onAddToHouseholdYangshang?: (name: string) => void | Promise<void>;
  /** V14.2：本戶既有牌位可選項（帶既有陽上人＋牌位地址），依分類取用。 */
  ancestorOptions?: WorshipOptionJSON[];
  individualSoulOptions?: WorshipOptionJSON[];
  debtCreditorNames?: string[];
};

/** 超拔祖先／乙位正魂才有多位陽上人與每筆牌位地址（指令二）。 */
function categorySupportsYangshang(category: EntryCategory): boolean {
  return category === "ANCESTOR_LINE" || category === "INDIVIDUAL_SOUL";
}

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
  householdMemberNames = [],
  householdAddress = null,
  householdYangshangNames = [],
  onAddToHouseholdYangshang,
  ancestorOptions = [],
  individualSoulOptions = [],
  debtCreditorNames = [],
}: Props) {
  const supportsYangshang = categorySupportsYangshang(category);
  async function postEntry(payload: {
    displayName: string;
    yangshangName?: string | null;
    yangshangNames?: string[];
    tabletAddress?: string | null;
    notes?: string | null;
  }) {
    const res = await fetchUniversalSalvation(
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
            householdMemberNames={householdMemberNames}
            householdAddress={householdAddress}
            householdYangshangNames={householdYangshangNames}
            onAddToHouseholdYangshang={onAddToHouseholdYangshang}
            supportsYangshang={supportsYangshang}
          />
        ))}
      </div>

      {addMode === "surname" && (
        <SurnameAddForm
          entries={entries}
          onAdd={postEntry}
          onRecordUpdated={onRecordUpdated}
          ancestorOptions={ancestorOptions}
          householdYangshangNames={householdYangshangNames}
          onAddToHouseholdYangshang={onAddToHouseholdYangshang}
          householdAddress={householdAddress}
        />
      )}

      {addMode === "name" && (
        <NameAddForm
          entries={entries}
          onAdd={postEntry}
          onRecordUpdated={onRecordUpdated}
          individualSoulOptions={individualSoulOptions}
          householdYangshangNames={householdYangshangNames}
          onAddToHouseholdYangshang={onAddToHouseholdYangshang}
          householdAddress={householdAddress}
        />
      )}

      {addMode === "batch" && (
        <BatchAddForm
          entries={entries}
          fixedDisplayName={fixedDisplayName ?? title}
          onAdd={postEntry}
          onRecordUpdated={onRecordUpdated}
          existingNameOptions={category === "DEBT_CREDITOR" ? debtCreditorNames : []}
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
  ancestorOptions,
  householdYangshangNames,
  onAddToHouseholdYangshang,
  householdAddress,
}: {
  entries: EntryJSON[];
  onAdd: (payload: {
    displayName: string;
    yangshangNames?: string[];
    tabletAddress?: string | null;
    notes?: string | null;
  }) => Promise<RecordJSON>;
  onRecordUpdated: (record: RecordJSON) => void;
  ancestorOptions: WorshipOptionJSON[];
  householdYangshangNames: string[];
  onAddToHouseholdYangshang?: (name: string) => void | Promise<void>;
  householdAddress?: string | null;
}) {
  const [surname, setSurname] = useState("");
  const [notes, setNotes] = useState("");
  const [addYangshang, setAddYangshang] = useState<string[]>([]);
  // V14.2：牌位地址（預設帶入家戶主要地址，可改；存 UniversalSalvationEntry.tabletAddress）。
  const [tabletAddr, setTabletAddr] = useState(householdAddress ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDuplicate, setPendingDuplicate] = useState<string | null>(null);
  const surnameInputRef = useRef<HTMLInputElement>(null);

  async function submit(
    displayName: string,
    override?: { yangshangNames?: string[]; tabletAddress?: string | null }
  ) {
    setSubmitting(true);
    setError(null);
    try {
      const yn = override?.yangshangNames ?? (addYangshang.length > 0 ? addYangshang : undefined);
      const addr = override?.tabletAddress ?? (tabletAddr.trim() || null);
      const record = await onAdd({
        displayName,
        yangshangNames: yn,
        tabletAddress: addr,
        notes: notes.trim() || null,
      });
      onRecordUpdated(record);
      setSurname("");
      setNotes("");
      setAddYangshang([]);
      setTabletAddr(householdAddress ?? "");
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

  /** 點選本戶歷代祖先 chip：整筆帶入名稱＋既有陽上人＋既有牌位地址（不重複）。 */
  function handlePickAncestor(opt: WorshipOptionJSON) {
    if (submitting) return;
    if (entries.some((e) => e.displayName === opt.displayName)) return; // 不重複新增
    submit(opt.displayName, {
      yangshangNames: opt.yangshangNames.length > 0 ? opt.yangshangNames : undefined,
      tabletAddress: opt.tabletAddress,
    });
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
      {/* 本戶歷代祖先（一鍵帶入名稱＋既有陽上人＋牌位地址；已加入標示 ✓ 不重複） */}
      {ancestorOptions.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-ink-faint">本戶歷代祖先（點選直接帶入，含既有陽上人／地址）</p>
          <div className="flex flex-wrap gap-1.5">
            {ancestorOptions.map((opt) => {
              const already = entries.some((e) => e.displayName === opt.displayName);
              return (
                <button
                  key={opt.displayName}
                  type="button"
                  onClick={() => handlePickAncestor(opt)}
                  disabled={submitting || already}
                  className={`min-h-9 rounded-full px-3 py-1.5 text-xs transition ${
                    already
                      ? "cursor-default bg-sage-100 text-ink-faint"
                      : "bg-mist-100 text-ink-soft hover:bg-mist-200"
                  }`}
                >
                  {already ? "✓ " : "＋ "}
                  {opt.displayName}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <label className={labelClass}>姓氏（自行輸入新的歷代祖先）</label>
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

      {/* 陽上人（本戶固定陽上人一鍵加入＋手動新增；套用到即將新增的這筆） */}
      <div>
        <label className={labelClass}>陽上人（可多位，套用到新增的這筆）</label>
        <YangshangEditor
          value={addYangshang}
          onChange={setAddYangshang}
          householdMemberNames={[]}
          householdYangshangNames={householdYangshangNames}
          onAddToHouseholdYangshang={onAddToHouseholdYangshang}
        />
      </div>

      {/* 牌位地址（預設帶入家戶地址、可改；存 UniversalSalvationEntry.tabletAddress） */}
      <div>
        <label className={labelClass}>牌位地址</label>
        <input
          className={inputClass}
          value={tabletAddr}
          onChange={(e) => setTabletAddr(e.target.value)}
          placeholder="預設帶入家戶地址，可自由修改"
          disabled={submitting}
        />
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
  individualSoulOptions,
  householdYangshangNames,
  onAddToHouseholdYangshang,
  householdAddress,
}: {
  entries: EntryJSON[];
  onAdd: (payload: {
    displayName: string;
    yangshangNames?: string[];
    tabletAddress?: string | null;
    notes?: string | null;
  }) => Promise<RecordJSON>;
  onRecordUpdated: (record: RecordJSON) => void;
  individualSoulOptions: WorshipOptionJSON[];
  householdYangshangNames: string[];
  onAddToHouseholdYangshang?: (name: string) => void | Promise<void>;
  householdAddress?: string | null;
}) {
  const [name, setName] = useState("");
  const [addYangshang, setAddYangshang] = useState<string[]>([]);
  // V14.2：牌位地址（預設帶入家戶主要地址，可改；存 UniversalSalvationEntry.tabletAddress）。
  const [tabletAddr, setTabletAddr] = useState(householdAddress ?? "");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDuplicate, setPendingDuplicate] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  async function submit(
    displayName: string,
    override?: { yangshangNames?: string[]; tabletAddress?: string | null }
  ) {
    setSubmitting(true);
    setError(null);
    try {
      const yn = override?.yangshangNames ?? (addYangshang.length > 0 ? addYangshang : undefined);
      const addr = override?.tabletAddress ?? (tabletAddr.trim() || null);
      const record = await onAdd({
        displayName,
        yangshangNames: yn,
        tabletAddress: addr,
        notes: notes.trim() || null,
      });
      onRecordUpdated(record);
      setName("");
      setAddYangshang([]);
      setTabletAddr(householdAddress ?? "");
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

  /** 點選本戶乙位正魂 chip：整筆帶入名稱＋既有陽上人＋既有牌位地址（不重複）。 */
  function handlePickSoul(opt: WorshipOptionJSON) {
    if (submitting) return;
    if (entries.some((e) => e.displayName === opt.displayName)) return;
    submit(opt.displayName, {
      yangshangNames: opt.yangshangNames.length > 0 ? opt.yangshangNames : undefined,
      tabletAddress: opt.tabletAddress,
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddClick();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setName("");
      setAddYangshang([]);
      setNotes("");
      setError(null);
      (e.target as HTMLInputElement).blur();
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl bg-white/80 p-4">
      {/* 本戶乙位正魂（點選直接帶入名稱＋既有陽上人／地址；已加入標示 ✓ 不重複） */}
      {individualSoulOptions.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-ink-faint">本戶乙位正魂（點選直接帶入，含既有陽上人／地址）</p>
          <div className="flex flex-wrap gap-1.5">
            {individualSoulOptions.map((opt) => {
              const already = entries.some((e) => e.displayName === opt.displayName);
              return (
                <button
                  key={opt.displayName}
                  type="button"
                  onClick={() => handlePickSoul(opt)}
                  disabled={submitting || already}
                  className={`min-h-9 rounded-full px-3 py-1.5 text-xs transition ${
                    already
                      ? "cursor-default bg-sage-100 text-ink-faint"
                      : "bg-blossom-100 text-ink-soft hover:bg-blossom-200"
                  }`}
                >
                  {already ? "✓ " : "＋ "}
                  {opt.displayName}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <label className={labelClass}>姓名（自行輸入新的乙位正魂）</label>
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
      {/* 陽上人（本戶固定陽上人一鍵加入＋手動新增；套用到新增的這筆） */}
      <div>
        <label className={labelClass}>陽上人（可多位）</label>
        <YangshangEditor
          value={addYangshang}
          onChange={setAddYangshang}
          householdMemberNames={[]}
          householdYangshangNames={householdYangshangNames}
          onAddToHouseholdYangshang={onAddToHouseholdYangshang}
        />
      </div>
      {/* 牌位地址（預設帶入家戶地址、可改；存 UniversalSalvationEntry.tabletAddress） */}
      <div>
        <label className={labelClass}>牌位地址</label>
        <input
          className={inputClass}
          value={tabletAddr}
          onChange={(e) => setTabletAddr(e.target.value)}
          placeholder="預設帶入家戶地址，可自由修改"
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
  entries,
  fixedDisplayName,
  onAdd,
  onRecordUpdated,
  existingNameOptions = [],
}: {
  entries: EntryJSON[];
  fixedDisplayName: string;
  onAdd: (payload: { displayName: string }) => Promise<RecordJSON>;
  onRecordUpdated: (record: RecordJSON) => void;
  /** V14.2：本戶既有冤親債主名稱（去重）；點選一鍵加入本次報名，不重複。 */
  existingNameOptions?: string[];
}) {
  const [quantity, setQuantity] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quantityInputRef = useRef<HTMLInputElement>(null);

  const parsedQuantity = Number(quantity);

  /** 點選本戶既有冤親債主 chip：加入一筆（不重複）。 */
  async function handlePickExisting(displayName: string) {
    if (submitting) return;
    if (entries.some((e) => e.displayName === displayName)) return;
    setSubmitting(true);
    setError(null);
    try {
      const record = await onAdd({ displayName });
      onRecordUpdated(record);
    } catch (err) {
      setError(err instanceof Error ? err.message : "網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

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
      {/* 本戶既有冤親債主（點選一鍵加入；已加入標示 ✓ 不重複、跨年份去重成一項） */}
      {existingNameOptions.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-ink-faint">本戶既有冤親債主（點選直接加入）</p>
          <div className="flex flex-wrap gap-1.5">
            {existingNameOptions.map((nm) => {
              const already = entries.some((e) => e.displayName === nm);
              return (
                <button
                  key={nm}
                  type="button"
                  onClick={() => handlePickExisting(nm)}
                  disabled={submitting || already}
                  className={`min-h-9 rounded-full px-3 py-1.5 text-xs transition ${
                    already
                      ? "cursor-default bg-sage-100 text-ink-faint"
                      : "bg-mist-100 text-ink-soft hover:bg-mist-200"
                  }`}
                >
                  {already ? "✓ " : "＋ "}
                  {nm}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
