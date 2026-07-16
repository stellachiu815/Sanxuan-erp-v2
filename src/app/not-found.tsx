import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-lg text-ink">找不到這一戶資料。</p>
      <Link
        href="/"
        className="rounded-2xl bg-white/70 px-5 py-2 text-sm text-ink shadow-soft transition hover:bg-yolk-50"
      >
        ← 回搜尋
      </Link>
    </main>
  );
}
