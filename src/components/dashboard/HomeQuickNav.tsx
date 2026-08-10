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

// V40 首頁精簡：拿掉重複的入口——信眾管理（上方已有搜尋＋新增信眾）、列印管理（下方「待列印」卡
// 點了就進列印中心，同一個）、活動報名（繞一圈也是進活動管理，重複）。其餘收成下方小標籤，不搶戲。
const ENTRIES: Entry[] = [
  { href: "/collection-center", icon: "💰", label: "收款管理", tone: "" },
  { href: "/activities", icon: "📅", label: "活動管理", tone: "" },
  { href: "/offering-center", icon: "🎁", label: "供品管理", tone: "" },
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
  if (showFinance) entries.push({ href: "/finance-center", icon: "📒", label: financeReadOnly ? "財務中心（唯讀）" : "財務中心", tone: "" });
  if (showSystemCenter) entries.push({ href: "/system-center", icon: "⚙️", label: "系統管理", tone: "" });

  return (
    <section className="w-full max-w-5xl">
      <p className="mb-2 text-xs tracking-[0.2em] text-ink-faint">其他中心</p>
      <div className="flex flex-wrap gap-2">
        {entries.map((e) => (
          <Link
            key={e.href}
            href={e.href}
            className="inline-flex items-center gap-1.5 rounded-full border border-cream-300 bg-cream-50 px-4 py-2 text-sm text-ink-soft transition hover:bg-cream-200"
          >
            <span aria-hidden>{e.icon}</span>
            {e.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
