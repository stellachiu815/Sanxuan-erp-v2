import { getPublicFormBySlug } from "@/lib/publicReg";
import { prisma } from "@/lib/prisma";
import PublicRegForm from "@/components/public/PublicRegForm";
import RosterRegisterForm from "@/components/registration/RosterRegisterForm";

/**
 * 信眾公開報名頁 /join/[slug]（免登入，中介層已放行）。
 * 只收資料進「待確認」，不建正式資料。
 * 依活動類型分流：名單型（補庫/宮燈）→ 名單型公開表單；其餘（普渡）→ 既有 PublicRegForm。
 */
export const dynamic = "force-dynamic";

const ROSTER_ACTIVITY_TYPES = new Set<string>(["STORAGE_REPAYMENT"]);

export default async function PublicJoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug);
  const form = await getPublicFormBySlug(decodedSlug);

  if (!form) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="text-lg text-ink">找不到這個報名網址</h1>
        <p className="mt-2 text-sm text-ink-soft">連結可能已停用或輸入錯誤，請向宮方確認。</p>
      </main>
    );
  }

  // 名單型活動（補庫/宮燈）→ 名單型公開表單。
  const ev = await prisma.templeEvent.findUnique({ where: { id: form.templeEventId }, select: { activityType: true } });
  if (ev && ROSTER_ACTIVITY_TYPES.has(ev.activityType)) {
    return (
      <main className="mx-auto max-w-xl px-4 py-8">
        <RosterRegisterForm templeEventId={form.templeEventId} activityName={form.activityName} publicSlug={decodedSlug} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <PublicRegForm form={form} />
    </main>
  );
}
