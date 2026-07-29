"use client";

import { useEffect, useState, useCallback } from "react";
import Modal from "@/components/Modal";
import ConfirmDialog from "@/components/system/ConfirmDialog";
import { useOperator } from "@/lib/operatorClient";
import { memberRoleLabel } from "@/lib/labels";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass, errorTextClass } from "./formStyles";

type Member = { id: string; name: string; role: string };
type ArchivedMember = { id: string; name: string; role: string; deletedAt: string | null; deletedByName: string | null };

type Props = {
  householdId: string;
  householdName: string;
  members: Member[];
  onClose: () => void;
  onSuccess: () => void;
};

/**
 * V28：家戶成員維護——封存／恢復（不硬刪除信眾），以及孤兒防護的「移出」流程。
 *
 * 移出一位成員時，為避免產生無歸屬孤兒資料，一律要在兩者擇一：
 *   (1) 移至既有家戶（沿用既有轉移流程）
 *   (2) 建立個人戶（新建家戶並轉入）
 * 「封存」則是把成員收進封存區（保留 householdId 與所有活動/收款/收據/列印/歷史），
 * 隨時可恢復。所有高風險操作都有二次確認。
 */
export default function MemberManageModal({ householdId, householdName, members, onClose, onSuccess }: Props) {
  const { operatorUserId } = useOperator();
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [archived, setArchived] = useState<ArchivedMember[]>([]);
  const [archivedLoaded, setArchivedLoaded] = useState(false);

  const [confirmArchive, setConfirmArchive] = useState<Member | null>(null);
  const [movingMember, setMovingMember] = useState<Member | null>(null);
  const [moveMode, setMoveMode] = useState<"existing" | "new">("existing");
  const [targetCode, setTargetCode] = useState("");
  const [newHouseholdName, setNewHouseholdName] = useState("");
  const [newHeadMemberId, setNewHeadMemberId] = useState("");

  const loadArchived = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/households/${householdId}/members/archived`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "載入封存區失敗");
        return;
      }
      setArchived(data.data.members as ArchivedMember[]);
      setArchivedLoaded(true);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    }
  }, [householdId]);

  useEffect(() => {
    if (tab === "archived" && !archivedLoaded) loadArchived();
  }, [tab, archivedLoaded, loadArchived]);

  // 移出成員時：若被移出者是戶長、且原戶還有其他成員 → 必須指定原戶新戶長。
  const movingIsHead = movingMember?.role === "HOUSEHOLD_HEAD";
  const remainingAfterMove = movingMember ? members.filter((m) => m.id !== movingMember.id) : [];
  const needsNewHead = movingIsHead && remainingAfterMove.length > 0;

  function beginMove(m: Member) {
    setMovingMember(m);
    setMoveMode("existing");
    setTargetCode("");
    setNewHouseholdName("");
    setNewHeadMemberId("");
    setError(null);
  }

  async function doArchive(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/households/${householdId}/members/${id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "封存失敗");
        return;
      }
      setConfirmArchive(null);
      setArchivedLoaded(false);
      onSuccess();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setBusy(false);
    }
  }

  async function doRestore(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/households/${householdId}/members/${id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "恢復失敗");
        return;
      }
      await loadArchived();
      onSuccess();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setBusy(false);
    }
  }

  async function executeMove() {
    if (!movingMember || busy) return;
    if (moveMode === "existing" && !targetCode.trim()) {
      setError("請輸入目標家戶編號");
      return;
    }
    if (needsNewHead && !newHeadMemberId) {
      setError("被移出者是戶長，請先指定原家戶的新戶長");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (moveMode === "new") {
        const res = await fetch(`/api/households/${householdId}/members/${movingMember.id}/move-to-new`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operatorUserId, householdName: newHouseholdName }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "建立個人戶失敗");
          return;
        }
      } else {
        const newHeadsForSourceHouseholds: Record<string, string> =
          needsNewHead && newHeadMemberId ? { [householdId]: newHeadMemberId } : {};
        const res = await fetch("/api/households/members/transfer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operatorUserId,
            memberIds: [movingMember.id],
            targetHouseholdId: targetCode.trim(),
            newHeadsForSourceHouseholds,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "移至既有家戶失敗");
          return;
        }
      }
      setMovingMember(null);
      onSuccess();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="管理家戶成員" onClose={onClose}>
      <div className="flex gap-2">
        <TabButton active={tab === "active"} onClick={() => setTab("active")}>
          在戶成員（{members.length}）
        </TabButton>
        <TabButton active={tab === "archived"} onClick={() => setTab("archived")}>
          封存區{archivedLoaded ? `（${archived.length}）` : ""}
        </TabButton>
      </div>

      <p className="mt-3 rounded-2xl bg-mist-50 px-4 py-2.5 text-xs leading-relaxed text-ink-soft">
        封存不會刪除信眾，成員的活動、收款、收據、列印與歷史都保留，隨時可恢復。若要把成員「移出本戶」，為避免資料無歸屬，請選擇移至既有家戶或建立個人戶。
      </p>

      {error && !movingMember && !confirmArchive && <p className={`${errorTextClass} mt-3`}>{error}</p>}

      {tab === "active" && (
        <div className="mt-4 flex flex-col gap-3">
          {members.length === 0 && <p className="text-sm text-ink-faint">目前沒有在戶成員。</p>}
          {members.map((m) => (
            <div key={m.id} className="rounded-2xl bg-sage-50 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base text-ink">{m.name}</span>
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-ink-soft">
                  {memberRoleLabel[m.role] ?? m.role}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-full bg-white/80 px-4 py-1.5 text-xs text-ink shadow-soft transition hover:bg-blossom-100"
                  onClick={() => setConfirmArchive(m)}
                >
                  🗄 封存
                </button>
                <button
                  type="button"
                  className="rounded-full bg-white/80 px-4 py-1.5 text-xs text-ink shadow-soft transition hover:bg-cream-200"
                  onClick={() => beginMove(m)}
                >
                  🔀 移出本戶…
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "archived" && (
        <div className="mt-4 flex flex-col gap-3">
          {archivedLoaded && archived.length === 0 && <p className="text-sm text-ink-faint">封存區沒有成員。</p>}
          {!archivedLoaded && <p className="text-sm text-ink-faint">載入中…</p>}
          {archived.map((m) => (
            <div key={m.id} className="rounded-2xl bg-mist-50 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base text-ink">{m.name}</span>
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-ink-soft">
                  {memberRoleLabel[m.role] ?? m.role}
                </span>
                <span className="rounded-full bg-mist-200 px-2 py-0.5 text-xs text-ink-soft">已封存</span>
              </div>
              <p className="mt-1 text-xs text-ink-faint">
                封存時間：{m.deletedAt ? new Date(m.deletedAt).toLocaleString("zh-TW") : "—"}
                {m.deletedByName ? `　封存人：${m.deletedByName}` : ""}
              </p>
              <div className="mt-3">
                <button
                  type="button"
                  className="rounded-full bg-white/80 px-4 py-1.5 text-xs text-ink shadow-soft transition hover:bg-sage-100"
                  onClick={() => doRestore(m.id)}
                  disabled={busy}
                >
                  ♻️ 恢復
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmArchive && (
        <ConfirmDialog
          danger
          title="封存成員"
          confirmLabel="確認封存"
          message={
            <>
              即將封存成員 <span className="font-medium text-ink">{confirmArchive.name}</span>。
              <br />
              封存後這位成員不會出現在在戶名單，但信眾本人與其活動、收款、收據、列印與歷史紀錄都保留，隨時可在封存區恢復。
            </>
          }
          onCancel={() => setConfirmArchive(null)}
          onConfirm={() => doArchive(confirmArchive.id)}
        />
      )}

      {movingMember && (
        <Modal title={`移出成員：${movingMember.name}`} onClose={() => setMovingMember(null)}>
          <div className="flex flex-col gap-4">
            <p className="rounded-2xl bg-mist-50 px-4 py-2.5 text-xs leading-relaxed text-ink-soft">
              為避免產生無歸屬的資料，移出成員必須指定去處。成員名下的收款、收據、供品認捐與列印項目會一併改掛到新家戶。
            </p>
            <div className="flex gap-2">
              <TabButton active={moveMode === "existing"} onClick={() => setMoveMode("existing")}>
                移至既有家戶
              </TabButton>
              <TabButton active={moveMode === "new"} onClick={() => setMoveMode("new")}>
                建立個人戶
              </TabButton>
            </div>

            {moveMode === "existing" ? (
              <div>
                <label className={labelClass}>目標家戶編號</label>
                <input
                  className={`${inputClass} min-h-11`}
                  value={targetCode}
                  onChange={(e) => setTargetCode(e.target.value)}
                  placeholder="例如 F00012"
                />
              </div>
            ) : (
              <div>
                <label className={labelClass}>新家戶戶名（留空則以「{movingMember.name}（個人戶）」命名，編號自動配號）</label>
                <input
                  className={`${inputClass} min-h-11`}
                  value={newHouseholdName}
                  onChange={(e) => setNewHouseholdName(e.target.value)}
                  placeholder={`${movingMember.name}（個人戶）`}
                />
              </div>
            )}

            {needsNewHead && (
              <div>
                <label className={labelClass}>被移出者是戶長，請指定原家戶的新戶長</label>
                <select
                  className={`${inputClass} min-h-11`}
                  value={newHeadMemberId}
                  onChange={(e) => setNewHeadMemberId(e.target.value)}
                >
                  <option value="">請選擇</option>
                  {remainingAfterMove.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {error && <p className={errorTextClass}>{error}</p>}

            <div className="flex justify-end gap-2">
              <button type="button" className={secondaryButtonClass} onClick={() => setMovingMember(null)} disabled={busy}>
                取消
              </button>
              <button
                type="button"
                className="rounded-full bg-blossom-200 px-5 py-2.5 text-sm text-ink transition hover:bg-blossom-300 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={executeMove}
                disabled={busy}
              >
                {busy ? "處理中…" : moveMode === "new" ? "建立個人戶並移出" : "移至既有家戶"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm transition ${
        active ? "bg-ink-soft text-cream-50" : "bg-cream-200 text-ink-soft hover:bg-cream-300"
      }`}
    >
      {children}
    </button>
  );
}
