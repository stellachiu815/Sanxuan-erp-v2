"use client";

/** V34 列印按鈕：Preview 與正式列印同一份 DOM，直接 window.print（不改任何資料）。 */
export default function V34PrintButton() {
  return (
    <button
      type="button"
      onClick={() => { if (typeof window !== "undefined") window.print(); }}
      style={{ borderRadius: 999, border: "1px solid #cfc8bb", background: "#e7efe4", padding: "6px 16px", fontSize: 14, cursor: "pointer" }}
    >
      🖨 列印
    </button>
  );
}
