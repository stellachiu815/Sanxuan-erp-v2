"use client";

import { useState } from "react";

/**
 * V14.1／V14.2：陽上人清單編輯器（超拔祖先／乙位正魂每筆牌位各一份）。
 *
 * 三種來源可同時使用：
 *  A.【本戶固定陽上人】(V14.2) 每一戶自己的固定陽上人字庫（來源：Excel 匯入＋
 *     人工新增）。預設顯示、可一鍵加入本牌位，免得每年重打。
 *  B.【家戶成員】家戶成員快速加入（勾選；已加入顯示為已選；再次勾選移除該名）。
 *  C.【新增其他陽上人】手動輸入任何姓名。可選：
 *       「加入此牌位」──只加進這張牌位。
 *       「並存入本戶固定名單」──同時寫進本戶固定陽上人字庫（下次可一鍵帶入）。
 *
 * 儲存後只保存姓名陣列、保留順序、不分來源（由呼叫端送出 value）。去重：同一位
 * 陽上人在本牌位只會有一筆。手機：點擊區夠大，長姓名可換行。
 */
export default function YangshangEditor({
  value,
  onChange,
  householdMemberNames,
  householdYangshangNames = [],
  onAddToHouseholdYangshang,
}: {
  value: string[];
  onChange: (names: string[]) => void;
  householdMemberNames: string[];
  /** V14.2：本戶固定陽上人名單（一鍵加入來源）。 */
  householdYangshangNames?: string[];
  /**
   * V14.2：把某姓名存進本戶固定陽上人字庫（呼叫端負責 POST 並更新
   * householdYangshangNames）。未提供時不顯示「並存入本戶固定名單」。
   */
  onAddToHouseholdYangshang?: (name: string) => void | Promise<void>;
}) {
  const [manual, setManual] = useState("");
  const [savingToHousehold, setSavingToHousehold] = useState(false);

  function addName(raw: string) {
    const name = raw.trim();
    if (!name) return;
    if (value.includes(name)) return; // 去重、保留原順序
    onChange([...value, name]);
  }

  function removeName(name: string) {
    onChange(value.filter((n) => n !== name));
  }

  function toggleMember(name: string) {
    if (value.includes(name)) removeName(name);
    else addName(name);
  }

  async function addManual(alsoSaveToHousehold: boolean) {
    const name = manual.trim();
    if (!name) return;
    addName(name);
    if (alsoSaveToHousehold && onAddToHouseholdYangshang) {
      setSavingToHousehold(true);
      try {
        await onAddToHouseholdYangshang(name);
      } finally {
        setSavingToHousehold(false);
      }
    }
    setManual("");
  }

  return (
    <div className="flex flex-col gap-2">
      {/* A. 本戶固定陽上人（V14.2；預設顯示、一鍵加入） */}
      {householdYangshangNames.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-ink-faint">本戶固定陽上人（一鍵加入）</p>
          <div className="flex flex-wrap gap-1.5">
            {householdYangshangNames.map((name) => {
              const on = value.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleMember(name)}
                  className={`min-h-9 rounded-full px-3 py-1.5 text-xs transition ${
                    on ? "bg-sage-200 text-ink" : "bg-yolk-100 text-ink-soft hover:bg-butter-200"
                  }`}
                >
                  {on ? "✓ " : "＋ "}
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* B. 家戶成員快速加入 */}
      {householdMemberNames.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-ink-faint">家戶成員（勾選加入陽上人）</p>
          <div className="flex flex-wrap gap-1.5">
            {householdMemberNames.map((name) => {
              const on = value.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleMember(name)}
                  className={`min-h-9 rounded-full px-3 py-1.5 text-xs transition ${
                    on ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft hover:bg-cream-200"
                  }`}
                >
                  {on ? "✓ " : "＋ "}
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 已加入清單（含本戶固定／家戶／手動，統一顯示，可個別移除） */}
      <div>
        <p className="mb-1 text-xs text-ink-faint">陽上人（列印：{value.length > 0 ? `${value.join("、")}叩薦` : "（無）"}）</p>
        {value.length === 0 ? (
          <p className="text-xs text-ink-faint">尚未加入陽上人。</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {value.map((name) => (
              <span
                key={name}
                className="inline-flex min-h-9 items-center gap-1 rounded-full bg-mist-100 px-3 py-1.5 text-xs text-ink"
              >
                {name}
                <button
                  type="button"
                  onClick={() => removeName(name)}
                  aria-label={`移除 ${name}`}
                  className="ml-0.5 rounded-full px-1 text-ink-faint hover:bg-blossom-100 hover:text-ink"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* C. 新增其他陽上人（自由輸入） */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-ink-faint">新增其他陽上人</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addManual(false);
              }
            }}
            placeholder="輸入陽上人姓名"
            className="min-h-10 flex-1 rounded-xl border border-cream-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void addManual(false)}
            className="min-h-10 whitespace-nowrap rounded-full bg-sage-100 px-4 text-sm text-ink hover:bg-sage-200"
          >
            加入此牌位
          </button>
        </div>
        {onAddToHouseholdYangshang && (
          <button
            type="button"
            onClick={() => void addManual(true)}
            disabled={savingToHousehold || manual.trim() === ""}
            className="min-h-9 self-start rounded-full bg-yolk-100 px-4 text-xs text-ink-soft hover:bg-butter-200 disabled:opacity-50"
          >
            {savingToHousehold ? "儲存中…" : "＋ 加入此牌位並存入本戶固定名單"}
          </button>
        )}
      </div>
    </div>
  );
}
