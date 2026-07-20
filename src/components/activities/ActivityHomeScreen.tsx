"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Toast from "@/components/ritual/Toast";
import ConfirmDialog from "@/components/system/ConfirmDialog";
import {
  errorTextClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/household/formStyles";
import { useStoredOperatorUserId } from "@/lib/operatorClient";

type SearchResult = { memberId: string | null; name: string; householdId: string };

type Participant = {
  id: string;
  householdId: string;
  householdName: string;
  contactName: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
};

type Expense = {
  id: string;
  category: string | null;
  amount: string;
  occurredOn: string;
  description: string | null;
};

type Home = {
  id: string;
  activityType: string;
  year: number;
  name: string;
  status: string;
  note: string | null;
  participantCount: number;
  expenseTotal: string;
  checklist: { id: string; label: string; isDone: boolean; completedAt: string | null; completedByName: string | null }[];
};

type Props = {
  templeEventId: string;
  initialHome: Home;
  initialParticipants: Participant[];
  initialExpenses: Expense[];
};

type Tab = "OVERVIEW" | "PARTICIPANTS" | "IMPORT" | "EXPENSES";

/**
 * 通用活動管理畫面：光明燈/太歲燈/全家燈/補庫/宮慶/其他這 6 種目前還沒有
 * 專屬明細規格的活動類型都用這一個畫面（祭改沿用既有的 /purification/[id]
 * 完整畫面，普渡沿用既有的家戶頁面登記流程，不會出現在這裡）。
 */
export default function ActivityHomeScreen({ templeEventId, initialHome, initialParticipants, initialExpenses }: Props) {

  const router = useRouter();
  const searchParams = useSearchParams();
  // 注意：URL 參數 tab=import 是小寫，跟 Tab 型別本身的大寫字面值
  // （"OVERVIEW"/"IMPORT"/...）不是同一組字串，這裡故意先比較原始字串，
  // 再對應成正確的 Tab 值，不要把還沒比對過的原始字串直接斷言成 Tab。
  const [tab, setTab] = useState<Tab>(searchParams.get("tab") === "import" ? "IMPORT" : "OVERVIEW");

  const [home, setHome] = useState(initialHome);
  const [participants, setParticipants] = useState(initialParticipants);
  const [expenses, setExpenses] = useState(initialExpenses);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState("已完成");

  function showToast(message: string) {
    setToastMessage(message);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2000);
  }

  async function refreshHome() {
    const res = await fetch(`/api/temple-events/${templeEventId}`);
    if (res.ok) setHome(await res.json());
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl bg-white/70 p-6 shadow-soft">
        <div className="flex flex-wrap items-center gap-4 text-sm text-ink-soft">
          <span>參加：{home.participantCount} 筆</span>
          <span>支出小計：{home.expenseTotal}</span>
          {home.note && <span>備註：{home.note}</span>}
        </div>
      </div>

      <div className="flex gap-2 border-b border-cream-200">
        {(
          [
            ["OVERVIEW", "總覽／待辦"],
            ["PARTICIPANTS", "參加名單"],
            ["IMPORT", "Excel／CSV匯入"],
            ["EXPENSES", "支出"],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`px-4 py-2.5 text-sm transition ${
              tab === value ? "border-b-2 border-ink-soft text-ink" : "text-ink-faint hover:text-ink-soft"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "OVERVIEW" && (
        <ChecklistPanel templeEventId={templeEventId} checklist={home.checklist} onChanged={refreshHome} />
      )}
      {tab === "PARTICIPANTS" && (
        <ParticipantsPanel
          templeEventId={templeEventId}
          participants={participants}
          setParticipants={setParticipants}
          showToast={showToast}
          onChanged={refreshHome}
        />
      )}
      {tab === "IMPORT" && <ImportPanel templeEventId={templeEventId} showToast={showToast} onChanged={refreshHome} />}
      {tab === "EXPENSES" && (
        <ExpensesPanel templeEventId={templeEventId} expenses={expenses} setExpenses={setExpenses} showToast={showToast} onChanged={refreshHome} />
      )}

      <Toast visible={toastVisible} message={toastMessage} />
    </div>
  );
}

function ChecklistPanel({
  templeEventId,
  checklist,
  onChanged,
}: {
  templeEventId: string;
  checklist: Home["checklist"];
  onChanged: () => void;
}) {
  const [items, setItems] = useState(checklist);

  useEffect(() => setItems(checklist), [checklist]);

  async function toggle(itemId: string, isDone: boolean) {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, isDone } : i)));
    await fetch(`/api/temple-events/${templeEventId}/checklist`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, isDone }),
    });
    onChanged();
  }

  const doneCount = items.filter((i) => i.isDone).length;

  return (
    <div className="rounded-2xl bg-white/70 p-6 shadow-soft">
      <p className="mb-4 text-sm text-ink-soft">
        活動待辦 {doneCount}/{items.length}
      </p>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 rounded-xl bg-cream-100 px-4 py-2.5">
            <input type="checkbox" checked={item.isDone} onChange={(e) => toggle(item.id, e.target.checked)} />
            <span className={item.isDone ? "text-ink-faint line-through" : "text-ink"}>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ParticipantsPanel({
  templeEventId,
  participants,
  setParticipants,
  showToast,
  onChanged,
}: {
  templeEventId: string;
  participants: Participant[];
  setParticipants: React.Dispatch<React.SetStateAction<Participant[]>>;
  showToast: (m: string) => void;
  onChanged: () => void;
}) {
  // V12.2 指令「五」：GET /api/search 這次補上了信眾 view 權限檢查，這裡
  // 沿用**同一個**既有身分來源把 operatorUserId 帶上（見
  // src/lib/operatorClient.tsx 的說明），不是另一套登入或角色機制。
  const operatorUserId = useStoredOperatorUserId();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<{ id: string; label: string } | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removeTargetId, setRemoveTargetId] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}${operatorUserId ? `&operatorUserId=${encodeURIComponent(operatorUserId)}` : ""}`);
      const data = await res.json();
      const seen = new Set<string>();
      const deduped: SearchResult[] = [];
      for (const r of (data.results ?? []) as SearchResult[]) {
        if (seen.has(r.householdId)) continue;
        seen.add(r.householdId);
        deduped.push(r);
      }
      setResults(deduped);
    }, 250);
    return () => clearTimeout(timer);
    // operatorUserId 要放進相依陣列：它是在掛載後的 effect 才讀到
    // localStorage，第一次 render 是 null，沒有列進來的話會停在「還沒帶
    // 身分」的那一次查詢結果上。
  }, [query, operatorUserId]);

  async function handleAdd() {
    setError(null);
    if (!selected) {
      setError("請先搜尋並選擇家戶");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/temple-events/${templeEventId}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdId: selected.id, notes: notes || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "新增失敗");
        return;
      }
      setParticipants((prev) => [
        { id: data.id, householdId: selected.id, householdName: selected.label, contactName: null, notes: notes || null, status: "CONFIRMED", createdAt: new Date().toISOString() },
        ...prev,
      ]);
      setSelected(null);
      setQuery("");
      setNotes("");
      showToast("已加入參加名單");
      onChanged();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(id: string) {
    await fetch(`/api/temple-events/participants/${id}`, { method: "DELETE" });
    setParticipants((prev) => prev.map((p) => (p.id === id ? { ...p, status: "CANCELLED" } : p)));
    setRemoveTargetId(null);
    showToast("已移除");
    onChanged();
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-white/70 p-6 shadow-soft">
      <div className="relative flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <label className={labelClass}>搜尋家戶（編號／電話／地址／聯絡人）</label>
          <input
            className={inputClass}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
            }}
          />
          {results.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full rounded-xl border border-cream-300 bg-white shadow-card">
              {results.map((r) => (
                <li key={r.householdId}>
                  <button
                    type="button"
                    className="w-full px-4 py-2 text-left text-sm hover:bg-cream-100"
                    onClick={() => {
                      setSelected({ id: r.householdId, label: `${r.name}（${r.householdId}）` });
                      setQuery(r.name);
                      setResults([]);
                    }}
                  >
                    {r.name}
                    <span className="ml-2 text-xs text-ink-faint">{r.householdId}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <label className={labelClass}>備註</label>
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <button type="button" className={primaryButtonClass} onClick={handleAdd} disabled={submitting}>
          ＋ 加入
        </button>
      </div>
      {error && <p className={errorTextClass}>{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-cream-200">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-cream-200 text-xs text-ink-faint">
              <th className="px-4 py-3">家戶</th>
              <th className="px-4 py-3">聯絡人</th>
              <th className="px-4 py-3">備註</th>
              <th className="px-4 py-3">狀態</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => (
              <tr key={p.id} className="border-b border-cream-100 last:border-0">
                <td className="px-4 py-3">
                  {p.householdName}
                  <span className="ml-2 text-xs text-ink-faint">{p.householdId}</span>
                </td>
                <td className="px-4 py-3">{p.contactName ?? "—"}</td>
                <td className="px-4 py-3">{p.notes ?? "—"}</td>
                <td className="px-4 py-3">{p.status === "CANCELLED" ? "已移除" : "有效"}</td>
                <td className="px-4 py-3">
                  {p.status !== "CANCELLED" && (
                    <button type="button" className="text-xs text-blossom-300 underline-offset-4 hover:underline" onClick={() => setRemoveTargetId(p.id)}>
                      移除
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {participants.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-faint">
                  尚未有任何參加名單
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {removeTargetId && (
        <ConfirmDialog
          title="移除參加名單"
          message="確定要移除這一戶的參加資料嗎？"
          confirmLabel="確定移除"
          danger
          onCancel={() => setRemoveTargetId(null)}
          onConfirm={() => handleRemove(removeTargetId)}
        />
      )}
    </div>
  );
}

type TargetField = { key: string; label: string; required?: boolean };
type AnalyzedRow = { rowNumber: number; mapped: Record<string, unknown>; status: string; issues: string[] };

const ROW_STATUS_LABEL: Record<string, string> = {
  NEW: "新增",
  UPDATE: "更新",
  DUPLICATE: "重複",
  MISSING_DATA: "缺少資料",
  NEEDS_CONFIRMATION: "待確認",
};

function ImportPanel({
  templeEventId,
  showToast,
  onChanged,
}: {
  templeEventId: string;
  showToast: (m: string) => void;
  onChanged: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [targetFields, setTargetFields] = useState<TargetField[]>([]);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<AnalyzedRow[]>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze() {
    if (!file) {
      setError("請先選擇檔案");
      return;
    }
    setError(null);
    setAnalyzing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/temple-events/${templeEventId}/import/analyze`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "分析失敗");
        return;
      }
      setTargetFields(data.targetFields);
      setMapping(data.mapping);
      setColumns(data.columns);
      setRows(data.rows);
      setSummary(data.summary);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleCommit() {
    if (!file) return;
    setCommitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mapping", JSON.stringify(mapping));
      const res = await fetch(`/api/temple-events/${templeEventId}/import/commit`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "匯入失敗");
        return;
      }
      showToast(`已匯入 ${data.importedCount} 筆，略過 ${data.skippedCount} 筆`);
      setFile(null);
      setRows([]);
      setSummary(null);
      onChanged();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-white/70 p-6 shadow-soft">
      <p className="text-xs text-ink-soft">支援 xlsx／xls／csv，欄位順序不拘。系統會先分析新增/更新/重複/缺少資料，確認後才正式建立。</p>
      <div className="flex items-center gap-3">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setRows([]);
            setSummary(null);
          }}
        />
        <button type="button" className={secondaryButtonClass + " border border-cream-300"} onClick={handleAnalyze} disabled={analyzing || !file}>
          {analyzing ? "分析中…" : "產生分析預覽"}
        </button>
      </div>

      {error && <p className={errorTextClass}>{error}</p>}

      {summary && (
        <div className="flex flex-wrap gap-3 text-sm text-ink-soft">
          <span className="rounded-full bg-sage-100 px-3 py-1 text-xs">新增 {summary.new}</span>
          <span className="rounded-full bg-mist-100 px-3 py-1 text-xs">更新 {summary.update}</span>
          <span className="rounded-full bg-cream-200 px-3 py-1 text-xs">重複 {summary.duplicate}</span>
          <span className="rounded-full bg-blossom-100 px-3 py-1 text-xs">缺少資料 {summary.missingData}</span>
          <span className="rounded-full bg-yolk-100 px-3 py-1 text-xs">待確認 {summary.needsConfirmation}</span>
        </div>
      )}

      {columns.length > 0 && (
        <div className="rounded-xl bg-cream-100 p-4 text-xs text-ink-soft">
          <p className="mb-2 font-medium text-ink">欄位對應（系統自動辨識，可再調整）</p>
          <div className="grid grid-cols-2 gap-2">
            {columns.map((col) => (
              <div key={col} className="flex items-center gap-2">
                <span className="w-28 truncate" title={col}>
                  {col}
                </span>
                <span>→</span>
                <select
                  className={inputClass + " py-1"}
                  value={mapping[col] ?? ""}
                  onChange={(e) => setMapping((prev) => ({ ...prev, [col]: e.target.value || null }))}
                >
                  <option value="">（不匯入）</option>
                  {targetFields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                      {f.required ? "（必填）" : ""}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="max-h-80 overflow-y-auto rounded-xl border border-cream-200">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-cream-200 text-ink-faint">
                <th className="px-3 py-2">列</th>
                <th className="px-3 py-2">狀態</th>
                <th className="px-3 py-2">說明</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rowNumber} className="border-b border-cream-100 last:border-0">
                  <td className="px-3 py-2">{r.rowNumber}</td>
                  <td className="px-3 py-2">{ROW_STATUS_LABEL[r.status] ?? r.status}</td>
                  <td className="px-3 py-2 text-ink-faint">{r.issues.join("；") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex justify-end">
          <button type="button" className={primaryButtonClass} onClick={handleCommit} disabled={committing}>
            {committing ? "匯入中…" : "確認匯入"}
          </button>
        </div>
      )}
    </div>
  );
}

function ExpensesPanel({
  templeEventId,
  expenses,
  setExpenses,
  showToast,
  onChanged,
}: {
  templeEventId: string;
  expenses: Expense[];
  setExpenses: React.Dispatch<React.SetStateAction<Expense[]>>;
  showToast: (m: string) => void;
  onChanged: () => void;
}) {
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd() {
    setError(null);
    if (!occurredOn) {
      setError("請選擇支出日期");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/temple-events/${templeEventId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: category || null, amount: Number(amount), occurredOn, description: description || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "新增失敗");
        return;
      }
      setExpenses((prev) => [{ id: data.id, category: category || null, amount, occurredOn, description: description || null }, ...prev]);
      setCategory("");
      setAmount("");
      setOccurredOn("");
      setDescription("");
      showToast("已新增支出");
      onChanged();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(id: string) {
    await fetch(`/api/temple-events/expenses/${id}`, { method: "DELETE" });
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    onChanged();
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-white/70 p-6 shadow-soft">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={labelClass}>項目分類</label>
          <input className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>金額</label>
          <input className={inputClass} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>日期</label>
          <input className={inputClass} type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className={labelClass}>說明</label>
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <button type="button" className={primaryButtonClass} onClick={handleAdd} disabled={submitting}>
          ＋ 新增支出
        </button>
      </div>
      {error && <p className={errorTextClass}>{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-cream-200">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-cream-200 text-xs text-ink-faint">
              <th className="px-4 py-3">日期</th>
              <th className="px-4 py-3">分類</th>
              <th className="px-4 py-3">金額</th>
              <th className="px-4 py-3">說明</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id} className="border-b border-cream-100 last:border-0">
                <td className="px-4 py-3">{new Date(e.occurredOn).toLocaleDateString("zh-TW")}</td>
                <td className="px-4 py-3">{e.category ?? "—"}</td>
                <td className="px-4 py-3">{e.amount}</td>
                <td className="px-4 py-3">{e.description ?? "—"}</td>
                <td className="px-4 py-3">
                  <button type="button" className="text-xs text-blossom-300 underline-offset-4 hover:underline" onClick={() => handleRemove(e.id)}>
                    刪除
                  </button>
                </td>
              </tr>
            ))}
            {expenses.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-faint">
                  尚未有任何支出紀錄
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
