import { Suspense } from "react";
import LoginContent from "./LoginContent";

/**
 * V14.3：登入頁外層。
 *
 * useSearchParams() 必須包在 Suspense 邊界內（Next.js 15 靜態預渲染要求），
 * 因此表單內容抽到 <LoginContent/>，這裡用 <Suspense> 包住並提供 fallback。
 * 不使用 dynamic="force-dynamic" 草率繞過；保留 next / session=expired 的
 * 導向與提示功能（都在 LoginContent 內以 useSearchParams 讀取）。
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Suspense
        fallback={
          <div className="w-full max-w-sm rounded-3xl bg-white/70 p-8 text-center shadow-card">
            <h1 className="text-center text-xl font-medium text-ink">台北三玄宮行政系統</h1>
            <p className="mt-4 text-sm text-ink-faint">載入中…</p>
          </div>
        }
      >
        <LoginContent />
      </Suspense>
    </main>
  );
}
