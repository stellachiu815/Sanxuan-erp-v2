"use client";

import { evaluateDevoteeCompleteness, type DevoteeCompletenessInput } from "@/lib/devoteeDataQuality";

/**
 * V12.5「信眾資料完整化」指令二：資料完整度卡片。
 *
 * 全部填齊 → 顯示「★★★★★ 完整」；否則列出缺少的欄位，點一下捲到並聚焦
 * 對應的輸入框（欄位 id 由 src/lib/devoteeDataQuality.ts 的 anchor 提供，
 * 不在這裡另外維護一份對照表）。
 *
 * 指令七：手機版固定置頂——用 sticky top-0，捲動時仍看得到還缺什麼。
 */
export default function DevoteeCompletenessCard(props: DevoteeCompletenessInput) {
  const { items, filledCount, total, stars, isComplete } = evaluateDevoteeCompleteness(props);
  const missing = items.filter((i) => !i.filled);

  function jumpTo(anchor: string) {
    const el = document.getElementById(anchor);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // 聚焦讓行政人員可以直接開始打字；不是輸入元素時只做視覺提示。
    const focusable = el.matches("input, select, textarea")
      ? (el as HTMLElement)
      : el.querySelector<HTMLElement>("input, select, textarea");
    if (focusable) {
      window.setTimeout(() => focusable.focus({ preventScroll: true }), 300);
    }
    el.classList.add("ring-4", "ring-yolk-200");
    window.setTimeout(() => el.classList.remove("ring-4", "ring-yolk-200"), 1600);
  }

  return (
    <div
      className={`sticky top-0 z-20 rounded-3xl p-4 shadow-card backdrop-blur sm:static sm:p-5 ${
        isComplete ? "bg-sage-50/95" : "bg-yolk-50/95"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* yolk 色階只到 300（見 tailwind.config.ts），不可使用 yolk-500——
              那個 class 不存在，星星會沒有顏色。 */}
          <span className="text-base tracking-widest text-yolk-300" aria-hidden>
            {"★".repeat(stars)}
            <span className="text-ink-faint">{"☆".repeat(5 - stars)}</span>
          </span>
          <span className="text-sm text-ink">
            {isComplete ? "資料完整" : `資料完整度 ${filledCount}／${total}`}
          </span>
        </div>
        {!isComplete && (
          <span className="text-xs text-ink-faint">點欄位可直接跳到該處填寫</span>
        )}
      </div>

      {!isComplete && (
        <div className="mt-3">
          <p className="text-xs text-ink-soft">缺少：</p>
          <div className="mt-1.5 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap">
            {missing.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => jumpTo(m.anchor)}
                className="flex min-h-11 items-center gap-2 rounded-xl bg-white/80 px-3 py-2 text-left text-sm
                           text-ink-soft shadow-soft transition hover:bg-white hover:text-ink sm:min-h-0 sm:py-1.5"
              >
                <span aria-hidden>□</span>
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
