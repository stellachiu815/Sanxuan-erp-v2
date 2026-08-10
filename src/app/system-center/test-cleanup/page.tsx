"use client";

import { useCallback, useEffect, useState } from "react";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { fetchRegistration } from "@/lib/registrationFetch";
import { activityTypeLabel } from "@/lib/labels";

/**
 * V40「測試資料清理」頁（瀏覽器操作，不需終端機）。
 *  三個工具，全部「先預覽、確認後才執行」：
 *   1. 測試活動刪除：硬刪一個活動＋它底下所有報名/公開表（釋放年度名額，可重建）。
 *   2. 測試感謝狀刪除：硬刪一張感謝狀＋它的收款/應收（數字一起消失）。
 *   3. 測試家戶封存：軟刪成員＋軟封存家戶（可還原）。
 *  刪除前務必先到「系統管理→備份」按「立即備份」。
 */

type EventRow = { id: string; activityType: string; year: number; isArchived: boolean; createdAt: string; recordCount: number; publicFormCount: number };
type ReceiptRow = { id: string; receiptNumber: string | null; payerName: string; status: string; amount: number; createdAt: string };
type HouseholdRow = { id: string; name: string; code: string | null; memberCount: number; createdAt: string };
type Listing = { events: EventRow[]; receipts: ReceiptRow[]; households: HouseholdRow[] };

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" });

export default function TestCleanupPage() {
  return (
    <OperatorProvider>
      <div className="min-h-screen">
        <OperatorBar />
        <Inner />
      </div>
    </OperatorProvider>
  );
}

