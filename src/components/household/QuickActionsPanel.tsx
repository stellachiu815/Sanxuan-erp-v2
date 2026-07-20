"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AddMemberModal from "./AddMemberModal";
import EditHouseholdModal from "./EditHouseholdModal";
import WorshipRecordWizard from "./WorshipRecordWizard";
import AssignHeadModal from "./AssignHeadModal";
import ArchiveHouseholdDialog from "./ArchiveHouseholdDialog";
import MergeHouseholdWizard from "./MergeHouseholdWizard";
import SplitHouseholdWizard from "./SplitHouseholdWizard";
import TransferMembersWizard from "./TransferMembersWizard";
import Modal from "@/components/Modal";
import ConfirmDialog from "@/components/system/ConfirmDialog";
import VersionHistoryPanel from "@/components/system/VersionHistoryPanel";
import { OperatorProvider, useOperator } from "@/lib/operatorClient";
import { canDevotee } from "@/lib/permissions";
import OperatorBar from "@/components/system/OperatorBar";

type ModalKind =
  | "editHousehold"
  | "addMember"
  | "addWorship"
  | "versionHistory"
  | "assignHead"
  | "archiveHousehold"
  | "mergeHousehold"
  | "splitHousehold"
  | "transferMembers"
  | null;

type Props = {
  householdId: string;
  household: {
    name: string;
    contactName: string | null;
    phone: string | null;
    mobile: string | null;
    address: string | null;
    companyName: string | null;
    notes: string | null;
  };
  members: { id: string; name: string; role: string }[];
  worshipRecords: { id: string; type: "ANCESTOR_LINE" | "INDIVIDUAL"; displayName: string }[];
  /** V6.0：從搜尋結果帶進來的成員 id（已在 page.tsx 驗證過屬於這一戶），
   *  帶進「歷年紀錄」連結，時間軸頁面才能預設切到這位成員視角。 */
  focusedMemberId?: string | null;
};

// 這兩個目前只做畫面，還沒有接功能（依需求，之後才會一個一個做）。
// 「普渡」從 V3.0 起已經接上真正的登記畫面，「補印」從 V11.1 起已經接上
// 全宮共用收據中心的補印功能，都不再放在這個清單裡。
/**
 * V12.3 指令九：家戶調整（進階）區的動作定義。
 * 每一項的 warning 會出現在二次確認對話框裡，說明這個操作的實際影響。
 */
type AdvancedKind = "transferMembers" | "splitHousehold" | "mergeHousehold" | "changeCode" | "archiveHousehold";

const ADVANCED_ACTIONS: { kind: AdvancedKind; icon: string; label: string; hint: string; warning: string }[] = [
  {
    kind: "transferMembers",
    icon: "🔀",
    label: "轉移成員",
    hint: "把成員移到其他既有家戶",
    warning: "成員名下的收款、收據、供品認捐、爐主登錄與列印項目，會一併改掛到新家戶。",
  },
  {
    kind: "splitHousehold",
    icon: "✂️",
    label: "拆分家戶",
    hint: "把部分成員移出，另開新家戶",
    warning: "被移出的成員與其收款、收據、供品等紀錄會轉到新家戶；祭祀資料可選擇保留、移動或複製。",
  },
  {
    kind: "mergeHousehold",
    icon: "🔗",
    label: "合併家戶",
    hint: "把另一戶併入本戶",
    warning: "來源家戶會被封存並標記為已合併，之後不可再被操作。此動作不易復原。",
  },
  {
    kind: "changeCode",
    icon: "🔢",
    label: "修改家戶編號",
    hint: "更換這一戶的編號",
    warning: "舊編號會保留為歷史對照，Excel 匯入與搜尋仍可用舊編號找到本戶；舊編號不可再被其他家戶使用。",
  },
  {
    kind: "archiveHousehold",
    icon: "🗄",
    label: "封存家戶",
    hint: "把空家戶移入回收區",
    warning: "封存後會進入回收區，可還原；但該家戶編號不會釋出，不可被其他家戶重複使用。",
  },
];

const ADVANCED_ACTION_MAP = Object.fromEntries(ADVANCED_ACTIONS.map((a) => [a.kind, a])) as Record<
  AdvancedKind,
  (typeof ADVANCED_ACTIONS)[number]
>;

const COMING_SOON_ACTIONS = [
  { icon: "🏮", label: "年度燈", tone: "bg-yolk-50" },
  { icon: "🎉", label: "宮慶", tone: "bg-sage-50" },
];

