import { listTemplates, seedOfficialTemplates } from "@/lib/templates";
import TemplateCenterScreen from "@/components/templates/TemplateCenterScreen";

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
