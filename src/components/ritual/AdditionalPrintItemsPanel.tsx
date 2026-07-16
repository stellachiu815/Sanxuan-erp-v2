"use client";

import { useEffect, useState } from "react";
import {
  inputClass,
  labelClass,
  checkboxRowClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";
import Modal from "@/components/Modal";
import {
  additionalPrintItemTypeLabel,
  additionalPrintItemTypeOptions,
  additionalPrintItemStatusLabel,
} from "@/lib/labels";
import type { AdditionalPrintItemJSON, AdditionalPrintItemType } from "./types";

type Props = {
  householdId: string;
  year: number;
  entryId: string;
  /** 原祭祀名稱（例如「王姓歷代祖先」），供「沿用原祭祀名稱」使用。 */
  sourceDisplayName: string;
};

const BASE_PATH = (householdId: string, year: number, entryId: string) =>
  `/api/households/${householdId}/rituals/universal-salvation/${year}/entries/${entryId}/print-items`;

/**
 * V9.1「寶袋與附加列印」面板（需求「四、十二」）：嵌在 EntryRow 底下，
 * 顯示這一筆歷代祖先／個人乙位正魂／冤親債主／無緣子女底下所有附加列印
 * 項目——每一個寶袋（或牌位/疏文/燈牌/其他列印項目）都是獨立一行，絕對
 * 不會把「王姓歷代祖先×1【預設】＋王姓歷代祖先×1【額外】＋王某某×1
 * 【額外】」合併顯示成「寶袋數量3」（需求「十二」明確禁止）。
 */
export default function AdditionalPrintItemsPanel({ householdId, year, entryId, sourceDisplayName }: Props) {
  const [items, setItems] = useState<AdditionalPrintItemJSON[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<AdditionalPrintItemJSON | null>(null);

  const basePath = BASE_PATH(householdId, year, entryId);

  async function reload() {
    try {
      const res = await fetch(basePath);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "讀取失敗，請稍後再試一次。");
        return;
      }
      setItems(data.items);
      setError(null);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  async function handlePrint(item: AdditionalPrintItemJSON) {
    setBusyId(item.id);
    setError(null);
    try {
      const res = await fetch(`/api/universal-salvation/${year}/print-items/print-batches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filter: { kind: "IDS", ids: [item.id] } }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "列印失敗，請稍後再試一次。");
        return;
      }
      await reload();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(item: AdditionalPrintItemJSON) {
    setBusyId(item.id);
    setError(null);
    try {
      const res = await fetch(`${basePath}/${item.id}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "取消失敗，請稍後再試一次。");
        return;
      }
      await reload();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(item: AdditionalPrintItemJSON) {
    setBusyId(item.id);
    setError(null);
    try {
      const res = await fetch(`${basePath}/${item.id}/restore`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "恢復失敗，請稍後再試一次。");
        return;
      }
      await reload();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setBusyId(null);
    }
  }

  async function handlePermanentDelete(item: AdditionalPrintItemJSON) {
    setBusyId(item.id);
    setError(null);
    try {
      const res = await fetch(`${basePath}/${item.id}/delete`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "永久刪除失敗，請稍後再試一次。");
        return;
      }
      setPurgeTarget(null);
      await reload();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-3 rounded-xl bg-cream-50/70 p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-ink-soft">寶袋與附加列印</h4>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-ink-faint">
          {items ? `${items.length} 筆` : "讀取中…"}
        </span>
      </div>

      {error && <p className={`mt-2 ${errorTextClass}`}>{error}</p>}

      <div className="mt-2 flex flex-col gap-2">
        {items?.length === 0 && <p className="text-xs text-ink-faint">尚無寶袋／附加列印項目。</p>}
        {items?.map((item) =>
          editingId === item.id ? (
            <EditPrintItemForm
              key={item.id}
              basePath={basePath}
              item={item}
              sourceDisplayName={sourceDisplayName}
              onDone={() => {
                setEditingId(null);
                reload();
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <PrintItemRow
              key={item.id}
              item={item}
              busy={busyId === item.id}
              onEdit={() => setEditingId(item.id)}
              onCancel={() => handleCancel(item)}
              onRestore={() => handleRestore(item)}
              onPrint={() => handlePrint(item)}
              onRequestPurge={() => setPurgeTarget(item)}
            />
          )
        )}
      </div>

      {showAddForm ? (
        <AddPrintItemForm
          basePath={basePath}
          sourceDisplayName={sourceDisplayName}
          onDone={() => {
            setShowAddForm(false);
            reload();
          }}
          onCancel={() => setShowAddForm(false)}
        />
      ) : (
        <div className="mt-2 flex justify-end">
          <button type="button" className={secondaryButtonClass} onClick={() => setShowAddForm(true)}>
            ＋新增寶袋
          </button>
        </div>
      )}

      {purgeTarget && (
        <Modal title="永久刪除（雙重確認）" onClose={() => setPurgeTarget(null)}>
          <p className="text-sm text-ink">
            確定要永久刪除：
            <br />
            <span className="font-medium">{purgeTarget.printName}</span>
            <span className="ml-1 text-xs text-ink-faint">
              （{additionalPrintItemTypeLabel[purgeTarget.itemType] ?? purgeTarget.itemType}）
            </span>
          </p>
          <p className="mt-3 text-sm text-ink-soft">
            這個動作只有系統管理者能執行，移入回收區後仍保留 30 天可還原，超過期限才會真正從資料庫刪除。
          </p>
          <p className="mt-2 text-sm text-ink-soft">請再次確認要繼續嗎？此為第二次確認。</p>
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" className={secondaryButtonClass} onClick={() => setPurgeTarget(null)} autoFocus>
              取消
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => handlePermanentDelete(purgeTarget)}
              disabled={busyId === purgeTarget.id}
            >
              {busyId === purgeTarget.id ? "處理中…" : "確認永久刪除"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function extraTagClass(isExtra: boolean) {
  return isExtra
    ? "rounded-full bg-blossom-100 px-2 py-0.5 text-xs text-ink-soft"
    : "rounded-full bg-mist-100 px-2 py-0.5 text-xs text-ink-soft";
}

function PrintItemRow({
  item,
  busy,
  onEdit,
  onCancel,
  onRestore,
  onPrint,
  onRequestPurge,
}: {
  item: AdditionalPrintItemJSON;
  busy: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onRestore: () => void;
  onPrint: () => void;
  onRequestPurge: () => void;
}) {
  const isCancelled = item.status === "CANCELLED";
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-white/80 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-ink">
            {additionalPrintItemTypeLabel[item.itemType] ?? item.itemType}：{item.printName}
            {item.quantity > 1 && <span className="text-ink-faint"> ×{item.quantity}</span>}
          </span>
          <span className={extraTagClass(item.isExtra)}>{item.isExtra ? "額外" : "預設"}</span>
          <span className="rounded-full bg-cream-200 px-2 py-0.5 text-xs text-ink-soft">
            {additionalPrintItemStatusLabel[item.status] ?? item.status}
          </span>
          {item.isPrinted && (
            <span className="rounded-full bg-sage-100 px-2 py-0.5 text-xs text-ink-soft">
              已列印 {item.printedQuantity}/{item.quantity} 份
              {item.reprintCount > 0 && `（補印 ${item.reprintCount} 次）`}
            </span>
          )}
        </div>
        {item.note && <p className="mt-0.5 text-xs text-ink-faint">備註：{item.note}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        {!isCancelled && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded-full px-3 py-1.5 text-xs text-ink-soft transition hover:bg-cream-200 hover:text-ink"
          >
            編輯
          </button>
        )}
        {!isCancelled && (
          <button
            type="button"
            onClick={onPrint}
            disabled={busy}
            className="rounded-full px-3 py-1.5 text-xs text-ink-soft transition hover:bg-sage-100 hover:text-ink disabled:opacity-50"
          >
            {busy ? "處理中…" : item.isPrinted ? "補印" : "列印"}
          </button>
        )}
        {!isCancelled && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full px-3 py-1.5 text-xs text-ink-soft transition hover:bg-blossom-100 hover:text-ink disabled:opacity-50"
          >
            取消
          </button>
        )}
        {isCancelled && (
          <button
            type="button"
            onClick={onRestore}
            disabled={busy}
            className="rounded-full px-3 py-1.5 text-xs text-ink-soft transition hover:bg-cream-200 hover:text-ink disabled:opacity-50"
          >
            恢復
          </button>
        )}
        {isCancelled && (
          <button
            type="button"
            onClick={onRequestPurge}
            disabled={busy}
            className="rounded-full px-3 py-1.5 text-xs text-ink-faint transition hover:bg-blossom-100 hover:text-ink disabled:opacity-50"
          >
            永久刪除
          </button>
        )}
      </div>
    </div>
  );
}

function AddPrintItemForm({
  basePath,
  sourceDisplayName,
  onDone,
  onCancel,
}: {
  basePath: string;
  sourceDisplayName: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [itemType, setItemType] = useState<AdditionalPrintItemType>("POCKET");
  const [usesSourceName, setUsesSourceName] = useState(true);
  const [customPrintName, setCustomPrintName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [isExtra, setIsExtra] = useState(true);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      setError("數量必須是至少 1 的整數");
      return;
    }
    if (!usesSourceName && !customPrintName.trim()) {
      setError("請輸入自訂寶袋名稱");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemType,
          usesSourceName,
          customPrintName: usesSourceName ? null : customPrintName.trim(),
          quantity: qty,
          isExtra,
          note: note.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "新增失敗，請稍後再試一次。");
        return;
      }
      onDone();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl bg-white/80 p-4">
      <div>
        <label className={labelClass}>項目類型</label>
        <select
          className={inputClass}
          value={itemType}
          onChange={(e) => setItemType(e.target.value as AdditionalPrintItemType)}
        >
          {additionalPrintItemTypeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <label className={checkboxRowClass}>
        <input type="checkbox" checked={usesSourceName} onChange={(e) => setUsesSourceName(e.target.checked)} />
        沿用原祭祀名稱（{sourceDisplayName}）
      </label>

      {!usesSourceName && (
        <div>
          <label className={labelClass}>自訂寶袋名稱</label>
          <input
            className={inputClass}
            value={customPrintName}
            onChange={(e) => setCustomPrintName(e.target.value)}
            placeholder="例如：王某某"
          />
        </div>
      )}

      <div>
        <label className={labelClass}>數量</label>
        <input
          className={`${inputClass} w-24`}
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </div>

      <label className={checkboxRowClass}>
        <input type="checkbox" checked={isExtra} onChange={(e) => setIsExtra(e.target.checked)} />
        是否為額外寶袋（取消勾選代表這是預設寶袋）
      </label>

      <div>
        <label className={labelClass}>備註（選填）</label>
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      {error && <p className={errorTextClass}>{error}</p>}

      <div className="mt-1 flex justify-end gap-2">
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>
          取消
        </button>
        <button type="button" className={primaryButtonClass} onClick={handleSubmit} disabled={submitting}>
          {submitting ? "新增中…" : "新增"}
        </button>
      </div>
    </div>
  );
}

function EditPrintItemForm({
  basePath,
  item,
  sourceDisplayName,
  onDone,
  onCancel,
}: {
  basePath: string;
  item: AdditionalPrintItemJSON;
  sourceDisplayName: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [usesSourceName, setUsesSourceName] = useState(item.usesSourceName);
  const [customPrintName, setCustomPrintName] = useState(item.usesSourceName ? "" : item.printName);
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [isExtra, setIsExtra] = useState(item.isExtra);
  const [note, setNote] = useState(item.note ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  async function handleSave() {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      setError("數量必須是至少 1 的整數");
      return;
    }
    if (!usesSourceName && !customPrintName.trim()) {
      setError("請輸入自訂寶袋名稱");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${basePath}/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usesSourceName,
          customPrintName: usesSourceName ? null : customPrintName.trim(),
          quantity: qty,
          isExtra,
          note: note.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "儲存失敗，請稍後再試一次。");
        return;
      }
      if (data.alreadyPrintedWarning) {
        setWarning("這筆項目先前已經列印過，修改已生效，請留意是否需要重新列印。");
        return;
      }
      onDone();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-white/80 p-4">
      {warning && <p className={errorTextClass}>⚠️ {warning}</p>}
      <label className={checkboxRowClass}>
        <input type="checkbox" checked={usesSourceName} onChange={(e) => setUsesSourceName(e.target.checked)} />
        沿用原祭祀名稱（{sourceDisplayName}）
      </label>
      {!usesSourceName && (
        <div>
          <label className={labelClass}>自訂寶袋名稱</label>
          <input className={inputClass} value={customPrintName} onChange={(e) => setCustomPrintName(e.target.value)} />
        </div>
      )}
      <div>
        <label className={labelClass}>數量</label>
        <input
          className={`${inputClass} w-24`}
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </div>
      <label className={checkboxRowClass}>
        <input type="checkbox" checked={isExtra} onChange={(e) => setIsExtra(e.target.checked)} />
        是否為額外寶袋
      </label>
      <div>
        <label className={labelClass}>備註</label>
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <p className={errorTextClass}>{error}</p>}
      <div className="mt-1 flex justify-end gap-2">
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className={primaryButtonClass}
          onClick={warning ? onDone : handleSave}
          disabled={submitting}
        >
          {submitting ? "儲存中…" : warning ? "關閉" : "儲存"}
        </button>
      </div>
    </div>
  );
}
