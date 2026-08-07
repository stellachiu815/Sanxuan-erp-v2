import { getPublicFormBySlug } from "@/lib/publicReg";
import PublicRegForm from "@/components/public/PublicRegForm";

/**
 * V38 信眾公開報名頁 /join/[slug]（免登入，中介層已放行）。
 * 只收資料進「待確認」，不建正式牌位。
 */
export const dynamic = "force-dynamic";

export default async function PublicJoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = await getPublicFormBySlug(decodeURIComponent(slug));

  if (!form) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="text-lg text-ink">找不到這個報名網址</h1>
        <p className="mt-2 text-sm text-ink-soft">連結可能已停用或輸入錯誤，請向宮方確認。</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <PublicRegForm form={form} />
    </main>
  );
}
