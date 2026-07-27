import { listTempleEvents } from "@/lib/templeEvents";
import { canAcceptRegistration, type ActivityYearCandidate } from "@/lib/activityYear";
import RegistrationHomeScreen from "@/components/registration/RegistrationHomeScreen";

/**
 * V17「活動報名首頁」：工作人員「先選活動、再搜尋信眾／家戶」的共用入口。
 *
 * 與 /activities（活動管理）分工：這裡只列「目前可報名」的年度活動報名卡，
 * 每張卡直接提供「開始報名」，不需先進入活動管理頁再找報名按鈕。
 *
 * ⚠️ 一律沿用既有 TempleEvent／活動狀態／canAcceptRegistration，不寫死普渡或
 * 年度燈個別入口——任何由活動精靈建立且開放報名的活動都會自動出現。
 *
 * 動態渲染理由同其他即時營運頁（見 /activities）：資料即時、不做建置期快照。
 */
export const dynamic = "force-dynamic";

/**
 * V17.1：年度燈統一架構下，這四個 activityType 是「年度燈」主活動底下的**報名子項目**
 * （光明燈／太歲燈／全家燈／祭改），不是獨立主活動。/registration 只顯示主活動卡，
 * 因此把這四類（含資料庫可能殘留的舊版獨立燈別 TempleEvent）從活動卡列表排除，
 * 一律收斂進單一「年度燈（ANNUAL_LANTERN）」活動卡內顯示為可報名項目。
 *
 * ⚠️ 以 activityType（enum 值）判斷，不靠活動名稱硬寫死；與 ActivityListScreen 的
 * ANNUAL_LANTERN_MEMBERS 同一組定義。僅做畫面排除，不刪除／不修改任何正式活動資料。
 */
const ANNUAL_LANTERN_MEMBER_TYPES = new Set(["GUANGMING_LANTERN", "TAISUI_LANTERN", "FAMILY_LANTERN", "PURIFICATION"]);

export default async function RegistrationHomePage() {
  const events = await listTempleEvents();
  const now = new Date();

  // V17.1：先排除「年度燈子項目」的獨立活動（光明燈／太歲燈／全家燈／祭改），
  // 它們只會顯示在單一年度燈卡內，不得再以獨立活動卡出現。
  const mainEvents = events.filter((e) => !ANNUAL_LANTERN_MEMBER_TYPES.has(e.activityType as string));

  // 把每個 TempleEvent 映射成活動年度候選，套用既有 canAcceptRegistration 判斷是否開放。
  const rows = mainEvents.map((e) => {
    const candidate: ActivityYearCandidate = {
      templeEventId: e.id,
      activityType: e.activityType,
      year: e.year,
      name: e.name,
      registrationStartAt: e.registrationStartAt,
      registrationEndAt: e.registrationEndAt,
      eventDate: e.solarDate,
      isRegistrationOpen: e.isRegistrationOpen,
      isPrintOpen: e.isPrintOpen,
      isCompleted: e.isCompleted,
      isArchived: e.isArchived,
      status: e.status,
    };
    const decision = canAcceptRegistration(candidate, now);
    return {
      id: e.id,
      activityType: e.activityType as string,
      year: e.year,
      name: e.name,
      status: e.status as string,
      eventDate: e.solarDate ? e.solarDate.toISOString() : null,
      canRegister: decision.ok,
      reason: decision.reason,
    };
  });

  // V17.1：同一 activityType＋年度只保留一張卡（去重保險；正常一年一活動一筆）。
  const dedupeByTypeYear = <T extends { activityType: string; year: number }>(list: T[]): T[] => {
    const seen = new Set<string>();
    return list.filter((r) => {
      const key = `${r.activityType}::${r.year}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const openActivities = dedupeByTypeYear(rows.filter((r) => r.canRegister));
  const closedActivities = dedupeByTypeYear(rows.filter((r) => !r.canRegister));

  return (
    <div className="min-h-screen">
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
        <RegistrationHomeScreen openActivities={openActivities} closedActivities={closedActivities} />
      </main>
    </div>
  );
}
