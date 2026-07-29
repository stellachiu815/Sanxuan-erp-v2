"use client";

import { useEffect, useState, useCallback } from "react";
import Modal from "@/components/Modal";
import ConfirmDialog from "@/components/system/ConfirmDialog";
import { useOperator } from "@/lib/operatorClient";
import { worshipTypeLabel } from "@/lib/labels";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass, errorTextClass } from "./formStyles";

export type ManageWorshipRecord = {
  id: string;
  type: "ANCESTOR_LINE" | "INDIVIDUAL";
  displayName: string;
  location: string | null;
  yangshangName: string | null;
  notes: string | null;
};

type ArchivedRecord = ManageWorshipRecord & { deletedAt: string | null; deletedByName: string | null };

type Props = {
  householdId: string;
  records: ManageWorshipRecord[];
  onClose: () => void;
  onSuccess: () => void;
};

/**
 * V28：家戶「祭祀永久資料」（歷代祖先／乙位正魂）維護——編輯、封存、恢復。
 *
 * 只影響目前永久資料與未來帶入；封存/編輯**不回溯**既有年度普渡報名、列印
 * 快照、收款、收據、帳務。封存後仍可於「封存區」查詢並恢復。陽上人維持自由
 * 輸入多位姓名（頓號分隔），不加親屬稱謂；列印時才由系統加「叩薦」。
 */