/**
 * V12.1「家戶管理中心」擴充：這個面板原本沒有任何操作人員／權限概念
 * （修改資料/新增家人/新增祭祀資料都是任何人都能按），這次補上：
 * 1. 本地 <OperatorProvider>（呼應 src/components/devotee/
 *    DevoteeCenterHomeCard.tsx 的既有作法——根 layout 沒有全站掛載
 *    OperatorProvider，各自需要的元件樹要自己包一層）。
 * 2. <OperatorBar/> 讓使用者先選出自己是誰。
 * 3. 用 canDevotee(role, "updateProfile") 隱藏所有會修改資料的按鈕給
 *    READONLY 角色看（前端隱藏只是體驗優化，真正把關在各 API 的
 *    assertDevoteePermissionForOperator()）。
 *
 * V12.1 一次性修正指令「二之4」更新：AddMemberModal／AddWorshipModal 對應的
 * 兩支 API（POST /api/households/[id]/members、/worship）原本完全沒有權限
 * 檢查，這次已補上，因此這兩個 Modal 也改成用 useOperator() 帶
 * operatorUserId 送出——它們只會在這個面板（已包 OperatorProvider）底下、
 * 且 canManage 為真時開啟，所以一定拿得到操作人員身分。
 */
export default function QuickActionsPanel(props: Props) {
  return (
    <OperatorProvider>
      <QuickActionsPanelInner {...props} />
    </OperatorProvider>
  );
}

