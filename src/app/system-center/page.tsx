import Link from "next/link";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import SystemCenterGate from "@/components/system-center/SystemCenterGate";

/**
 * 系統管理主選單。V11.2 原本是對應指令「一」的 7 個子項目；V11.3 新增
 * 「📥 信眾資料匯入」（信眾資料匯入預檢中心，第 8 個子項目，同樣要求
 * SUPER_ADMIN，見 SystemCenterGate 說明），既有 7 個子項目完全不變。
 *
 * 跟收據中心／收款中心不同：這裡每個項目彼此功能完全獨立（備份不等於
 * 還原、Google連線不等於健康檢查……），沒有「本質上是同一份查詢換個篩選
 * 條件」的重疊情況，所以維持獨立分頁，不做整合。
 *
 * 整個選單（含這一頁本身）只開放 SUPER_ADMIN，見 SystemCenterGate 的說明。
 */
export default function SystemCenterHomePage() {
  const tiles = [
    { href: "/system-center/backup", label: "💾 備份中心", desc: "立即備份、下載備份", color: "bg-sage-100 hover:bg-sage-200" },
    { href: "/system-center/restore", label: "♻️ 還原中心", desc: "瀏覽備份、一鍵還原", color: "bg-blossom-100 hover:bg-blossom-200" },
    { href: "/system-center/google-drive", label: "☁️ Google Drive連線", desc: "連結／解除／查看綁定帳號", color: "bg-mist-100 hover:bg-mist-200" },
    { href: "/system-center/version", label: "🏷️ 系統版本", desc: "目前版本、Migration紀錄", color: "bg-yolk-100 hover:bg-yolk-200" },
    { href: "/system-center/health", label: "🩺 系統健康檢查", desc: "資料庫、Google Drive、剩餘空間", color: "bg-cream-200 hover:bg-cream-300" },
    { href: "/system-center/logs", label: "📜 系統Log", desc: "備份紀錄：成功/失敗、執行者", color: "bg-sage-100 hover:bg-sage-200" },
    { href: "/system-center/settings", label: "⚙️ 系統設定", desc: "備份保留天數／週數", color: "bg-mist-100 hover:bg-mist-200" },
    { href: "/system-center/data-import", label: "📥 信眾資料匯入", desc: "欄位對照、預覽、疑似重複確認、小規模測試匯入", color: "bg-yolk-100 hover:bg-yolk-200" },
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <Link href="/" className="text-sm text-ink-soft hover:underline">
            ← 三玄宮行政系統
          </Link>
          <h1 className="text-sm text-ink-soft">🛠️ 系統管理</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-10">
        <OperatorProvider>
          <OperatorBar />
          <SystemCenterGate>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {tiles.map((t) => (
                <Link key={t.href} href={t.href} className={`rounded-3xl p-6 shadow-card transition ${t.color}`}>
                  <p className="text-base text-ink">{t.label}</p>
                  <p className="mt-1 text-xs text-ink-faint">{t.desc}</p>
                </Link>
              ))}
            </div>

            <div className="rounded-3xl bg-white/70 p-6 text-xs text-ink-faint shadow-soft">
              <p>
                ⚠️ 系統管理僅開放最高管理員（SUPER_ADMIN）使用，一般使用者（含一般管理員）看不到此選單，
                也無法透過直接呼叫 API 略過這層限制——所有備份/還原/連線相關 API 都會在伺服器端重新
                驗證目前操作人員的角色。
              </p>
            </div>
          </SystemCenterGate>
        </OperatorProvider>
      </main>
    </div>
  );
}
