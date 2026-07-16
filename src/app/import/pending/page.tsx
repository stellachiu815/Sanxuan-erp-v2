import Link from "next/link";
import { prisma } from "@/lib/prisma";

// 這一頁會直接查資料庫，一定要在使用者真正打開頁面時才查（不能在 build 階段預先產生），
// 否則像 Render 這種平台在打包網站時通常還連不到正式資料庫，會導致部署失敗。
export const dynamic = "force-dynamic";

export default async function ImportPendingPage() {
  const rows = await prisma.importRow.findMany({
    where: { status: "DUPLICATE_PENDING" },
    include: { batch: { select: { fileName: true, createdAt: true } } },
    orderBy: [{ householdId: "asc" }, { rowNumber: "asc" }],
  });

  const householdIds = Array.from(new Set(rows.map((r) => r.householdId)));
  const existingHouseholds = householdIds.length
    ? await prisma.household.findMany({
        where: { id: { in: householdIds } },
        select: { id: true, name: true, contactName: true, phone: true, address: true },
      })
    : [];
  const existingById = new Map(existingHouseholds.map((h) => [h.id, h]));

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

        <div className="rounded-3xl bg-white/70 p-8 shadow-card">
          {rows.length === 0 ? (
            <p className="text-sm text-ink-faint">目前沒有待確認的匯入資料。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="text-xs text-ink-faint">
                    <th className="pb-2 pr-4">家戶編號</th>
                    <th className="pb-2 pr-4">Excel 內容（成員）</th>
                    <th className="pb-2 pr-4">資料庫既有家戶</th>
                    <th className="pb-2">來源檔案</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const existing = existingById.get(r.householdId);
                    const raw = r.rawData as Record<string, string>;
                    return (
                      <tr key={r.id} className="border-t border-cream-200 align-top">
                        <td className="py-2 pr-4 text-ink">{r.householdId}</td>
                        <td className="py-2 pr-4 text-ink-soft">
                          {raw["家戶成員姓名"]}（{raw["家戶名稱"]}）
                        </td>
                        <td className="py-2 pr-4 text-ink-soft">
                          {existing ? `${existing.name}（${existing.contactName ?? "無聯絡人"}）` : "（找不到，可能已被處理）"}
                        </td>
                        <td className="py-2 text-ink-faint">
                          {r.batch.fileName} · {new Date(r.batch.createdAt).toLocaleString("zh-TW")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
