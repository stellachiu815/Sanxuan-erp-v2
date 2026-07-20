import Link from "next/link";
import DevoteeQuickActions from "@/components/devotee/DevoteeQuickActions";
import DashboardOverviewCard from "@/components/dashboard/DashboardOverviewCard";
import OfferingHomeCard from "@/components/offering/OfferingHomeCard";
import CollectionHomeCard from "@/components/collection/CollectionHomeCard";
import ReceiptHomeCard from "@/components/receipt/ReceiptHomeCard";
import SystemCenterHomeCard from "@/components/system-center/SystemCenterHomeCard";
import DevoteeCenterHomeCard from "@/components/devotee/DevoteeCenterHomeCard";

export default async function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-16">
      <div className="text-center">
        <h1 className="text-3xl font-medium tracking-wide text-ink">台北三玄宮行政系統</h1>
        <p className="mt-2 text-sm text-ink-soft">
          搜尋姓名、電話、地址、家戶編號或戶名，或直接新增一位信眾
        </p>
      </div>
      {/*
        V12.2「信眾建立與查詢中心」指令「五、搜尋權限漏洞」＋「一」：
        搜尋與新增信眾是整套 ERP 最高頻的兩個操作，放在首頁最上方、所有
        模組卡片之前。搜尋 API 這次補上權限檢查，需要操作人身分，所以這一段
        改由 <DevoteeQuickActions/> 統一處理（內含 OperatorProvider）。
      */}
      <DevoteeQuickActions />
      <DashboardOverviewCard />
      {/*
        V12 指令「一、首頁與主要導覽順序」：信眾中心 → 收款中心 → 活動中心 →
        列印中心 → 供品中心 → 系統管理，信眾中心排在最前面、最顯眼的位置。

        誠實說明這裡的對應關係（非逐字規定，是本輪判斷，供之後檢視）：
        指令列出的六個名稱裡，「收款中心」「供品中心」「系統管理」跟既有
        HomeCard 元件（CollectionHomeCard／OfferingHomeCard／
        SystemCenterHomeCard）可以直接一一對應；但「活動中心」目前系統
        沒有對應的 HomeCard（宮務活動只有首頁下方文字連結 /activities，
        不是卡片），「列印中心」也沒有同名模組，這裡把它對應到既有的
        ReceiptHomeCard（收據中心——目前系統裡跟「列印」最相關的既有模組）。
        沒有新增或修改這兩個模組本身，只是把既有卡片排序；如果這個對應
        不是你要的意思，請告訴我，我再依你的指示調整順序或對應關係。
      */}
      <DevoteeCenterHomeCard />
      <CollectionHomeCard />
      <ReceiptHomeCard />
      <OfferingHomeCard />
      <SystemCenterHomeCard />
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Link href="/import" className="text-sm text-ink-faint underline-offset-4 hover:underline">
          家戶資料 Excel 批次匯入 →
        </Link>
        <Link href="/tools/birthday" className="text-sm text-ink-faint underline-offset-4 hover:underline">
          🎂 生日與農曆中心 →
        </Link>
        <Link href="/activities" className="text-sm text-ink-faint underline-offset-4 hover:underline">
          ➕ 建立宮務活動 →
        </Link>
        <Link href="/purification" className="text-sm text-ink-faint underline-offset-4 hover:underline">
          🧧 祭改管理 →
        </Link>
        <Link href="/templates" className="text-sm text-ink-faint underline-offset-4 hover:underline">
          📑 台北三玄宮模板中心 →
        </Link>
        <Link href="/offering-center" className="text-sm text-ink-faint underline-offset-4 hover:underline">
          🙏 供品認捐中心 →
        </Link>
        <Link href="/devotee-center" className="text-sm text-ink-faint underline-offset-4 hover:underline">
          💛 信眾關係中心 →
        </Link>
        <Link href="/collection-center" className="text-sm text-ink-faint underline-offset-4 hover:underline">
          💰 全宮共用收款中心 →
        </Link>
        <Link href="/receipt-center" className="text-sm text-ink-faint underline-offset-4 hover:underline">
          🧾 全宮共用收據中心 →
        </Link>
        <Link href="/system-center" className="text-sm text-ink-faint underline-offset-4 hover:underline">
          🛠️ 系統管理 →
        </Link>
        <Link
          href="/system/recycle-bin"
          className="text-sm text-ink-faint underline-offset-4 hover:underline"
        >
          🗑 回收區 →
        </Link>
        {/* V12.1「家戶管理中心」驗收修正輪：家戶管理（新增家戶／指定戶長／
            合併／拆分／轉移／封存）這次直接整合進「信眾名單」頁面，不是
            另一個獨立入口，所以這裡改成直接指向信眾名單，不調整上面既有
            連結的順序。 */}
        <Link href="/devotee-center/list" className="text-sm text-ink-faint underline-offset-4 hover:underline">
          🏠 家戶管理中心（信眾名單）→
        </Link>
      </div>
    </main>
  );
}
