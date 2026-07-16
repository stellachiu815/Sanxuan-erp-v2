import Link from "next/link";
import { listBannedNumbers } from "@/lib/purification";
import BannedNumbersScreen from "@/components/purification/BannedNumbersScreen";

export default async function BannedNumbersPage() {
  const bannedNumbers = await listBannedNumbers();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          <Link href="/purification" className="text-sm text-ink-soft hover:underline">
            ← 祭改年度清單
          </Link>
          <h1 className="text-sm text-ink-soft">禁用編號設定</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-10">
        <div>
          <h2 className="text-2xl font-medium text-ink">額外禁用編號</h2>
          <p className="mt-1 text-sm text-ink-soft">
            系統已經預設擋下所有「包含連續 44」的號碼（44/144/244/344/440-449/1440
            等），不需要另外設定；這裡只管理管理者額外新增的禁用號碼。
          </p>
          <p className="mt-2 rounded-xl bg-yolk-50 px-4 py-2.5 text-xs text-ink-soft">
            ⚠ 這個設定頁只應該給管理者使用。系統目前沒有登入機制，暫時無法在後端擋下一般工作人員，
            請只把這個連結提供給有管理權限的人員。
          </p>
        </div>

        <BannedNumbersScreen
          initialBannedNumbers={bannedNumbers.map((b) => ({
            id: b.id,
            number: b.number,
            reason: b.reason,
            createdAt: b.createdAt.toISOString(),
          }))}
        />
      </main>
    </div>
  );
}