function QuickActionsPanelInner({ householdId, household, members, worshipRecords, focusedMemberId }: Props) {
  const router = useRouter();
  const { operatorUser } = useOperator();
  const [openModal, setOpenModal] = useState<ModalKind>(null);

  const canManage = operatorUser?.role ? canDevotee(operatorUser.role, "updateProfile") : false;
  /**
   * V12.3 指令四／九：進階區只要角色擁有任一項結構性權限就顯示。
   * STAFF 五項都沒有，整個進階區不會出現；真正的把關仍在各支 API。
   */
  const canAdjust = operatorUser?.role
    ? canDevotee(operatorUser.role, "mergeHousehold") ||
      canDevotee(operatorUser.role, "splitHousehold") ||
      canDevotee(operatorUser.role, "transferMember") ||
      canDevotee(operatorUser.role, "changeHouseholdCode") ||
      canDevotee(operatorUser.role, "archiveHousehold")
    : false;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pendingAdvanced, setPendingAdvanced] = useState<AdvancedKind | null>(null);
  const activeMemberCount = members.length;

  function handleSuccess() {
    router.refresh();
  }

  const timelineUrl = focusedMemberId
    ? `/household/${householdId}/timeline?member=${encodeURIComponent(focusedMemberId)}`
    : `/household/${householdId}/timeline`;

  return (
    <>
      <OperatorBar />

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

        {canManage && (
          <>
            <button
              type="button"
              onClick={() => setOpenModal("editHousehold")}
              className="flex min-h-24 flex-col items-center gap-2 rounded-2xl bg-cream-200/70 px-4 py-5 text-center
                         shadow-soft transition hover:bg-cream-300/70"
            >
              <span className="text-2xl">✏️</span>
              <span className="text-sm text-ink">修改資料</span>
            </button>

            <button
              type="button"
              onClick={() => setOpenModal("addMember")}
              className="flex min-h-24 flex-col items-center gap-2 rounded-2xl bg-sage-50 px-4 py-5 text-center
                         shadow-soft transition hover:bg-sage-100"
            >
              <span className="text-2xl">➕</span>
              <span className="text-sm text-ink">新增家人</span>
            </button>

            <button
              type="button"
              onClick={() => setOpenModal("addWorship")}
              className="flex min-h-24 flex-col items-center gap-2 rounded-2xl bg-blossom-50 px-4 py-5 text-center
                         shadow-soft transition hover:bg-blossom-100"
            >
              <span className="text-2xl">➕</span>
              <span className="text-sm text-ink">新增祭祀資料</span>
            </button>

            <button
              type="button"
              onClick={() => setOpenModal("assignHead")}
              className="flex min-h-24 flex-col items-center gap-2 rounded-2xl bg-yolk-50 px-4 py-5 text-center
                         shadow-soft transition hover:bg-yolk-100"
            >
              <span className="text-2xl">👑</span>
              <span className="text-sm text-ink">指定戶長／主要聯絡人</span>
            </button>
          </>
        )}

        {/* V8.0「資料版本紀錄」：查看這個家戶資料本身的修改歷史（不含成員/
            普渡登記，那兩個目前只能各自查看，見對應畫面）。這是查看功能，
            READONLY 也可以看，不受 canManage 限制。 */}
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

      {/*
        V12.3「家戶管理完整強化」指令九：家戶調整（進階）。

        在 V12.3 之前，「修改資料」跟「合併家戶／拆分家戶」是同一組 grid、
        同樣的圓角卡片、只有底色不同——日常操作與不易復原的結構性操作視覺
        權重完全一樣，很容易誤按。現在拆成兩區：上方是日常操作，這裡是進階
        區，預設摺疊、警示樣式，且每一個動作按下去都會先跳二次確認，確認文字
        一定會顯示家戶編號與戶名。

        權限：這一區的動作在後端各自對應 mergeHousehold／splitHousehold／
        transferMember／changeHouseholdCode／archiveHousehold 權限（STAFF 沒有），
        前端這裡沿用同一組 canDevotee 判斷隱藏，但前端隱藏只是體驗優化，
        真正的把關在各支 API。
      */}
      {canAdjust && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-blossom-200 bg-blossom-50/40">
          <button
            type="button"
            onClick={() => setAdvancedOpen((o) => !o)}
            className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left transition
                       hover:bg-blossom-50"
          >
            <span className="flex flex-col">
              <span className="text-sm text-ink">⚠️ 家戶調整（進階）</span>
              <span className="text-xs text-ink-faint">
                轉移成員／拆分／合併／修改編號／封存　—　會改變家戶結構，請謹慎操作
              </span>
            </span>
            <span className="text-xs text-ink-soft">{advancedOpen ? "收合 ▲" : "展開 ▼"}</span>
          </button>

          {advancedOpen && (
            <div className="grid grid-cols-1 gap-2 border-t border-blossom-200 p-3 sm:grid-cols-2">
              {ADVANCED_ACTIONS.map((a) => (
                <button
                  key={a.kind}
                  type="button"
                  onClick={() => setPendingAdvanced(a.kind)}
                  className="flex min-h-12 items-center gap-3 rounded-xl bg-white/80 px-4 py-3 text-left
                             shadow-soft transition hover:bg-blossom-100"
                >
                  <span className="text-xl">{a.icon}</span>
                  <span className="flex flex-col">
                    <span className="text-sm text-ink">{a.label}</span>
                    <span className="text-xs text-ink-faint">{a.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 進階操作的二次確認：確認文字一定顯示家戶編號與戶名（指令九）。 */}
      {pendingAdvanced && (
        <ConfirmDialog
          danger
          title={ADVANCED_ACTION_MAP[pendingAdvanced].label}
          confirmLabel="我了解，繼續"
          message={
            <>
              即將對家戶{" "}
              <span className="font-medium text-ink">
                {household.name}（{householdId}）
              </span>{" "}
              執行「{ADVANCED_ACTION_MAP[pendingAdvanced].label}」。
              <br />
              {ADVANCED_ACTION_MAP[pendingAdvanced].warning}
              <br />
              <span className="text-ink-soft">下一步會先顯示完整預覽，你仍可在預覽畫面取消。</span>
            </>
          }
          onCancel={() => setPendingAdvanced(null)}
          onConfirm={() => {
            const kind = pendingAdvanced;
            setPendingAdvanced(null);
            if (kind === "changeCode") setOpenModal("editHousehold");
            else setOpenModal(kind);
          }}
        />
      )}

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
        /*
         * V13.1 指令六／七／十六：改用 WorshipRecordWizard（取代舊的
         * AddWorshipModal 三個輸入框）。新精靈提供陽上人快速帶入、
         * 帶入家戶地址、列印預覽、重複檢查與確認步驟。
         */
        <WorshipRecordWizard
          householdId={householdId}
          operatorUserId={operatorUser?.id ?? null}
          onClose={() => setOpenModal(null)}
          onCreated={handleSuccess}
        />
      )}
      {openModal === "assignHead" && (
        <AssignHeadModal
          householdId={householdId}
          members={members}
          onClose={() => setOpenModal(null)}
          onSuccess={handleSuccess}
        />
      )}
      {openModal === "mergeHousehold" && (
        <MergeHouseholdWizard
          targetHouseholdId={householdId}
          onClose={() => setOpenModal(null)}
          onSuccess={handleSuccess}
        />
      )}
      {openModal === "splitHousehold" && (
        <SplitHouseholdWizard
          householdId={householdId}
          members={members}
          worshipRecords={worshipRecords}
          onClose={() => setOpenModal(null)}
          onSuccess={handleSuccess}
        />
      )}
      {openModal === "transferMembers" && (
        <TransferMembersWizard
          householdId={householdId}
          members={members}
          onClose={() => setOpenModal(null)}
          onSuccess={handleSuccess}
        />
      )}
      {openModal === "archiveHousehold" && (
        <ArchiveHouseholdDialog
          householdId={householdId}
          memberCount={activeMemberCount}
          onClose={() => setOpenModal(null)}
          onSuccess={() => {
            handleSuccess();
            // V12.1 一次性修正指令「二之3」：原本導向 /households，該路由在
            // 這次驗收修正輪已經改成只做 redirect 到信眾名單（見
            // src/app/households/page.tsx），這裡直接指向目前正式使用中的
            // 家戶管理／信眾中心入口，少一次沒必要的轉址。
            router.push("/devotee-center/list");
          }}
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
