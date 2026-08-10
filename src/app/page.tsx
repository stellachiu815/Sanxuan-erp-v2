import Link from "next/link";
import { Suspense } from "react";
import DevoteeQuickActions from "@/components/devotee/DevoteeQuickActions";
import HomeQuickNav from "@/components/dashboard/HomeQuickNav";
import HomeInSeasonRosterRegister from "@/components/dashboard/HomeInSeasonRosterRegister";
import PrintPendingCard from "@/components/dashboard/PrintPendingCard";
import DataCompletenessCard from "@/components/dashboard/DataCompletenessCard";
import DashboardErrorBoundary from "@/components/dashboard/DashboardErrorBoundary";
import DashboardOverviewCard from "@/components/dashboard/DashboardOverviewCard";
import OfferingHomeCard from "@/components/offering/OfferingHomeCard";
import ReceiptHomeCard from "@/components/receipt/ReceiptHomeCard";
import SystemCenterHomeCard from "@/components/system-center/SystemCenterHomeCard";
import DevoteeCenterHomeCard from "@/components/devotee/DevoteeCenterHomeCard";
import { getSessionUser } from "@/lib/auth";
import { canSystem, canFinance } from "@/lib/permissions";

/**
 * 這一頁在「每次請求」時即時查詢資料庫，不做建置期預渲染。
 *
 * 原因（V12.3 建置修正）：App Router 的頁面預設是靜態的——只要沒有用到
 * cookies()／headers()／searchParams 這類動態 API，Next.js 就會在
 * `next build` 階段直接執行這個 Server Component 並把結果存成靜態 HTML。
 * 本頁的資料來自直接呼叫 Prisma（不是 fetch，所以也沒有 fetch 層的快取
 * 標記可以讓 Next.js 判斷「這是動態資料」），因此會發生兩個問題：
 *
 *   1. 建置階段會去連線正式資料庫。資料庫在建置當下不可達（例如在本機
 *      build、或 Render 資料庫短暫離線）就會直接 build 失敗（Prisma P1001）。
 *   2. 更嚴重的是就算建置成功，這一頁也會被凍結成建置當下的快照，
 *      之後行政人員看到的數字不會更新，要等下一次部署才會變。
 *
 * 這一頁顯示的是即時營運資料，本來就不該被快取，所以明確標記為動態渲染。
 *
 * ⚠️ 這不會吞掉執行期的資料庫錯誤：請求當下若連不上資料庫，仍會照常拋出
 * 錯誤並顯示錯誤畫面，只是不再於建置階段連線。
 */
export const dynamic = "force-dynamic";

/** 首頁資訊卡串流時的過場骨架（不查資料，僅視覺占位）。 */
function HomeCardSkeleton() {
  return <section className="h-40 w-full max-w-5xl animate-pulse rounded-3xl bg-cream-100" />;
}

