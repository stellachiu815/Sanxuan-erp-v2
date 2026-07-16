"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SearchResult = {
  memberId: string | null;
  name: string;
  householdId: string;
};

type Props = {
  /** hero：首頁大搜尋框；compact：家戶頁頂部固定搜尋框 */
  variant?: "hero" | "compact";
  placeholder?: string;
};

export default function SearchBar({
  variant = "hero",
  placeholder = "搜尋姓名、電話、地址或家戶編號",
}: Props) {
  const router = useRouter();
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
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error("搜尋失敗");
        const data = await res.json();
        setResults(data.results ?? []);
      } catch {
        setError("搜尋時發生錯誤，請稍後再試一次。");
      } finally {
        setLoading(false);
        setSearched(true);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  function goTo(householdId: string, memberId: string | null) {
    setFocused(false);
    setQuery("");
    setResults([]);
    // V6.0「信眾時間軸」：搜尋到特定成員時，把 memberId 一起帶進網址，
    // 家戶頁跟之後的「歷年紀錄」連結會接力保留這個資訊，時間軸頁面才能
    // 預設切到這位成員的視角（見 timeline/page.tsx 的 initialMemberId）。
    const url = memberId
      ? `/household/${householdId}?member=${encodeURIComponent(memberId)}`
      : `/household/${householdId}`;
    router.push(url);
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
          ? "w-full rounded-2xl border border-cream-300 bg-white/80 px-6 py-4 text-lg text-ink " +
            "shadow-soft outline-none transition focus:border-mist-300 focus:ring-4 focus:ring-mist-100 " +
            "placeholder:text-ink-faint"
          : "w-full rounded-full border border-cream-300 bg-white/90 px-5 py-2.5 text-sm text-ink " +
            "shadow-soft outline-none transition focus:border-mist-300 focus:ring-4 focus:ring-mist-100 " +
            "placeholder:text-ink-faint"
      }
    />
  );

  function ResultList({ className = "" }: { className?: string }) {
    return (
      <ul className={`flex flex-col gap-2 ${className}`}>
        {results.map((r) => (
          <li key={`${r.householdId}-${r.memberId ?? r.name}`}>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => goTo(r.householdId, r.memberId)}
              className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white/80 px-5 py-3 text-left
                         text-ink shadow-soft transition hover:bg-yolk-50 hover:shadow-card"
            >
              <span className="text-base">{r.name}</span>
              <span className="rounded-full bg-cream-100 px-2.5 py-0.5 text-xs text-ink-soft">
                {r.householdId}
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
                ? "pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 text-sm text-ink-faint"
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
