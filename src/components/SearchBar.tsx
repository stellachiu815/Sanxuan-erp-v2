"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useOperator } from "@/lib/operatorClient";
import { DEVOTEE_SEARCH_PLACEHOLDER } from "@/lib/devoteeSearchFields";

/**
 * 首頁／家戶頁的快速搜尋框。
 *
 * V12.2「信眾建立與查詢中心」的三項變更：
 *
 * 1. **帶上操作人身分（指令「五」）**：GET /api/search 這次補上了既有的
 *    信眾 view 權限檢查，這裡改用既有的 useOperator() 取得 operatorUserId
 *    一併送出。⚠️ 因此這個元件現在**必須**放在 <OperatorProvider> 內
 *    （首頁是 DevoteeQuickActions，家戶頁見該頁面的 Provider）。
 *    401／403 會直接把伺服器端的訊息顯示出來，不是只在前端隱藏。
 *
 * 2. **結果顯示足夠辨識資訊（指令「四」）**：原本每一列只有「姓名＋家戶
 *    編號」，同名信眾完全無法區分。現在顯示戶名、電話、地址摘要與生日。
 *
 * 3. **點擊信眾優先進信眾詳情頁（指令「四」）**：以往一律導向家戶頁。現在
 *    由 API 直接回傳 href——信眾結果進 /devotee-center/[memberId]，家戶
 *    結果才進 /household/[id]。
 *
 * 手機版（指令「八」）：輸入框與每一列結果都是 min-h-11 觸控尺寸，結果列
 * 採上下堆疊而非左右並排，小螢幕不需要水平捲動。
 */

type SearchResult = {
  kind: "DEVOTEE" | "HOUSEHOLD";
  memberId: string | null;
  householdId: string;
  name: string;
  householdName: string;
  phone: string | null;
  addressSummary: string | null;
  birthdayDisplay: string | null;
  href: string;
};

type Props = {
  /** hero：首頁大搜尋框；compact：家戶頁頂部固定搜尋框 */
  variant?: "hero" | "compact";
  placeholder?: string;
};

export default function SearchBar({
  variant = "hero",
  placeholder = DEVOTEE_SEARCH_PLACEHOLDER,
}: Props) {
  const router = useRouter();
  const { operatorUserId } = useOperator();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearched(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q });
        if (operatorUserId) params.set("operatorUserId", operatorUserId);
        const res = await fetch(`/api/search?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // 401／403 的訊息直接顯示伺服器端說明（例如「請先選擇目前操作
          // 人員」），比一句籠統的「搜尋失敗」有用。
          setError(data.error ?? "搜尋失敗，請稍後再試一次。");
          setResults([]);
          return;
        }
        setResults(data.results ?? []);
      } catch {
        setError("搜尋時發生錯誤，請稍後再試一次。");
      } finally {
        setLoading(false);
        setSearched(true);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, operatorUserId]);

  function goTo(result: SearchResult) {
    setFocused(false);
    setQuery("");
    setResults([]);
    // V6.0「信眾時間軸」：進家戶頁時把 memberId 一起帶上，家戶頁與之後的
    // 「歷年紀錄」連結會接力保留這個資訊。信眾結果直接進信眾詳情頁，不需要
    // 這個參數。
    if (result.kind === "HOUSEHOLD" && result.memberId) {
      router.push(`/household/${result.householdId}?member=${encodeURIComponent(result.memberId)}`);
      return;
    }
    router.push(result.href);
  }

  const showDropdown = variant === "compact" && focused && query.trim().length > 0;
  const showInlineList = variant === "hero" && query.trim().length > 0;

  const input = (
    <input
      type="text"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setTimeout(() => setFocused(false), 150)}
      placeholder={placeholder}
      autoFocus={variant === "hero"}
      className={
        variant === "hero"
          ? "min-h-11 w-full rounded-2xl border border-cream-300 bg-white/80 px-5 py-4 text-base text-ink " +
            "shadow-soft outline-none transition focus:border-mist-300 focus:ring-4 focus:ring-mist-100 " +
            "placeholder:text-ink-faint sm:px-6 sm:text-lg"
          : "min-h-11 w-full rounded-full border border-cream-300 bg-white/90 px-5 py-2.5 text-sm text-ink " +
            "shadow-soft outline-none transition focus:border-mist-300 focus:ring-4 focus:ring-mist-100 " +
            "placeholder:text-ink-faint"
      }
    />
  );

  function ResultList({ className = "" }: { className?: string }) {
    return (
      <ul className={`flex flex-col gap-2 ${className}`}>
        {results.map((r) => (
          <li key={`${r.kind}-${r.memberId ?? r.householdId}`}>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => goTo(r)}
              className="flex min-h-11 w-full flex-col gap-1 rounded-2xl bg-white/80 px-4 py-3 text-left
                         text-ink shadow-soft transition hover:bg-yolk-50 hover:shadow-card sm:px-5"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-base">{r.name}</span>
                <span className="rounded-full bg-cream-100 px-2.5 py-0.5 text-xs text-ink-soft">
                  {r.householdName}（{r.householdId}）
                </span>
                {r.kind === "HOUSEHOLD" && (
                  <span className="rounded-full bg-mist-100 px-2 py-0.5 text-xs text-ink-soft">家戶</span>
                )}
              </span>
              {/* 同名信眾靠這一行區分：電話／生日／地址 */}
              <span className="text-xs text-ink-faint">
                {[r.phone, r.birthdayDisplay, r.addressSummary].filter(Boolean).join("・") || "尚未填寫聯絡資料"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className={variant === "hero" ? "w-full max-w-xl" : "w-full max-w-md"}>
      <div className="relative">
        {input}

        {loading && (
          <span
            className={
              variant === "hero"
                ? "pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-sm text-ink-faint sm:right-6"
                : "pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-xs text-ink-faint"
            }
          >
            搜尋中…
          </span>
        )}

        {showDropdown && (
          <div className="absolute left-0 right-0 top-full z-20 mt-2 rounded-2xl bg-cream-50 p-2 shadow-pop">
            {error && <p className="px-3 py-2 text-sm text-ink-soft">{error}</p>}
            {!error && searched && !loading && results.length === 0 && (
              <p className="px-3 py-2 text-sm text-ink-soft">找不到符合的資料。</p>
            )}
            {results.length > 0 && <ResultList />}
          </div>
        )}
      </div>

      {variant === "hero" && error && (
        <p className="mt-4 rounded-xl bg-blossom-50 px-4 py-3 text-sm text-ink-soft">{error}</p>
      )}
      {variant === "hero" && searched && !loading && !error && results.length === 0 && (
        <p className="mt-4 rounded-xl bg-cream-200/60 px-4 py-3 text-sm text-ink-soft">
          找不到符合的資料，請確認輸入是否正確。
        </p>
      )}
      {showInlineList && results.length > 0 && <ResultList className="mt-4" />}
    </div>
  );
}
