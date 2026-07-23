"use client";

import { useState } from "react";

/**
 * V14.1：陽上人清單編輯器（超拔祖先／乙位正魂每筆牌位各一份）。
 *
 * 兩種來源可同時使用：
 *  A. 家戶成員快速加入（勾選；已加入顯示為已選；再次勾選不重複；取消只移除該名）
 *  B. 手動新增（任何姓名、不限信眾、可多位、可刪除、空白不加、去重）
 *
 * 儲存後只保存姓名陣列、保留順序、不分來源（由呼叫端送出 value）。
 * 手機：checkbox 與刪除鈕點擊區夠大，長姓名可換行。
 */
export default function YangshangEditor({
  value,
  onChange,
  householdMemberNames,
}: {
  value: string[];
  onChange: (names: string[]) => void;
  householdMemberNames: string[];
}) {
  const [manual, setManual] = useState("");

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

  return (
    <div className="flex flex-col gap-2">
      {/* A. 家戶成員快速加入 */}
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

      {/* 已加入清單（含家戶與手動，統一顯示，可個別移除） */}
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

      {/* B. 手動新增 */}
      <div className="flex gap-2">
        <input
          type="text"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addName(manual);
              setManual("");
            }
          }}
          placeholder="手動新增陽上人姓名"
          className="min-h-10 flex-1 rounded-xl border border-cream-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => {
            addName(manual);
            setManual("");
          }}
          className="min-h-10 rounded-full bg-sage-100 px-4 text-sm text-ink hover:bg-sage-200"
        >
          新增
        </button>
      </div>
    </div>
  );
}