function Inner() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRegistration("/api/system-center/test-cleanup", {
        method: "POST",
        body: JSON.stringify({ action: "list" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "載入失敗");
      setListing(data.data as Listing);
    } catch (e) {
      setError((e instanceof Error ? e.message : "發生錯誤"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-8">
      <div>
        <h1 className="text-lg text-ink">🧹 測試資料清理</h1>
        <p className="mt-2 rounded-2xl bg-apricot-75 px-4 py-3 text-sm text-ink-soft">
          刪除前請先到「系統管理 → 備份」按一次「立即備份」，那是唯一的還原保險。這頁每個動作都會
          <b>先預覽、你確認後才真的執行</b>；活動與感謝狀是「硬刪除」（真的消失、無法從畫面還原，只能靠備份），
          家戶是「封存」（軟刪除，可還原）。建議順序：先刪測試活動 → 再刪測試感謝狀 → 最後封存測試家戶。
        </p>
      </div>

      {error && <p className="rounded-2xl bg-blossom-75 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {loading && <p className="text-sm text-ink-faint">載入中…</p>}

      {listing && (
        <>
          <EventSection rows={listing.events} onDone={reload} />
          <ReceiptSection rows={listing.receipts} onDone={reload} />
          <HouseholdSection rows={listing.households} onDone={reload} />
        </>
      )}
    </main>
  );
}

// ── 共用：單筆「預覽→確認→執行」控制 ─────────────────────────────
function useItemAction(action: string, onDone: () => void) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  async function startPreview(id: string) {
    setBusy(true);
    setErr(null);
    setDoneMsg(null);
    try {
      const res = await fetchRegistration("/api/system-center/test-cleanup", {
        method: "POST",
        body: JSON.stringify({ action, id, commit: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "預覽失敗");
      setPreview(data.report);
      setPendingId(id);
    } catch (e) {
      setErr((e instanceof Error ? e.message : "發生錯誤"));
    } finally {
      setBusy(false);
    }
  }

  async function commit(id: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetchRegistration("/api/system-center/test-cleanup", {
        method: "POST",
        body: JSON.stringify({ action, id, commit: true, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "執行失敗");
      setPendingId(null);
      setPreview(null);
      setDoneMsg("✅ 已完成");
      onDone();
    } catch (e) {
      setErr((e instanceof Error ? e.message : "發生錯誤"));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setPendingId(null);
    setPreview(null);
    setErr(null);
  }

  return { pendingId, preview, busy, err, doneMsg, startPreview, commit, cancel };
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2 rounded-2xl border border-cream-150 bg-white px-4 py-3">{children}</div>;
}

// ── 一、測試活動刪除 ──────────────────────────────────────────
function EventSection({ rows, onDone }: { rows: EventRow[]; onDone: () => void }) {
  const a = useItemAction("delete-event", onDone);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-medium text-ink">1. 測試活動刪除</h2>
      <p className="text-sm text-ink-faint">硬刪整個活動，連同它底下所有報名紀錄與公開報名表。刪掉後同一「類型＋年度」可以重新建立。</p>
      {rows.length === 0 && <p className="text-sm text-ink-faint">沒有可清理的活動。</p>}
      {a.err && <p className="text-sm text-rose-700">{a.err}</p>}
      {rows.map((e) => (
        <Row key={e.id}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-ink">
              <b>{activityTypeLabel[e.activityType] ?? e.activityType}</b>　{e.year} 年
              <span className="ml-2 text-ink-faint">報名 {e.recordCount} 筆・公開表 {e.publicFormCount} 張・建立 {fmtDate(e.createdAt)}</span>
            </div>
            {a.pendingId !== e.id && (
              <button onClick={() => a.startPreview(e.id)} disabled={a.busy} className="shrink-0 rounded-full bg-blossom-75 px-4 py-1.5 text-sm text-rose-700 hover:shadow-pop disabled:opacity-50">
                刪除
              </button>
            )}
          </div>
          {a.pendingId === e.id && a.preview && (
            <div className="rounded-2xl bg-blossom-75/60 px-4 py-3 text-sm text-ink-soft">
              確認要<b>永久刪除</b>「{activityTypeLabel[e.activityType] ?? e.activityType} {e.year} 年」嗎？將一併刪除：報名紀錄 {a.preview.records} 筆、公開報名表 {a.preview.publicForms} 張（含填單 {a.preview.publicRegistrations} 筆）。此動作無法從畫面還原。
              <div className="mt-3 flex gap-2">
                <button onClick={() => a.commit(e.id)} disabled={a.busy} className="rounded-full bg-rose-600 px-4 py-1.5 text-sm text-white hover:bg-rose-700 disabled:opacity-50">確認刪除</button>
                <button onClick={a.cancel} disabled={a.busy} className="rounded-full bg-cream-150 px-4 py-1.5 text-sm text-ink hover:shadow-pop disabled:opacity-50">取消</button>
              </div>
            </div>
          )}
        </Row>
      ))}
    </section>
  );
}

// ── 二、測試感謝狀刪除 ────────────────────────────────────────
function ReceiptSection({ rows, onDone }: { rows: ReceiptRow[]; onDone: () => void }) {
  const a = useItemAction("delete-receipt", onDone);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-medium text-ink">2. 測試感謝狀刪除</h2>
      <p className="text-sm text-ink-faint">硬刪一張感謝狀，連同它的收款交易與連動的人工應收一起消失（數字會一起歸零）。</p>
      {rows.length === 0 && <p className="text-sm text-ink-faint">沒有可清理的感謝狀。</p>}
      {a.err && <p className="text-sm text-rose-700">{a.err}</p>}
      {rows.map((r) => (
        <Row key={r.id}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-ink">
              <b>{r.payerName}</b>
              <span className="ml-2 text-ink-faint">{r.receiptNumber ?? "（無編號）"}・{r.amount.toLocaleString()} 元・{r.status}・{fmtDate(r.createdAt)}</span>
            </div>
            {a.pendingId !== r.id && (
              <button onClick={() => a.startPreview(r.id)} disabled={a.busy} className="shrink-0 rounded-full bg-lilac-75 px-4 py-1.5 text-sm text-ink hover:shadow-pop disabled:opacity-50">
                刪除
              </button>
            )}
          </div>
          {a.pendingId === r.id && a.preview && (
            <div className="rounded-2xl bg-lilac-75/60 px-4 py-3 text-sm text-ink-soft">
              確認要<b>永久刪除</b>「{r.payerName}」這張感謝狀（{a.preview.amount.toLocaleString()} 元）嗎？將一併刪除收款交易與 {a.preview.manualReceivables} 筆人工應收。此動作無法從畫面還原。
              <div className="mt-3 flex gap-2">
                <button onClick={() => a.commit(r.id)} disabled={a.busy} className="rounded-full bg-rose-600 px-4 py-1.5 text-sm text-white hover:bg-rose-700 disabled:opacity-50">確認刪除</button>
                <button onClick={a.cancel} disabled={a.busy} className="rounded-full bg-cream-150 px-4 py-1.5 text-sm text-ink hover:shadow-pop disabled:opacity-50">取消</button>
              </div>
            </div>
          )}
        </Row>
      ))}
    </section>
  );
}

// ── 三、測試家戶封存 ──────────────────────────────────────────
function HouseholdSection({ rows, onDone }: { rows: HouseholdRow[]; onDone: () => void }) {
  const a = useItemAction("archive-household", onDone);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-medium text-ink">3. 測試家戶封存</h2>
      <p className="text-sm text-ink-faint">把測試加戶連同成員一起封存（軟刪除、可還原）。若家戶還有未完成活動或未收款會被擋，請先清掉對應的測試活動。</p>
      {rows.length === 0 && <p className="text-sm text-ink-faint">沒有可清理的家戶。</p>}
      {a.err && <p className="text-sm text-rose-700">{a.err}</p>}
      {rows.map((h) => (
        <Row key={h.id}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-ink">
              <b>{h.name}</b>
              <span className="ml-2 text-ink-faint">{h.code ?? "（無編號）"}・成員 {h.memberCount} 位・建立 {fmtDate(h.createdAt)}</span>
            </div>
            {a.pendingId !== h.id && (
              <button onClick={() => a.startPreview(h.id)} disabled={a.busy} className="shrink-0 rounded-full bg-sage-75 px-4 py-1.5 text-sm text-ink hover:shadow-pop disabled:opacity-50">
                封存
              </button>
            )}
          </div>
          {a.pendingId === h.id && a.preview && (
            <div className="rounded-2xl bg-sage-75/60 px-4 py-3 text-sm text-ink-soft">
              {a.preview.canArchive ? (
                <>
                  確認要封存「{h.name}」嗎？將一併封存 {a.preview.memberCount} 位成員（軟刪除、可還原）。
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => a.commit(h.id)} disabled={a.busy} className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">確認封存</button>
                    <button onClick={a.cancel} disabled={a.busy} className="rounded-full bg-cream-150 px-4 py-1.5 text-sm text-ink hover:shadow-pop disabled:opacity-50">取消</button>
                  </div>
                </>
              ) : (
                <>
                  目前不能封存，還有：{(a.preview.blockers as string[]).join("；")}。請先清掉對應的測試活動再回來。
                  <div className="mt-3"><button onClick={a.cancel} className="rounded-full bg-cream-150 px-4 py-1.5 text-sm text-ink hover:shadow-pop">知道了</button></div>
                </>
              )}
            </div>
          )}
        </Row>
      ))}
    </section>
  );
}
