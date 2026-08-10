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

// V40 首頁：拿掉重複的入口——信眾管理（上方已有搜尋＋新增信眾）、列印管理（下方「待列印」卡即進列印中心）、
// 活動報名（繞一圈也是進活動管理）。其餘中心做成與「現場最常用」同款的彩色卡片。
const ENTRIES: Entry[] = [
  { href: "/collection-center", icon: "💰", label: "收款管理", tone: "bg-blossom-75" },
  { href: "/receipt-center", icon: "🧾", label: "收據管理", tone: "bg-lilac-75" },
  { href: "/print-center", icon: "🖨️", label: "列印管理", tone: "bg-mist-75" },
  { href: "/activities", icon: "📅", label: "活動管理", tone: "bg-apricot-75" },
  { href: "/offering-center", icon: "🎁", label: "供品管理", tone: "bg-sage-75" },
  { href: "/devotee-center/list", icon: "🏠", label: "家戶管理", tone: "bg-apricot-75" },
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
  if (showFinance) entries.push({ href: "/finance-center", icon: "📒", label: financeReadOnly ? "財務中心（唯讀）" : "財務中心", tone: "bg-yolk-75" });
  if (showSystemCenter) entries.push({ href: "/system-center", icon: "⚙️", label: "系統管理", tone: "bg-cream-150" });

  return (
    <section className="w-full max-w-5xl">
      <h2 className="mb-3 text-base font-medium text-ink">🏛️ 其他中心</h2>
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
