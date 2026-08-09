import { notFound } from "next/navigation";
import BackButton from "@/components/navigation/BackButton";
import { prisma } from "@/lib/prisma";
import RosterRegisterForm from "@/components/registration/RosterRegisterForm";

/**
 * 名單型（贊普型）現場快速報名頁——補庫／宮燈／年度燈共用。
 * 網址：/roster-register/[templeEventId]。
 */
export const dynamic = "force-dynamic";

export default async function RosterRegisterPage({ params }: { params: Promise<{ templeEventId: string }> }) {
  const { templeEventId } = await params;
  const ev = await prisma.templeEvent.findUnique({
    where: { id: templeEventId },
    select: { id: true, name: true, year: true },
  });
  if (!ev) notFound();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          <BackButton fallbackHref={`/activities/${templeEventId}`} className="whitespace-nowrap text-sm text-ink-soft transition hover:text-ink" />
          <span className="truncate text-sm text-ink-faint">{ev.name}・民國 {ev.year} 年度</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <RosterRegisterForm templeEventId={ev.id} activityName={ev.name} />
      </main>
    </div>
  );
}
