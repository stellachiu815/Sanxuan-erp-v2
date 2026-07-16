import { listTempleEvents } from "@/lib/templeEvents";
import ActivityListScreen from "@/components/activities/ActivityListScreen";

export default async function ActivitiesPage() {
  const events = await listTempleEvents();

  return (
    <div className="min-h-screen">
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
        <ActivityListScreen
          initialEvents={events.map((e) => ({
            id: e.id,
            activityType: e.activityType,
            year: e.year,
            name: e.name,
            status: e.status,
          }))}
        />
      </main>
    </div>
  );
}
