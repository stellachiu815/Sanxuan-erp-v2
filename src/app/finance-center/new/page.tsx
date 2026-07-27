"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import BackButton from "@/components/navigation/BackButton";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";

/** V22 新增收入／支出。支出提供快捷鍵：花／果／金紙／犒將（自動帶入名稱，金額使用者輸入）。 */

const QUICK_EXPENSES = ["花", "果", "金紙", "犒將"];

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type EventOpt = { id: string; name: string; year: number };

export default function NewFinanceEntryPage() {
  return (
    <OperatorProvider>
      <div className="min-h-screen">
        <OperatorBar />
        <Suspense fallback={<p className="p-6 text-sm text-ink-faint">讀取中…</p>}>
          <NewEntryInner />
        </Suspense>
      </div>
    </OperatorProvider>
  );
}

function NewEntryInner() {
  const params = useSearchParams();
  const router = useRouter();
  const kind = params.get("kind") === "INCOME" ? "INCOME" : "EXPENSE";
  const isExpense = kind === "EXPENSE";

  const [account, setAccount] = useState<"CASH" | "BANK">("CASH");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [templeEventId, setTempleEventId] = useState("");
  const [events, setEvents] = useState<EventOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    if (!isExpense) return;
    try {
      const res = await fetchRegistration("/api/temple-events");
      const data = await res.json();
      if (res.ok && Array.isArray(data)) setEvents(data.map((e: EventOpt) => ({ id: e.id, name: e.name, year: e.year })));
      else if (res.ok && Array.isArray(data?.events)) setEvents(data.events);
    } catch {
      /* 活動清單非必要 */
    }
  }, [isExpense]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  async function submit() {
    setError(null);
    setOk(null);
    const amt = Number(amount);
    if (!category.trim()) return setError("請輸入項目名稱");
    if (!(amt > 0)) return setError("金額必須大於 0");
    setBusy(true);
    try {
      const res = await fetchRegistration("/api/finance-center/records", {
        method: "POST",
        body: JSON.stringify({
          kind,
          account,
          amount: amt,
          category: category.trim(),
          occurredOn,
          description: description.trim() || null,
          templeEventId: isExpense && templeEventId ? templeEventId : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setOk(`已新增${isExpense ? "支出" : "收入"}：${category.trim()} ${amt.toLocaleString("zh-Hant")} 元`);
      setCategory("");
      setAmount("");
      setDescription("");
    } catch {
      setError("送出時發生連線問題。");
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "min-h-11 w-full rounded-xl border border-cream-300 px-3 py-2 text-sm";

  return (
    <main className="mx-auto max-w-lg px-6 py-8">
      <div className="mb-4 flex items-center gap-3">
        <BackButton fallbackHref="/finance-center" />
        <h1 className="text-lg text-ink">{isExpense ? "新增支出" : "新增收入"}</h1>
      </div>

      <div className="flex flex-col gap-4 rounded-3xl bg-white/70 p-5 shadow-card">
        {isExpense && (
          <div>
            <p className="mb-1 text-xs text-ink-soft">快捷支出（帶入名稱，金額自行輸入）</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_EXPENSES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setCategory(q)}
                  className={`min-h-9 rounded-full px-4 py-1.5 text-sm ${category === q ? "bg-yolk-300 text-ink" : "bg-yolk-100 text-ink-soft hover:bg-yolk-200"}`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="text-sm text-ink-soft">
          帳戶
          <div className="mt-1 flex gap-2">
            {(["CASH", "BANK"] as const).map((a) => (
              <button key={a} type="button" onClick={() => setAccount(a)} className={`min-h-10 flex-1 rounded-xl px-3 text-sm ${account === a ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft"}`}>
                {a === "CASH" ? "現金" : "銀行"}
              </button>
            ))}
          </div>
        </label>

        <label className="text-sm text-ink-soft">
          項目名稱
          <input className={`mt-1 ${inputCls}`} value={category} onChange={(e) => setCategory(e.target.value)} placeholder={isExpense ? "例如：花、水費、海報" : "例如：香油錢、捐款"} />
        </label>

        <label className="text-sm text-ink-soft">
          金額
          <input type="number" inputMode="numeric" className={`mt-1 ${inputCls}`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </label>

        <label className="text-sm text-ink-soft">
          日期
          <input type="date" className={`mt-1 ${inputCls}`} value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
        </label>

        {isExpense && (
          <label className="text-sm text-ink-soft">
            指定活動（選填）
            <select className={`mt-1 ${inputCls}`} value={templeEventId} onChange={(e) => setTempleEventId(e.target.value)}>
              <option value="">－ 不指定（一般支出）－</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name}（{ev.year}）</option>
              ))}
            </select>
          </label>
        )}

        <label className="text-sm text-ink-soft">
          說明（選填）
          <input className={`mt-1 ${inputCls}`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        {error && <p className="text-sm text-blossom-500">⚠️ {error}</p>}
        {ok && <p className="text-sm text-sage-500">✓ {ok}</p>}

        <div className="flex gap-2">
          <button type="button" onClick={() => void submit()} disabled={busy} className="min-h-11 flex-1 rounded-full bg-yolk-200 px-5 text-sm font-medium text-ink hover:bg-yolk-300 disabled:opacity-40">
            {busy ? "送出中…" : "確認新增"}
          </button>
          <button type="button" onClick={() => router.push("/finance-center/ledger")} className="min-h-11 rounded-full bg-cream-200 px-5 text-sm text-ink-soft">
            看流水帳
          </button>
        </div>
      </div>
    </main>
  );
}
