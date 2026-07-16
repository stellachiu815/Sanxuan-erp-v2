"use client";

/**
 * V3.2「大量登記優化」：右上角的完成提示，取代 window.alert()。
 * 新增／修改／刪除成功後短暫顯示，2 秒後自動消失，不會擋住操作、
 * 也不需要行政人員手動關閉。
 */
export default function Toast({ visible, message = "已完成" }: { visible: boolean; message?: string }) {
  if (!visible) return null;

  return (
    <div
      className="fixed right-6 top-6 z-50 flex items-center gap-2 rounded-full bg-sage-100 px-5 py-2.5
                 text-sm text-ink shadow-pop transition-opacity"
      role="status"
      aria-live="polite"
    >
      <span>✓ {message}</span>
    </div>
  );
}
