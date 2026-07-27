import Link from "next/link";

/**
 * V18「活動整合導覽」：把一個活動（TempleEvent）的完整生命週期串成單一導覽面板，
 * 讓行政人員不必在各中心之間手動切換、重新篩選年度。
 *
 * 生命週期：
 *   活動精靈建立活動 → TempleEvent／年度設定 → 報名項目與計價
 *   → 信眾／家戶頁選活動報名 → RitualRecord／Participant／RegistrationItem
 *   → 活動專屬明細 → 產生應收 → 手動確認已收 → 實收／交易／收據
 *   → 帳本／年度財務 → 列印管理 → 單筆／補印 → 活動總名單 → 截止/完成/封存後查詢
 *
 * ⚠️ 一律「沿用既有模組」，只做導覽串接：
 *   - 報名：/registration（V17 活動報名首頁）
 *   - 收款／實收／交易／收據／帳本：/collection-center（既有全宮收款中心，數字仍以該處為準）
 *   - 列印管理／單筆／補印：普渡＝既有普渡列印中心；其餘＝各報名項目總名單（V15R8 列印中心）
 *   - 活動總名單：/print-center/rosters/[itemKey]/[year]（既有 buildItemRoster）
 *   - Excel 匯入：普渡既有匯入頁
 * 不新增第二套活動／報名／收款／列印資料，不做新的財務計算，不改動任何資料。
 * 封存／完成／結案的活動一樣渲染此面板（供查詢與補印用途）。
 */

type FlowItem = { key: string; name: string };

const cardClass =
  "flex items-center justify-between gap-3 rounded-2xl bg-white/80 px-4 py-3 text-sm text-ink-soft shadow-soft transition hover:bg-white";

function isClosedStatus(status: string, isArchived: boolean, isCompleted: boolean): boolean {
  return isArchived || isCompleted || status === "CLOSED" || status === "CANCELLED";
}

export default function ActivityFlowHub({
  templeEventId: _templeEventId,
  year,
  activityType,
  activityName,
  status,
  isArchived,
  isCompleted,
  items,
}: {
  templeEventId: string;
  year: number;
  activityType: string;
  activityName: string;
  status: string;
  isArchived: boolean;
  isCompleted: boolean;
  /** 這個活動底下的報名項目（供活動總名單逐項連結；來源＝REGISTRATION_ITEM_SEED）。 */
  items: FlowItem[];
}) {
  const isUniversalSalvation = activityType === "UNIVERSAL_SALVATION";
  const closed = isClosedStatus(status, isArchived, isCompleted);
  // 列印管理入口：普渡沿用既有普渡列印中心；其餘活動導向該活動第一個報名項目的總名單（V15R8 列印中心）。
  const printHref = isUniversalSalvation
    ? `/universal-salvation/${year}/print-center`
    : items.length > 0
      ? `/print-center/rosters/${items[0].key}/${year}`
      : null;

  return (
    <section className="rounded-3xl bg-sage-50/70 p-6 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-medium text-ink">活動整合導覽</h2>
          <p className="mt-0.5 text-xs text-ink-faint">
            {activityName}・民國 {year} 年度 — 報名、收款、列印、總名單一站直達，不必逐一切換。
          </p>
        </div>
        {closed && (
          <span className="rounded-full bg-cream-200 px-3 py-1 text-xs text-ink-faint">
            此活動已{isArchived ? "封存" : isCompleted ? "完成" : "結案"}，以下為查詢與補印用途
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {/* ① 報名（沿用 V17 活動報名首頁 → 搜尋信眾／家戶） */}
        <Link href="/registration" className={cardClass}>
          <span>📝 開始報名（選信眾／家戶）</span>
          <span aria-hidden>→</span>
        </Link>

        {/* ② 收款 / 實收 / 交易 / 收據 / 帳本（沿用全宮收款中心，財務數字以該處為準） */}
        <Link href="/collection-center" className={cardClass}>
          <span>💰 收款管理（確認已收・收據・帳本）</span>
          <span aria-hidden>→</span>
        </Link>

        {/* ③ 列印管理 / 單筆 / 補印 */}
        {printHref && (
          <Link href={printHref} className={cardClass}>
            <span>🖨 列印管理（單筆／補印）</span>
            <span aria-hidden>→</span>
          </Link>
        )}

        {/* ④ Excel 匯入（目前僅普渡沿用既有匯入頁） */}
        {isUniversalSalvation && (
          <Link href={`/universal-salvation/${year}/import`} className={cardClass}>
            <span>📥 Excel 匯入報名（上傳→預檢→草稿→確認）</span>
            <span aria-hidden>→</span>
          </Link>
        )}
      </div>

      {/* ⑤ 活動總名單：逐一報名項目的名單（列印／補印／截止封存後查詢皆用同一份） */}
      {items.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-ink-soft">活動總名單（依報名項目）</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {items.map((it) => (
              <Link
                key={it.key}
                href={`/print-center/rosters/${it.key}/${year}`}
                className="rounded-full bg-white/80 px-3 py-1.5 text-xs text-ink-soft shadow-soft transition hover:bg-white"
              >
                📋 {it.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
