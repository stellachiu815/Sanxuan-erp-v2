"use client";

import { useState } from "react";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";

/**
 * V36.14 家戶資料整理頁（瀏覽器操作，不需終端機）。
 *  A. 永久牌位重複清理：同家戶＋同類別＋同核心名保留最早一張、其餘封存（可還原）。
 *  B. 家戶地址對齊主要聯絡人：把家戶地址改成主要聯絡人信眾的地址。
 * 皆先「預覽」（不寫入）→ 跳系統確認視窗 → 才執行。
 */

type WorshipGroup = { householdId: string; type: string; coreName: string; keep: { location: string | null }; archive: { location: string | null }[] };
type AddrChange = { householdId: string; householdName: string; oldAddress: string | null; newAddress: string };

export default function HouseholdMaintenancePage() {
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
  return (
    <main className="mx-auto max-w-3xl px-6 py-8 flex flex-col gap-8">
      <h1 className="text-lg text-ink">家戶資料整理</h1>
      <WorshipDedup />
      <BackfillAddress />
      <MergeCheck />
      <HouseholdAddress />
    </main>
  );
}

function useTool(action: string) {
  const [report, setReport] = useState<any>(null);
  const [committed, setCommitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(commit: boolean) {
    setBusy(true); setError(null);
    try {
      const res = await fetchRegistration(`/api/admin/universal-salvation/maintenance`, {
        method: "POST", body: JSON.stringify({ action, commit, confirm: commit }),
      });
      const data = await res.json();
      if (!res.ok) { setError(toFriendlyError(res.status, data?.error)); return; }
      setReport(data.report); setCommitted(commit);
    } catch { setError("連線問題，請稍後再試。"); } finally { setBusy(false); }
  }
  return { report, committed, busy, error, run };
}

function WorshipDedup() {
  const { report, committed, busy, error, run } = useTool("worship-dedup");
  return (
    <section className="rounded-2xl bg-white/70 p-5 shadow-card">
      <h2 className="text-base font-medium text-ink">A. 永久牌位重複清理</h2>
      <p className="mt-1 text-sm text-ink-soft">同一戶、同類別、同姓的牌位若有多張（地址不同的重複），<b>保留最早建立的一張、其餘封存</b>（可還原）。冤親／無緣不受影響。</p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={() => run(false)} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">{busy ? "計算中…" : "1) 預覽（不寫入）"}</button>
      </div>
      {error && <p className="mt-2 text-sm text-blossom-500">⚠️ {error}</p>}
      {report && (
        <div className="mt-3 text-sm">
          <p className="text-ink">永久牌位共 {report.totalWorshipRecords} 張｜重複組 {report.duplicateGroups} 組｜{committed ? "已封存" : "預計封存"} {report.toArchive} 張</p>
          <ul className="mt-2 max-h-72 overflow-auto text-xs text-ink-soft flex flex-col gap-1">
            {(report.groups as WorshipGroup[]).slice(0, 200).map((g, i) => (
              <li key={i} className="rounded bg-cream-50 px-2 py-1">
                {g.householdId}・{g.coreName}｜保留：{g.keep.location ?? "（空）"}｜封存：{g.archive.map((a) => a.location ?? "（空）").join("、")}
              </li>
            ))}
          </ul>
          {!committed && report.toArchive > 0 && (
            <button type="button" disabled={busy}
              onClick={() => { if (window.confirm(`確定封存 ${report.toArchive} 張重複牌位？（軟刪，可還原）`)) run(true); }}
              style={{ backgroundColor: "#c0392b", color: "#fff", opacity: busy ? 0.5 : 1 }}
              className="mt-3 rounded-full px-5 py-2 text-sm font-semibold">
              {busy ? "封存中…" : `2) 確認封存（${report.toArchive} 張）`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function BackfillAddress() {
  const { report, committed, busy, error, run } = useTool("backfill-address");
  return (
    <section className="rounded-2xl bg-white/70 p-5 shadow-card">
      <h2 className="text-base font-medium text-ink">C. 普渡牌位地址回填（從永久牌位）</h2>
      <p className="mt-1 text-sm text-ink-soft">把本年度普渡牌位的安奉地，一次對齊成「同家戶＋同姓」那張<b>永久牌位</b>的地址。修正匯入時抓成戶籍地（新北）而非安奉地（雲林）的問題。<b>不用重匯</b>。</p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={() => run(false)} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">{busy ? "計算中…" : "1) 預覽（不寫入）"}</button>
      </div>
      {error && <p className="mt-2 text-sm text-blossom-500">⚠️ {error}</p>}
      {report && (
        <div className="mt-3 text-sm">
          <p className="text-ink">牌位共 {report.totalEntries} 張｜{committed ? "已更新" : "預計更新"} {report.changes.length} 張｜永久牌位查無對應 {report.noWorshipMatch} 張</p>
          <ul className="mt-2 max-h-72 overflow-auto text-xs text-ink-soft flex flex-col gap-1">
            {report.changes.slice(0, 300).map((c: any, i: number) => (
              <li key={i} className="rounded bg-cream-50 px-2 py-1">{c.householdId}・{c.displayName}：{c.oldAddress ?? "（空）"} → {c.newAddress}</li>
            ))}
          </ul>
          {!committed && report.changes.length > 0 && (
            <button type="button" disabled={busy}
              onClick={() => { if (window.confirm(`確定回填 ${report.changes.length} 張牌位的安奉地？`)) run(true); }}
              style={{ backgroundColor: "#c0392b", color: "#fff", opacity: busy ? 0.5 : 1 }}
              className="mt-3 rounded-full px-5 py-2 text-sm font-semibold">
              {busy ? "回填中…" : `2) 確認回填（${report.changes.length} 張）`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function MergeCheck() {
  const { report, busy, error, run } = useTool("import-merge-check");
  return (
    <section className="rounded-2xl bg-white/70 p-5 shadow-card">
      <h2 className="text-base font-medium text-ink">D. 匯入合併檢查（49→48 是哪兩列）</h2>
      <p className="mt-1 text-sm text-ink-soft">找出「同家戶＋同姓」被匯入合成一張的多列（純查詢，不動資料）。你看那幾列是不是真的同一張。</p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={() => run(false)} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">{busy ? "查詢中…" : "查詢"}</button>
      </div>
      {error && <p className="mt-2 text-sm text-blossom-500">⚠️ {error}</p>}
      {report && (
        <div className="mt-3 text-sm">
          <p className="text-ink">匯入 {report.importRows} 列｜不重複牌位 {report.distinctTablets} 張｜被合併的組 {report.mergedGroups} 組</p>
          <ul className="mt-2 max-h-72 overflow-auto text-xs text-ink-soft flex flex-col gap-1">
            {report.groups.map((g: any, i: number) => (
              <li key={i} className="rounded bg-cream-50 px-2 py-1">
                <b>{g.householdId}・{g.coreName}（{g.category === "ANCESTOR_LINE" ? "祖先" : "乙位"}）</b>：{g.rowCount} 列合成 1 張
                <div className="mt-0.5">{g.rows.map((r: any) => `第${r.rowNumber}列[${r.tabletName}｜地址:${r.address ?? "空"}｜陽上:${r.yangshang ?? ""}]`).join("　")}</div>
              </li>
            ))}
            {report.mergedGroups === 0 && <li>沒有被合併的列（49=49），一切正常。</li>}
          </ul>
        </div>
      )}
    </section>
  );
}

function HouseholdAddress() {
  const { report, committed, busy, error, run } = useTool("household-address");
  return (
    <section className="rounded-2xl bg-white/70 p-5 shadow-card">
      <h2 className="text-base font-medium text-ink">B. 家戶地址對齊主要聯絡人</h2>
      <p className="mt-1 text-sm text-ink-soft">把每一戶的地址，改成「主要聯絡人」信眾的地址。查無同名聯絡人或其無地址 → 略過（不亂填）。不動信眾／牌位／收款。</p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={() => run(false)} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">{busy ? "計算中…" : "1) 預覽（不寫入）"}</button>
      </div>
      {error && <p className="mt-2 text-sm text-blossom-500">⚠️ {error}</p>}
      {report && (
        <div className="mt-3 text-sm">
          <p className="text-ink">家戶共 {report.totalHouseholds} 戶｜{committed ? "已更新" : "預計更新"} {report.changes.length} 戶｜略過 {report.skipped.length} 戶</p>
          <ul className="mt-2 max-h-72 overflow-auto text-xs text-ink-soft flex flex-col gap-1">
            {(report.changes as AddrChange[]).slice(0, 200).map((c, i) => (
              <li key={i} className="rounded bg-cream-50 px-2 py-1">{c.householdId}（{c.householdName}）：{c.oldAddress ?? "（空）"} → {c.newAddress}</li>
            ))}
          </ul>
          {!committed && report.changes.length > 0 && (
            <button type="button" disabled={busy}
              onClick={() => { if (window.confirm(`確定更新 ${report.changes.length} 戶的家戶地址？`)) run(true); }}
              style={{ backgroundColor: "#c0392b", color: "#fff", opacity: busy ? 0.5 : 1 }}
              className="mt-3 rounded-full px-5 py-2 text-sm font-semibold">
              {busy ? "更新中…" : `2) 確認更新（${report.changes.length} 戶）`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
