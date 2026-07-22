import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import RegistrationEditor from "@/components/registration/RegistrationEditor";
import { resolveRegistrationFormType } from "@/lib/registrationFormTypes";

/**
 * V13.4：**全系統唯一的報名內容編輯器路由**。
 *
 * 網址：/registration/[ritualRecordId]
 *
 * ── 為什麼是獨立路由 ────────────────────────────────────────
 * 報名內容（普渡四類牌位、年度燈名單、成員管理）本身就是一整頁的份量，
 * 塞進信眾詳情頁的對話框在手機一定爆版。
 *
 * 這是**同一條報名流程的下一步**，不是要使用者回到別的入口重新建立：
 *   信眾詳情頁 → 選活動 → 選沿用/全新 → 建立報名 → 進到這裡填內容
 * 頁面上有「返回信眾資料」與「返回家戶」，隨時可回去。
 *
 * 家戶頁的普渡登記也導向這裡，確保只有一個編輯器、一套寫入 service。
 */
export const dynamic = "force-dynamic";

export default async function RegistrationEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ ritualRecordId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { ritualRecordId } = await params;
  const { from } = await searchParams;

  const record = await prisma.ritualRecord.findUnique({
    where: { id: ritualRecordId },
    include: {
      templeEvent: true,
      household: {
        include: {
          members: {
            where: { deletedAt: null },
            select: { id: true, name: true, role: true, isDeceased: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!record || record.deletedAt) notFound();

  const formResolution = resolveRegistrationFormType(record.templeEvent?.registrationFormType);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-4xl items-center gap-4">
          {from ? (
            <Link
              href={`/devotee-center/${from}`}
              className="whitespace-nowrap text-sm text-ink-soft transition hover:text-ink"
            >
              ← 返回信眾資料
            </Link>
          ) : (
            <Link
              href={`/household/${record.householdId}`}
              className="whitespace-nowrap text-sm text-ink-soft transition hover:text-ink"
            >
              ← 返回家戶
            </Link>
          )}
          <span className="truncate text-sm text-ink-faint">
            {record.household.name}・民國 {record.year} 年度
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <RegistrationEditor
          overview={{
            ritualRecordId: record.id,
            activityType: record.activityType,
            activityName: record.templeEvent?.name ?? `${record.year} 年度活動`,
            year: record.year,
            status: record.status,
            householdId: record.householdId,
            householdName: record.household.name,
            formType: formResolution.supported ? formResolution.formType : null,
            formSupported: formResolution.supported,
            formUnsupportedReason: formResolution.supported ? null : formResolution.reason,
            householdMembers: record.household.members,
            returnMemberId: from ?? null,
          }}
        />
      </main>
    </div>
  );
}
