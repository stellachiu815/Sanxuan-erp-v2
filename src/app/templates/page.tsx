import { listTemplates, seedOfficialTemplates } from "@/lib/templates";
import TemplateCenterScreen from "@/components/templates/TemplateCenterScreen";

/**
 * 這一頁在「每次請求」時即時查詢資料庫，不做建置期預渲染。
 *
 * 原因（V12.3 建置修正）：App Router 的頁面預設是靜態的——只要沒有用到
 * cookies()／headers()／searchParams 這類動態 API，Next.js 就會在
 * `next build` 階段直接執行這個 Server Component 並把結果存成靜態 HTML。
 * 本頁的資料來自直接呼叫 Prisma（不是 fetch，所以也沒有 fetch 層的快取
 * 標記可以讓 Next.js 判斷「這是動態資料」），因此會發生兩個問題：
 *
 *   1. 建置階段會去連線正式資料庫。資料庫在建置當下不可達（例如在本機
 *      build、或 Render 資料庫短暫離線）就會直接 build 失敗（Prisma P1001）。
 *   2. 更嚴重的是就算建置成功，這一頁也會被凍結成建置當下的快照，
 *      之後行政人員看到的數字不會更新，要等下一次部署才會變。
 *
 * 這一頁顯示的是即時營運資料，本來就不該被快取，所以明確標記為動態渲染。
 *
 * ⚠️ 這不會吞掉執行期的資料庫錯誤：請求當下若連不上資料庫，仍會照常拋出
 * 錯誤並顯示錯誤畫面，只是不再於建置階段連線。
 */
export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  // 每次進入模板中心都確保官方模板分類已經建立好（需求「六、七」：即使
  // 還沒有上傳原始檔，也先建立模板分類）。upsert 是安全的，重複呼叫不會
  // 產生重複資料。
  await seedOfficialTemplates();

  const templates = await listTemplates();

  return (
    <div className="min-h-screen">
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
        <h1 className="text-2xl font-medium text-ink">台北三玄宮模板中心</h1>
        <TemplateCenterScreen
          initialTemplates={templates.map((t) => ({
            id: t.id,
            category: t.category,
            key: t.key,
            name: t.name,
            activityType: t.activityType,
            versions: t.versions.map((v) => ({
              id: v.id,
              versionLabel: v.versionLabel,
              fileName: v.fileName,
              isActive: v.isActive,
              uploadedAt: v.uploadedAt ? v.uploadedAt.toISOString() : null,
              note: v.note,
            })),
          }))}
        />
      </main>
    </div>
  );
}
