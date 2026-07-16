import Link from "next/link";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import SystemCenterGate from "@/components/system-center/SystemCenterGate";
import VersionScreen from "@/components/system-center/VersionScreen";

export default function VersionPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          <Link href="/system-center" className="text-sm text-ink-soft hover:underline">
            ← 系統管理
          </Link>
          <h1 className="text-sm text-ink-soft">🏷️ 系統版本</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-10">
        <OperatorProvider>
          <OperatorBar />
          <SystemCenterGate>
            <VersionScreen />
          </SystemCenterGate>
        </OperatorProvider>
      </main>
    </div>
  );
}
