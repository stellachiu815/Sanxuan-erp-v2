import Link from "next/link";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import SystemCenterGate from "@/components/system-center/SystemCenterGate";
import BackupLogScreen from "@/components/system-center/BackupLogScreen";

export default function BackupLogPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <Link href="/system-center" className="text-sm text-ink-soft hover:underline">
            ← 系統管理
          </Link>
          <h1 className="text-sm text-ink-soft">📜 系統Log</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
        <OperatorProvider>
          <OperatorBar />
          <SystemCenterGate>
            <BackupLogScreen />
          </SystemCenterGate>
        </OperatorProvider>
      </main>
    </div>
  );
}
