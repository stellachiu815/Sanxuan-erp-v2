"use client";

import { useEffect, useRef, useState } from "react";
import AssignHeadModal from "./AssignHeadModal";
import ArchiveHouseholdDialog from "./ArchiveHouseholdDialog";
import MergeHouseholdWizard from "./MergeHouseholdWizard";
import SplitHouseholdWizard from "./SplitHouseholdWizard";
import TransferMembersWizard from "./TransferMembersWizard";

type HouseholdDetailForActions = {
  members: { id: string; name: string; role: string }[];
  worshipRecords: { id: string; type: "ANCESTOR_LINE" | "INDIVIDUAL"; displayName: string }[];
};

type ActiveModal = "assignHead" | "split" | "transfer" | "archive" | "merge" | null;

type Props = {
  householdId: string;
  /** 成功完成任一操作後呼叫，讓外層（信眾名單／家戶列表）重新整理資料。 */
  onChanged: () => void;
};

/**
 * V12.1「家戶管理中心」驗收修正輪：使用者明確要求「不要重新建立頁面，
 * 直接把 Household Management Center 整合到正式系統（信眾中心）」，所以
 * 這裡不是一個獨立頁面，而是一個掛在既有信眾名單／家戶列表每一列右側的
 * 「更多操作」下拉選單，點開後可以直接開啟指定戶長／合併／拆分／轉移／
 * 封存這五個既有的 Modal／Wizard（上一輪已經完整開發完成，只是完全沒有
 * 入口可以打開，這次只補上入口，不重寫任何一個 Modal／Wizard 本身）。
 *
 * 指定戶長／拆分／轉移／封存都需要這個家戶目前的成員（拆分還需要祭祀
 * 資料）才能開啟對應畫面，這裡沿用既有 GET /api/households/[id]（本來就
 * 對外公開查詢；V12.1 一次性修正指令「二之5」只統一了它的回應信封格式，
 * 沒有改變查詢邏輯或權限），點選對應選項時才即時查詢一次，不會在選單
 * 還沒打開時就預先載入每一列的完整家戶資料，避免信眾名單一次要打一大堆
 * 沒必要的 API。合併家戶不需要先查詢（MergeHouseholdWizard 自己在精靈裡
 * 輸入來源家戶編號查詢），所以點了直接開啟。
 */
export default function HouseholdActionsMenu({ householdId, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [detail, setDetail] = useState<HouseholdDetailForActions | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function openWithDetail(modal: ActiveModal) {
    setOpen(false);
    setError(null);
    if (modal === "merge") {
      setActiveModal("merge");
      return;
    }
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/households/${householdId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "查詢家戶資料失敗");
      // V12.1 一次性修正指令「二之5」：GET /api/households/[id] 已統一成
      // { success, data } 信封（原本直接回傳裸的家戶物件），這裡同步改成
      // 從 json.data 取值。?? {} 是防呆，避免舊快取回應造成 undefined。
      const detailData = json.data ?? {};
      setDetail({
        members: (detailData.members ?? []).map((m: { id: string; name: string; role: string }) => ({
          id: m.id,
          name: m.name,
          role: m.role,
        })),
        worshipRecords: (detailData.worshipRecords ?? []).map((w: { id: string; type: "ANCESTOR_LINE" | "INDIVIDUAL"; displayName: string }) => ({
          id: w.id,
          type: w.type,
          displayName: w.displayName,
        })),
      });
      setActiveModal(modal);
    } catch (e) {
      setError(e instanceof Error ? e.message : "查詢家戶資料失敗，請稍後再試一次。");
    } finally {
      setLoadingDetail(false);
    }
  }

  function closeModal() {
    setActiveModal(null);
    setDetail(null);
  }

  function handleSuccess() {
    onChanged();
    closeModal();
  }

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={loadingDetail}
        className="min-h-11 rounded-full bg-cream-100 px-3 py-1.5 text-xs text-ink-soft transition hover:bg-cream-200 disabled:opacity-50"
      >
        {loadingDetail ? "載入中…" : "更多操作 ▾"}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-40 rounded-2xl bg-white p-1.5 text-sm shadow-card">
          <MenuItem label="👑 指定戶長" onClick={() => openWithDetail("assignHead")} />
          <MenuItem label="🔀 成員轉移" onClick={() => openWithDetail("transfer")} />
          <MenuItem label="🔗 合併家戶" onClick={() => openWithDetail("merge")} />
          <MenuItem label="✂️ 拆分家戶" onClick={() => openWithDetail("split")} />
          <MenuItem label="🗄 封存家戶" onClick={() => openWithDetail("archive")} />
        </div>
      )}

      {error && (
        <p className="absolute right-0 z-40 mt-1 w-56 rounded-xl bg-blossom-50 px-3 py-2 text-xs text-ink-soft shadow-card">
          {error}
        </p>
      )}

      {activeModal === "assignHead" && detail && (
        <AssignHeadModal householdId={householdId} members={detail.members} onClose={closeModal} onSuccess={handleSuccess} />
      )}
      {activeModal === "transfer" && detail && (
        <TransferMembersWizard householdId={householdId} members={detail.members} onClose={closeModal} onSuccess={handleSuccess} />
      )}
      {activeModal === "split" && detail && (
        <SplitHouseholdWizard
          householdId={householdId}
          members={detail.members}
          worshipRecords={detail.worshipRecords}
          onClose={closeModal}
          onSuccess={handleSuccess}
        />
      )}
      {activeModal === "archive" && detail && (
        <ArchiveHouseholdDialog
          householdId={householdId}
          memberCount={detail.members.length}
          onClose={closeModal}
          onSuccess={handleSuccess}
        />
      )}
      {activeModal === "merge" && (
        <MergeHouseholdWizard targetHouseholdId={householdId} onClose={closeModal} onSuccess={handleSuccess} />
      )}
    </div>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block min-h-11 w-full rounded-xl px-3 py-2 text-left text-ink-soft transition hover:bg-cream-100 hover:text-ink"
    >
      {label}
    </button>
  );
}
