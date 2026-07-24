import Link from "next/link";

/**
 * V15 首頁快捷入口（指令三「首頁快捷入口重新排列」）。
 *
 * 宮內最高頻操作固定順序，放在搜尋框正下方、資訊卡之前：
 *   信眾中心 → 新增信眾 → 收款中心 → 列印中心 → 活動中心 → 供品中心 → 系統管理。
 * 全部沿用既有路由，不新增任何模組或第二套路由；系統管理依權限顯示。
 * 「新增信眾」直接進信眾名單（既有新增家戶/信眾入口所在），不另開第二套建立流程。
 */

type Entry = { href: string; icon: string; label: string; tone: string };

const ENTRIES: Entry[] = [
  { href: "/devotee-center", icon: "🔍", label: "信眾中心", tone: "bg-sage-50 hover:bg-sage-100" },
  { href: "/devotee-center/list", icon: "➕", label: "新增信眾", tone: "bg-yolk-50 hover:bg-yolk-100" },
  { href: "/collection-center", icon: "💰", label: "收款中心", tone: "bg-blossom-50 hover:bg-blossom-100" },
  { href: "/print-center", icon: "🖨️", label: "列印中心", tone: "bg-mist-50 hover:bg-mist-100" },
  { href: "/activities", icon: "📅", label: "活動中心", tone: "bg-cream-200 hover:bg-cream-300" },
  { href: "/offering-center", icon: "🎁", label: "供品中心", tone: "bg-sage-50 hover:bg-sage-100" },
];

export default function HomeQuickNav({ showSystemCenter }: { showSystemCenter: boolean }) {
  const entries = showSystemCenter
    ? [...ENTRIES, { href: "/system-center", icon: "⚙️", label: "系統管理", tone: "bg-cream-200 hover:bg-cream-300" }]
    : ENTRIES;

  return (
    <section className="w-full max-w-5xl">
      <h2 className="mb-3 text-base font-medium text-ink">快捷入口</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {entries.map((e) => (
          <Link
            key={e.href}
            href={e.href}
            className={`flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-3xl ${e.tone} p-4 text-center shadow-card transition hover:shadow-pop`}
          >
            <span className="text-2xl" aria-hidden>{e.icon}</span>
            <span className="text-sm font-medium text-ink">{e.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
