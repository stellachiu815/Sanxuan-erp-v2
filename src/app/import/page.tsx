import { Suspense } from "react";
import Link from "next/link";
import SearchBar from "@/components/SearchBar";
import ImportUploader from "@/components/import/ImportUploader";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import SystemCenterGate from "@/components/system-center/SystemCenterGate";

/**
 * V11.3 補上這一頁原本完全沒有的權限管控（見 assertSystemPermissionForOperator
 * 於 4 支 /api/import/* API route 的呼叫，以及 manageDataImport 權限說明）：
 * 這裡跟系統管理中心其餘頁面同一種結構——只要求操作人員／SystemCenterGate
 * 通過，畫面才會顯示 ImportUploader；真正的安全防線在伺服器端每一支 API，
 * 就算有人知道網址直接呼叫 API 也會被拒絕。既有的上傳/驗證/確認匯入邏輯
 * 完全沒有變動。
 */
export default function ImportPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          <span className="whitespace-nowrap text-sm text-ink-soft">三玄宮行政系統</span>
          <SearchBar variant="compact" />
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-medium text-ink">家戶資料 Excel 批次匯入</h1>
          <Link href="/import/pending" className="text-sm text-ink-soft underline-offset-4 hover:underline">
            查看待確認清單 →
          </Link>
        </div>
        <p className="text-sm text-ink-faint">
          欄位需求：家戶編號、家戶名稱、主要聯絡人、電話、地址、公司名稱、家戶成員姓名、國曆生日、
          農曆生日、生肖、是否已辭世、歷代祖先、個人乙位正魂、陽上姓名、安奉位置、備註。
          家戶編號如果已經存在資料庫，不會覆蓋，會列為「待確認」。
        </p>
        <OperatorProvider>
          <OperatorBar />
          <SystemCenterGate>
            <Suspense fallback={<p className="text-sm text-ink-faint">載入中…</p>}>
              <ImportUploader />
            </Suspense>
          </SystemCenterGate>
        </OperatorProvider>
      </main>
    </div>
  );
}
