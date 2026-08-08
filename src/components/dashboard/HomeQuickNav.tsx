import Link from "next/link";

/**
 * V15 首頁快捷入口（指令三「首頁快捷入口重新排列」）。
 *
 * 宮內最高頻操作固定順序，放在搜尋框正下方、資訊卡之前：
 *   信眾管理 → 新增信眾 → 收款管理 → 列印管理 → 活動管理 → 供品管理 → 系統管理。
 * 全部沿用既有路由，不新增任何模組或第二套路由；系統管理依權限顯示。
 * 「新增信眾」直接進信眾名單（既有新增家戶/信眾入口所在），不另開第二套建立流程。
 * V15R4 命名統一：對外一律「管理」（不再用「中心」）；路由維持既有英文路徑不變。
 */

type Entry = { href: string; icon: string; label: string; tone: string };

// V38：移除快捷入口裡重複的「新增信眾」（搜尋框下方已有大按鈕），不重複佔位。
const ENTRIES: Entry[] = [
  { href: "/devotee-center", icon: "🔍", label: "信眾管理", tone: "bg-sage-50 hover:bg-sage-100" },
  { href: "/collection-center", icon: "💰", label: "收款管理", tone: "bg-blossom-50 hover:bg-blossom-100" },
  { href: "/print-center", icon: "🖨️", label: "列印管理", tone: "bg-mist-50 hover:bg-mist-100" },
  { href: "/registration", icon: "📝", label: "活動報名", tone: "bg-yolk-50 hover:bg-yolk-100" },
  { href: "/activities", icon: "📅", label: "活動管理", tone: "bg-cream-200 hover:bg-cream-300" },
  { href: "/offering-center", icon: "🎁", label: "供品管理", tone: "bg-sage-50 hover:bg-sage-100" },
];

export default function HomeQuickNav({
  showSystemCenter,
  showFinance = false,
  financeReadOnly = false,
}: {
  showSystemCenter: boolean;
  showFinance?: boolean;
  financeReadOnly?: boolean;
}) {
  const entries: Entry[] = [...ENTRIES];
  // V38：財務中心放在「信眾管理」之後、「收款管理」之前（第 2 格；原本「新增信眾」的位置）。
  //   僅可查看財務者顯示：最高管理員完整／管理員唯讀。
  if (showFinance) entries.splice(1, 0, { href: "/finance-center", icon: "📒", label: financeReadOnly ? "財務中心（唯讀）" : "財務中心", tone: "bg-yolk-100 hover:bg-yolk-200" });
  if (showSystemCenter) entries.push({ href: "/system-center", icon: "⚙️", label: "系統管理", tone: "bg-cream-200 hover:bg-cream-300" });

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
