import Link from "next/link";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import SystemCenterGate from "@/components/system-center/SystemCenterGate";
import DevoteeImportWizard from "@/components/system-center/DevoteeImportWizard";

/**
 * V11.3「信眾資料匯入預檢中心」頁面（需求：入口必須放在系統管理中心）。
 *
 * 跟系統管理中心其餘子頁面（備份／還原／設定…）同一種頁面結構：
 * Server Component 只負責外框，實際內容全部是「先看操作人員身分，才透過
 * API 抓資料」的 Client Component（DevoteeImportWizard），避免還沒選操作
 * 人員的瀏覽器就能在 HTML 原始碼看到任何匯入資料。
 */
export default function DevoteeDataImportPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <Link href="/system-center" className="text-sm text-ink-soft hover:underline">
            ← 系統管理
          </Link>
          <h1 className="text-sm text-ink-soft">📥 信眾資料匯入</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-medium text-ink">信眾資料匯入預檢中心</h2>
          <p className="text-sm text-ink-faint">
            上傳舊系統匯出的 Excel／CSV 資料，先做欄位對照、格式檢查與疑似重複比對，
            確認無誤後再進行小規模測試匯入（單次最多 30 人或 10 戶）。這裡只會「新增」全新的
            家戶與信眾，不會覆蓋、合併或修改任何既有資料。
          </p>
        </div>

        <OperatorProvider>
          <OperatorBar />
          <SystemCenterGate>
            <DevoteeImportWizard />
          </SystemCenterGate>
        </OperatorProvider>
      </main>
    </div>
  );
}
