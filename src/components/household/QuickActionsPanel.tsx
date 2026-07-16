"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AddMemberModal from "./AddMemberModal";
import EditHouseholdModal from "./EditHouseholdModal";
import AddWorshipModal from "./AddWorshipModal";
import Modal from "@/components/Modal";
import VersionHistoryPanel from "@/components/system/VersionHistoryPanel";

type ModalKind = "editHousehold" | "addMember" | "addWorship" | "versionHistory" | null;

type Props = {
  householdId: string;
  household: {
    contactName: string | null;
    phone: string | null;
    address: string | null;
    companyName: string | null;
    notes: string | null;
  };
  /** V6.0：從搜尋結果帶進來的成員 id（已在 page.tsx 驗證過屬於這一戶），
   *  帶進「歷年紀錄」連結，時間軸頁面才能預設切到這位成員視角。 */
  focusedMemberId?: string | null;
};

// 這三個目前只做畫面，還沒有接功能（依需求，之後才會一個一個做）。
// 「普渡」從 V3.0 起已經接上真正的登記畫面，不再放在這個清單裡。
const COMING_SOON_ACTIONS = [
  { icon: "🏮", label: "年度燈", tone: "bg-yolk-50" },
  { icon: "🎉", label: "宮慶", tone: "bg-sage-50" },
  { icon: "🖨", label: "補印", tone: "bg-mist-50" },
];

export default function QuickActionsPanel({ householdId, household, focusedMemberId }: Props) {
  const router = useRouter();
  const [openModal, setOpenModal] = useState<ModalKind>(null);

  function handleSuccess() {
    router.refresh();
  }

  const timelineUrl = focusedMemberId
    ? `/household/${householdId}/timeline?member=${encodeURIComponent(focusedMemberId)}`
    : `/household/${householdId}/timeline`;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => router.push(`/household/${householdId}/rituals/universal-salvation`)}
          className="flex flex-col items-center gap-2 rounded-2xl bg-blossom-50 px-4 py-5 text-center
                     shadow-soft transition hover:bg-blossom-100"
        >
          <span className="text-2xl">🙏</span>
          <span className="text-sm text-ink">普渡</span>
        </button>

        <button
          type="button"
          onClick={() => router.push(timelineUrl)}
          className="flex flex-col items-center gap-2 rounded-2xl bg-mist-50 px-4 py-5 text-center
                     shadow-soft transition hover:bg-mist-100"
        >
          <span className="text-2xl">📜</span>
          <span className="text-sm text-ink">歷年紀錄</span>
        </button>

        {COMING_SOON_ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            className={`flex flex-col items-center gap-2 rounded-2xl px-4 py-5 text-center shadow-soft transition ${action.tone}`}
          >
            <span className="text-2xl">{action.icon}</span>
            <span className="text-sm text-ink">{action.label}</span>
          </button>
        ))}

        <button
          type="button"
          onClick={() => setOpenModal("editHousehold")}
          className="flex flex-col items-center gap-2 rounded-2xl bg-cream-200/70 px-4 py-5 text-center
                     shadow-soft transition hover:bg-cream-300/70"
        >
          <span className="text-2xl">✏️</span>
          <span className="text-sm text-ink">修改資料</span>
        </button>

        <button
          type="button"
          onClick={() => setOpenModal("addMember")}
          className="flex flex-col items-center gap-2 rounded-2xl bg-sage-50 px-4 py-5 text-center
                     shadow-soft transition hover:bg-sage-100"
        >
          <span className="text-2xl">➕</span>
          <span className="text-sm text-ink">新增家人</span>
        </button>

        <button
          type="button"
          onClick={() => setOpenModal("addWorship")}
          className="flex flex-col items-center gap-2 rounded-2xl bg-blossom-50 px-4 py-5 text-center
                     shadow-soft transition hover:bg-blossom-100"
        >
          <span className="text-2xl">➕</span>
          <span className="text-sm text-ink">新增祭祀資料</span>
        </button>

        {/* V8.0「資料版本紀錄」：查看這個家戶資料本身的修改歷史（不含成員/
            普渡登記，那兩個目前只能各自查看，見對應畫面）。 */}
        <button
          type="button"
          onClick={() => setOpenModal("versionHistory")}
          className="flex flex-col items-center gap-2 rounded-2xl bg-yolk-50 px-4 py-5 text-center
                     shadow-soft transition hover:bg-yolk-100"
        >
          <span className="text-2xl">🕘</span>
          <span className="text-sm text-ink">修改紀錄</span>
        </button>
      </div>

      {openModal === "editHousehold" && (
        <EditHouseholdModal
          householdId={householdId}
          initial={household}
          onClose={() => setOpenModal(null)}
          onSuccess={handleSuccess}
        />
      )}
      {openModal === "addMember" && (
        <AddMemberModal
          householdId={householdId}
          onClose={() => setOpenModal(null)}
          onSuccess={handleSuccess}
        />
      )}
      {openModal === "addWorship" && (
        <AddWorshipModal
          householdId={householdId}
          onClose={() => setOpenModal(null)}
          onSuccess={handleSuccess}
        />
      )}
      {openModal === "versionHistory" && (
        <Modal title="修改紀錄" onClose={() => setOpenModal(null)}>
          <VersionHistoryPanel
            entityType="Household"
            entityId={householdId}
            title={`家戶資料（${householdId}）`}
          />
        </Modal>
      )}
    </>
  );
}
