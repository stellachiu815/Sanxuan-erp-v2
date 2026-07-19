import Link from "next/link";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import SystemCenterGate from "@/components/system-center/SystemCenterGate";
import ImportPendingList from "@/components/import/ImportPendingList";

/**
 * V11.3 補上原本沒有的權限管控。這一頁原本是直接在伺服器端 await prisma
 * 查詢的 Server Component——那樣的話，就算外面包一層畫面守門，資料在
 * 使用者「打開頁面的當下」就已經送到瀏覽器了，等於沒有真正管控。改成跟
 * 系統管理中心其餘頁面一樣的模式：頁面本身只是外框，實際資料透過已經
 * 補上 assertSystemPermissionForOperator 檢查的 API 由 Client Component
 * 抓取（見 ImportPendingList.tsx／GET /api/import/pending）。畫面內容跟
 * 原本完全一致，只是資料來源换成 client-side fetch。
 */
export default function ImportPendingPage() {
  return (
    <div className="min-h-screen">
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-medium text-ink">匯入待確認清單</h1>
          <Link href="/import" className="text-sm text-ink-soft underline-offset-4 hover:underline">
            ← 回批次匯入
          </Link>
        </div>
        <p className="text-sm text-ink-faint">
          以下是曾經上傳、但家戶編號跟現有資料庫衝突而沒有被匯入的資料列（唯讀）。
          這一版暫時不提供覆蓋或合併功能，需要人工比對後，用「修改家戶／新增家人」個別處理。
        </p>

        <OperatorProvider>
          <OperatorBar />
          <SystemCenterGate>
            <ImportPendingList />
          </SystemCenterGate>
        </OperatorProvider>
      </main>
    </div>
  );
}
