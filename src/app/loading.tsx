/**
 * V24 效能：全站 route-level 載入骨架。
 *
 * App Router 會在「導覽目標的 Server Component 還在伺服器端查詢時」立即顯示這個
 * loading 畫面，讓使用者一點擊就有反應（不再出現「整頁沒動、以為沒按到」而重複點擊）。
 * 這只是過場骨架，不查任何資料、不影響權限與資料正確性；實際內容 ready 後即取代。
 * 沒有自訂 loading.tsx 的子路由會自動沿用這一份。
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 h-8 w-56 animate-pulse rounded-full bg-cream-100" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-3xl bg-cream-100" />
        ))}
      </div>
      <p className="mt-6 text-center text-sm text-ink-faint">載入中…</p>
    </main>
  );
}