export default async function HomePage() {
  // V14.3：首頁受限入口依登入者角色顯示。一般模組（信眾／收款／活動／普渡／
  // 供品／模板／收據）維持所有已登入者可見（view 級）；「匯入」「系統管理」
  // 「回收區」屬管理層級，用共用 canSystem 判斷，不散落 role 字面值。
  const me = await getSessionUser();
  const role = me?.role ?? null;
  // V38（Stella 定案）：財務中心入口給「可查看財務者」＝最高管理員（完整）＋管理員（唯讀）。
  const showFinance = role ? canFinance(role, "view") : false;
  const financeReadOnly = role ? !canFinance(role, "createEntry") : true; // ADMIN 唯讀
  const showImport = role ? canSystem(role, "manageDataImport") : false;
  const showRecycleBin = role ? canSystem(role, "manageRecycleBin") : false;
  const showSystemCenter = role
    ? canSystem(role, "viewSystemCenter") ||
      canSystem(role, "manageUsers") ||
      canSystem(role, "manageDataImport") ||
      canSystem(role, "manageRecycleBin")
    : false;
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

      {/* V40 首頁「現場最常用」：色彩分區的快速動作，靠顏色直覺辨識。
          中元普渡（蜜桃）／年度燈（黃）／補庫（綠）／宮燈（藍）為動態依開放日期出現；
          開立感謝狀（粉）／生日與農曆（紫）／新增報名（米）固定。 */}
      <section className="w-full max-w-5xl">
        <p className="mb-2 text-xs tracking-[0.2em] text-ink-faint">現場最常用</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Link href="/quick-registration" className="flex min-h-[58px] items-center gap-2 rounded-2xl border border-apricot-200 bg-apricot-100 px-4 py-3 text-sm font-medium text-ink shadow-card transition hover:bg-apricot-200 hover:shadow-pop">
            <span className="text-lg" aria-hidden>🀄</span>快速報名·中元普渡
          </Link>
          {/* 補庫／宮燈／年度燈：依活動設定的開放日期自動出現（各自分色）。 */}
          <Suspense fallback={null}>
            <HomeInSeasonRosterRegister />
          </Suspense>
          <Link href="/receipt-center/quick" className="flex min-h-[58px] items-center gap-2 rounded-2xl border border-blossom-200 bg-blossom-100 px-4 py-3 text-sm font-medium text-ink shadow-card transition hover:bg-blossom-200 hover:shadow-pop">
            <span className="text-lg" aria-hidden>🧾</span>開立感謝狀
          </Link>
          <Link href="/tools/birthday" className="flex min-h-[58px] items-center gap-2 rounded-2xl border border-lilac-200 bg-lilac-100 px-4 py-3 text-sm font-medium text-ink shadow-card transition hover:bg-lilac-200 hover:shadow-pop">
            <span className="text-lg" aria-hidden>🎂</span>生日與農曆中心
          </Link>
          <Link href="/registration/new" className="flex min-h-[58px] items-center gap-2 rounded-2xl border border-cream-300 bg-cream-200 px-4 py-3 text-sm font-medium text-ink shadow-card transition hover:bg-cream-300 hover:shadow-pop">
            <span className="text-lg" aria-hidden>➕</span>新增活動報名
          </Link>
        </div>
      </section>

      {/* 其他中心（小標籤，不搶戲）：收款／活動管理／供品／財務／系統（依權限）。 */}
      <HomeQuickNav showSystemCenter={showSystemCenter} showFinance={showFinance} financeReadOnly={financeReadOnly} />


      {/*
        V15 指令三「首頁資料載入 lazy loading」：資訊卡（系統總覽）用 Suspense
        串流，讓搜尋框與快捷入口先出現，資訊卡稍後補上，避免首頁一次查全部而變卡。
        「待列印」卡再獨立以 client 端載入，不阻塞其他資訊卡。
      */}
      <DashboardErrorBoundary>
        <Suspense
          fallback={
            <section className="w-full max-w-5xl">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-40 animate-pulse rounded-3xl bg-cream-100" />
                ))}
              </div>
            </section>
          }
        >
          <DashboardOverviewCard />
        </Suspense>
      </DashboardErrorBoundary>

      {/* V15 指令三「待列印」＋ V15R3「資料待補」資訊卡（皆可點入對應頁）。 */}
      <section className="w-full max-w-5xl">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <PrintPendingCard />
          <DataCompletenessCard />
        </div>
      </section>
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
      {/*
        V24 效能：Collection／Receipt／Offering 是會查資料庫的 async Server Component。
        原本直接渲染會「阻塞」首頁 HTML（回首頁要等這三個摘要查完才顯示），是「回首頁很慢」
        的主因。改為各自包 Suspense 串流：首頁外殼與快捷入口先出現，三張卡稍後補上，
        不改任何查詢邏輯與資料正確性（沿用既有元件，不建第二套）。
      */}
      {/* V40 效能＋精簡：拿掉「收款摘要卡」——它的待收款／今日收款數字上方「系統總覽」已經有，
          原本等於同一次載入重複跑一次收款彙總重查詢。收款細節走上方「收款管理」入口即可。 */}
      <DevoteeCenterHomeCard />
      <Suspense fallback={<HomeCardSkeleton />}>
        <ReceiptHomeCard />
      </Suspense>
      <Suspense fallback={<HomeCardSkeleton />}>
        <OfferingHomeCard />
      </Suspense>
      <SystemCenterHomeCard />
      {/* V40：最底下原本一長排連結大多與上方卡片／標籤重複，整排拿掉；只留不重複的少數
          （匯入／祭改／模板／信眾名單／回收區），縮成一排安靜的小連結。 */}
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-2 text-ink-faint">
        {showImport && (
          <Link href="/system-center/data-import" className="text-xs underline-offset-4 hover:underline">家戶／信眾 Excel 匯入</Link>
        )}
        <Link href="/purification" className="text-xs underline-offset-4 hover:underline">祭改管理</Link>
        <Link href="/templates" className="text-xs underline-offset-4 hover:underline">模板中心</Link>
        <Link href="/devotee-center/list" className="text-xs underline-offset-4 hover:underline">家戶管理（信眾名單）</Link>
        {showRecycleBin && (
          <Link href="/system/recycle-bin" className="text-xs underline-offset-4 hover:underline">回收區</Link>
        )}
      </div>
    </main>
  );
}
