"use client";

/**
 * V14.2：累世冤親債主「納入成員」的**共用**挑選器（信眾入口與家戶入口共用同一元件）。
 *
 * 每位勾選成員各建一筆 US_YUANQIN（分別列印／取消／收款）。預設值由呼叫端決定：
 * 信眾入口預設只本人、家戶入口預設全戶。已刪除成員一律不出現（呼叫端已過濾）。
 */

export type PickerMember = { id: string; name: string; isDeceased?: boolean };

export default function DebtCreditorMemberPicker({
  members,
  selectedIds,
  onToggle,
  onAll,
  onSelf,
  disabled = false,
}: {
  members: PickerMember[];
  selectedIds: Record<string, boolean>;
  onToggle: (id: string) => void;
  onAll: () => void;
  /** 提供時顯示「只本人」（信眾入口）。家戶入口不提供。 */
  onSelf?: () => void;
  disabled?: boolean;
}) {
  const count = Object.values(selectedIds).filter(Boolean).length;
  return (
    <div className="rounded-xl bg-white/70 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-soft">納入成員（每位各一筆）</span>
        <button
          type="button"
          onClick={onAll}
          disabled={disabled}
          className="rounded-full bg-sage-100 px-3 py-1 text-xs text-ink hover:bg-sage-200 disabled:opacity-50"
        >
          全戶加入
        </button>
        {onSelf && (
          <button
            type="button"
            onClick={onSelf}
            disabled={disabled}
            className="rounded-full bg-cream-100 px-3 py-1 text-xs text-ink-soft hover:bg-cream-200 disabled:opacity-50"
          >
            只本人
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {members.map((m) => {
          const checked = Boolean(selectedIds[m.id]);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onToggle(m.id)}
              disabled={disabled}
              className={`min-h-8 rounded-full px-3 py-1 text-xs transition disabled:opacity-50 ${
                checked ? "bg-mist-200 text-ink" : "bg-cream-100 text-ink-soft hover:bg-cream-200"
              }`}
            >
              {checked ? "✓ " : "＋ "}
              {m.name}
              {m.isDeceased && "（歿）"}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-ink-faint">
        已選 {count} 位；已加入本次報名者不會重複建立。
      </p>
    </div>
  );
}
