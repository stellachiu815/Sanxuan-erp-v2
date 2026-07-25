"use client";

/**
 * V15R3：資料不完整預覽提示（沿用既有畫面，不建第二套預覽頁）。
 * 只在資料不完整（missingFields 有值）時顯示；本元件純顯示、不寫入任何資料。
 * 正式列印按鈕由呼叫端停用／或送出時被後端 422 阻擋。
 */
export default function IncompletePreviewBanner({ missingFields }: { missingFields: string[] }) {
  if (!missingFields || missingFields.length === 0) return null;
  return (
    <div className="rounded-2xl border border-blossom-300 bg-blossom-50 px-4 py-3 text-sm text-ink">
      <p className="font-medium">⚠ 本資料尚未完整</p>
      <p className="mt-0.5 text-xs text-ink-soft">本畫面僅供預覽，完成資料後才能正式列印。</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {missingFields.map((f) => (
          <span key={f} className="rounded-full bg-blossom-100 px-2 py-0.5 text-xs text-ink">⚠ 缺{f}</span>
        ))}
      </div>
    </div>
  );
}
