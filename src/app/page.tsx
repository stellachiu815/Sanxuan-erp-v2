import Link from "next/link";
import SearchBar from "@/components/SearchBar";
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
          搜尋姓名、電話、地址或家戶編號，開啟整戶資料
        </p>
      </div>
      <SearchBar variant="hero" />
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
      </div>
    </main>
  );
}
