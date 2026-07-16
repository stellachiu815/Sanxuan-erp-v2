import Link from "next/link";
import SearchBar from "@/components/SearchBar";
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
      <OfferingHomeCard />
      <CollectionHomeCard />
      <ReceiptHomeCard />
      <DevoteeCenterHomeCard />
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
