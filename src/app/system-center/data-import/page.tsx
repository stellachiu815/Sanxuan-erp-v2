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
            上傳正式家戶 Excel（固定七欄：家戶編號｜戶名｜主要聯絡人｜地址｜歷代祖先｜乙位正魂｜
            家戶成員，一列代表一戶），先做欄位對照與格式檢查，確認無誤後再匯入（單次最多處理 10 戶
            或 30 位家戶成員）。家戶編號已存在時會更新戶名／主要聯絡人／地址；家戶成員／歷代祖先／
            乙位正魂則依姓名比對，已存在的保留、不覆蓋、不刪除，只新增找不到的資料。
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
