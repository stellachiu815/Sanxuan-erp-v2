import BackButton from "@/components/navigation/BackButton";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import AcceptanceScanScreen from "@/components/system-center/AcceptanceScanScreen";

/**
 * V19「驗收／健康檢查中心」頁面。
 *
 * 權限：SUPER_ADMIN／ADMIN（runAcceptanceScan）。這裡不套 SystemCenterGate
 * （SystemCenterGate 屬 SUPER_ADMIN 專屬的完整選單），而是由 AcceptanceScanScreen
 * 依 canSystem(runAcceptanceScan) 顯示或擋下，且後端 API 亦以 Session 權限強制把關，
 * 讓 ADMIN 也能使用（與 AdminToolsSection 同一模式）。
 */
export default function AcceptancePage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <BackButton fallbackHref="/system-center" />
          <h1 className="text-sm text-ink-soft">🧪 驗收／健康檢查</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        <OperatorProvider>
          <OperatorBar />
          <AcceptanceScanScreen />
        </OperatorProvider>
      </main>
    </div>
  );
}