export default function WorshipRecordManageModal({ householdId, records, onClose, onSuccess }: Props) {
  const { operatorUserId } = useOperator();
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<ManageWorshipRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [archived, setArchived] = useState<ArchivedRecord[]>([]);
  const [archivedLoaded, setArchivedLoaded] = useState(false);

  // 編輯表單暫存
  const [form, setForm] = useState<{ displayName: string; location: string; yangshangName: string; notes: string }>({
    displayName: "",
    location: "",
    yangshangName: "",
    notes: "",
  });

  const loadArchived = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/households/${householdId}/worship/archived`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "載入封存區失敗");
        return;
      }
      setArchived(data.data.records as ArchivedRecord[]);
      setArchivedLoaded(true);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    }
  }, [householdId]);

  useEffect(() => {
    if (tab === "archived" && !archivedLoaded) loadArchived();
  }, [tab, archivedLoaded, loadArchived]);

  function beginEdit(r: ManageWorshipRecord) {
    setEditingId(r.id);
    setForm({
      displayName: r.displayName,
      location: r.location ?? "",
      yangshangName: r.yangshangName ?? "",
      notes: r.notes ?? "",
    });
    setError(null);
  }

  async function saveEdit(id: string) {
    if (busy) return;
    if (!form.displayName.trim()) {
      setError("請輸入牌位名稱");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/households/${householdId}/worship/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorUserId,
          displayName: form.displayName,
          location: form.location,
          yangshangName: form.yangshangName,
          notes: form.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "儲存失敗");
        return;
      }
      setEditingId(null);
      onSuccess();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setBusy(false);
    }
  }

  async function doArchive(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/households/${householdId}/worship/${id}/archive`, {
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
      setArchivedLoaded(false); // 下次切到封存區重新載入
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
      const res = await fetch(`/api/households/${householdId}/worship/${id}/restore`, {
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

  return (
    <Modal title="管理祭祀資料（歷代祖先／乙位正魂）" onClose={onClose}>
      <div className="flex gap-2">
        <TabButton active={tab === "active"} onClick={() => setTab("active")}>
          使用中（{records.length}）
        </TabButton>
        <TabButton active={tab === "archived"} onClick={() => setTab("archived")}>
          封存區{archivedLoaded ? `（${archived.length}）` : ""}
        </TabButton>
      </div>

      <p className="mt-3 rounded-2xl bg-mist-50 px-4 py-2.5 text-xs leading-relaxed text-ink-soft">
        編輯與封存只影響目前資料與「未來帶入」，不會更動已建立的年度普渡報名、列印快照、收款或收據。封存後可在封存區隨時恢復。
      </p>

      {error && <p className={`${errorTextClass} mt-3`}>{error}</p>}

      {tab === "active" && (
        <div className="mt-4 flex flex-col gap-3">
          {records.length === 0 && <p className="text-sm text-ink-faint">目前沒有使用中的祭祀資料。</p>}
          {records.map((r) => (
            <div key={r.id} className="rounded-2xl bg-blossom-50/70 px-4 py-3">
              {editingId === r.id ? (
                <div className="flex flex-col gap-3">
                  <div>
                    <label className={labelClass}>牌位名稱</label>
                    <input
                      className={`${inputClass} min-h-11`}
                      value={form.displayName}
                      onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>安奉地址</label>
                    <input
                      className={`${inputClass} min-h-11`}
                      value={form.location}
                      onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>陽上人（多位以頓號「、」分隔，僅填姓名、不加稱謂）</label>
                    <input
                      className={`${inputClass} min-h-11`}
                      value={form.yangshangName}
                      onChange={(e) => setForm((f) => ({ ...f, yangshangName: e.target.value }))}
                      placeholder="例如：王大明、王小華"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>備註</label>
                    <input
                      className={`${inputClass} min-h-11`}
                      value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button type="button" className={secondaryButtonClass} onClick={() => setEditingId(null)} disabled={busy}>
                      取消
                    </button>
                    <button type="button" className={`${primaryButtonClass} min-h-11`} onClick={() => saveEdit(r.id)} disabled={busy}>
                      {busy ? "儲存中…" : "儲存"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base text-ink">{r.displayName}</span>
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-ink-soft">
                      {worshipTypeLabel[r.type] ?? r.type}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-ink-soft">
                    {r.location && <span>安奉地：{r.location}</span>}
                    {r.yangshangName && <span>陽上姓名：{r.yangshangName}</span>}
                  </div>
                  {r.notes && <p className="mt-1 text-sm text-ink-faint">備註：{r.notes}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-full bg-white/80 px-4 py-1.5 text-xs text-ink shadow-soft transition hover:bg-cream-200"
                      onClick={() => beginEdit(r)}
                    >
                      ✏️ 編輯
                    </button>
                    <button
                      type="button"
                      className="rounded-full bg-white/80 px-4 py-1.5 text-xs text-ink shadow-soft transition hover:bg-blossom-100"
                      onClick={() => setConfirmArchive(r)}
                    >
                      🗄 封存
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "archived" && (
        <div className="mt-4 flex flex-col gap-3">
          {archivedLoaded && archived.length === 0 && <p className="text-sm text-ink-faint">封存區沒有資料。</p>}
          {!archivedLoaded && <p className="text-sm text-ink-faint">載入中…</p>}
          {archived.map((r) => (
            <div key={r.id} className="rounded-2xl bg-mist-50 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base text-ink">{r.displayName}</span>
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-ink-soft">
                  {worshipTypeLabel[r.type] ?? r.type}
                </span>
                <span className="rounded-full bg-mist-200 px-2 py-0.5 text-xs text-ink-soft">已封存</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-ink-soft">
                {r.location && <span>安奉地：{r.location}</span>}
                {r.yangshangName && <span>陽上姓名：{r.yangshangName}</span>}
              </div>
              <p className="mt-1 text-xs text-ink-faint">
                封存時間：{r.deletedAt ? new Date(r.deletedAt).toLocaleString("zh-TW") : "—"}
                {r.deletedByName ? `　封存人：${r.deletedByName}` : ""}
              </p>
              <div className="mt-3">
                <button
                  type="button"
                  className="rounded-full bg-white/80 px-4 py-1.5 text-xs text-ink shadow-soft transition hover:bg-sage-100"
                  onClick={() => doRestore(r.id)}
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
          title="封存祭祀資料"
          confirmLabel="確認封存"
          message={
            <>
              即將封存{" "}
              <span className="font-medium text-ink">{confirmArchive.displayName}</span>
              （{worshipTypeLabel[confirmArchive.type] ?? confirmArchive.type}）。
              <br />
              封存後這筆牌位不會出現在使用中名單，也不會再帶入未來年度普渡；但既有年度報名、列印快照、收款與收據都不受影響。
              <br />
              <span className="text-ink-soft">你隨時可以在「封存區」恢復它。</span>
            </>
          }
          onCancel={() => setConfirmArchive(null)}
          onConfirm={() => doArchive(confirmArchive.id)}
        />
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
