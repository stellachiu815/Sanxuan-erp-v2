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

type WorshipRec = { id: string; displayName: string; location: string | null; yangshang: string | null; createdAt: string };
type WorshipDupGroup = { householdId: string; type: string; coreName: string; suggestedKeepId: string; records: WorshipRec[] };
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
    <main className="mx-auto max-w-5xl px-6 py-8 flex flex-col gap-8">
      <h1 className="text-lg text-ink">家戶資料整理</h1>
      <DevoteeExport />
      <BatchConfirmUs />
      <SponsorAudit />
      <ClearAllRice />
      <AddressAudit />
      <SoulNameAudit />
      <PurgeArchivedUsRecords />
      <BackfillCreditorUnborn />
      <BackfillCreditorUnbornYangshang />
      <WorshipDedup />
      <BackfillAddress />
      <MergeCheck />
      <HouseholdAddress />
      <ArchiveHouseholds />
      <PublicRegInit />
      <MasterOfferingInit />
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

type AddrRow = {
  entryId: string; householdId: string; categoryLabel: string; mainName: string; yangshang: string;
  printedAddress: string | null; worshipLocation: string | null; householdAddress: string | null; memberAddresses: string[];
  matchSource: string; suspicious: boolean; note: string;
};

type ArchiveRow = { code: string; found: boolean; householdName: string | null; memberNames: string[]; blockers: string[]; archivedMembers?: number; archivedHousehold?: boolean; error?: string };

function ArchiveHouseholds() {
  const [codesText, setCodesText] = useState("");
  const [report, setReport] = useState<{ rows: ArchiveRow[] } | null>(null);
  const [committed, setCommitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codes = codesText.split(/[\s,、，]+/).map((s) => s.trim()).filter(Boolean);

  async function run(commit: boolean) {
    if (codes.length === 0) { setError("請先輸入家戶編號（例如 F00884）。"); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetchRegistration(`/api/admin/universal-salvation/maintenance`, {
        method: "POST", body: JSON.stringify({ action: "archive-households", commit, confirm: commit, codes }),
      });
      const data = await res.json();
      if (!res.ok) { setError(toFriendlyError(res.status, data?.error)); return; }
      setReport(data.report); setCommitted(commit);
    } catch { setError("連線問題，請稍後再試。"); } finally { setBusy(false); }
  }

  return (
    <section className="rounded-2xl bg-white/70 p-5 shadow-card">
      <h2 className="text-base font-medium text-ink">封存家戶（依編號，可連同成員）</h2>
      <p className="mt-1 text-sm text-ink-soft">清掉之前混亂匯入自動生出來的空殼／重複家戶（例如 F00884、F00885）。<b>軟刪除、可從回收區還原</b>；有「草稿報名／未收款」的戶會擋下不動。</p>
      <textarea value={codesText} onChange={(e) => { setCodesText(e.target.value); setReport(null); setCommitted(false); }}
        placeholder="輸入家戶編號，多筆用空白或逗號分隔，例如：F00884 F00885"
        className="mt-3 w-full rounded-lg border border-mist-200 px-3 py-2 text-sm" rows={2} />
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy} onClick={() => run(false)} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">{busy ? "查詢中…" : "1) 預覽（看裡面有什麼）"}</button>
      </div>
      {error && <p className="mt-2 text-sm text-blossom-500">⚠️ {error}</p>}
      {report && (
        <div className="mt-3 text-sm flex flex-col gap-2">
          {report.rows.map((r) => (
            <div key={r.code} className="rounded-lg bg-cream-50 px-3 py-2 text-xs">
              <b className="text-ink">{r.code}</b>{r.householdName ? `｜${r.householdName}` : ""}
              {!r.found && <span className="text-blossom-500">｜查無此戶</span>}
              {r.found && <span className="text-ink-soft">｜成員 {r.memberNames.length} 位{r.memberNames.length ? `：${r.memberNames.join("、")}` : ""}</span>}
              {r.blockers.length > 0 && <span className="text-blossom-500">｜⚠️ {r.blockers.join("；")}</span>}
              {committed && r.archivedHousehold && <span className="text-emerald-700">｜✅ 已封存（成員 {r.archivedMembers} 位一併封存，可還原）</span>}
              {committed && r.error && <span className="text-blossom-500">｜{r.error}</span>}
            </div>
          ))}
          {!committed && report.rows.some((r) => r.found && r.blockers.length === 0) && (
            <button type="button" disabled={busy}
              onClick={() => { if (window.confirm(`確定封存這些家戶（含其成員）？可從回收區還原。`)) run(true); }}
              style={{ backgroundColor: "#c0392b", color: "#fff", opacity: busy ? 0.5 : 1 }}
              className="mt-1 self-start rounded-full px-5 py-2 text-sm font-semibold">
              {busy ? "封存中…" : "2) 確認封存（含成員，可還原）"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function PublicRegInit() {
  const { report, committed, busy, error, run } = useTool("init-public-reg-tables");
  return (
    <section className="rounded-2xl bg-white/70 p-5 shadow-card">
      <h2 className="text-base font-medium text-ink">信眾自動報名（新功能）· 建立資料表</h2>
      <p className="mt-1 text-sm text-ink-soft">按一下就會建立「信眾報名」要用的兩張<b>全新資料表</b>（純新增、不動也不會傷到任何現有資料，可重複按）。這是新功能上線的第一步；建好之後我才會接著做報名頁與後台。</p>
      <div className="mt-3">
        <button type="button" disabled={busy}
          onClick={() => { if (window.confirm("建立『信眾報名』的兩張新資料表？（只新增、不影響現有資料）")) run(true); }}
          style={{ backgroundColor: "#2f7d5b", color: "#fff", opacity: busy ? 0.5 : 1 }}
          className="rounded-full px-5 py-2 text-sm font-semibold">
          {busy ? "建立中…" : "建立信眾報名資料表"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-blossom-500">⚠️ {error}</p>}
      {report && committed && (
        <p className="mt-2 text-sm">{report.ok
          ? <span className="text-emerald-700">✅ 完成：兩張表已就緒（public_reg_forms、public_registrations）。{report.created ? "（本次新建）" : "（原本就有，未重複建立）"}</span>
          : <span className="text-blossom-500">⚠️ 尚未完成：{report.error ?? "請再試一次或回報我"}</span>}</p>
      )}
    </section>
  );
}

function DevoteeExport() {
  const [year, setYear] = useState(new Date().getFullYear() - 1911);
  return (
    <section className="rounded-2xl bg-white/70 p-5 shadow-card">
      <h2 className="text-base font-medium text-ink">信眾資料匯出（Excel）</h2>
      <p className="mt-1 text-sm text-ink-soft">匯出<b>全部信眾</b>：以戶為單位、每位成員一列，含祭祀資料（<b>永久供奉牌位</b>與<b>當年度普渡報名</b>）。當年度普渡報名的年度用下面這個。</p>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-sm text-ink-soft">普渡年度</span>
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || year)}
          className="w-24 rounded-full border border-mist-200 bg-white px-3 py-1.5 text-sm text-ink" />
        <a href={`/api/devotee-export?year=${year}`}
          className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-white">下載 Excel</a>
      </div>
    </section>
  );
}

function MasterOfferingInit() {
  const { report, committed, busy, error, run } = useTool("init-master-offering-table");
  return (
    <section className="rounded-2xl bg-white/70 p-5 shadow-card">
      <h2 className="text-base font-medium text-ink">供師活動 · 建立資料表</h2>
      <p className="mt-1 text-sm text-ink-soft">按一下建立「供師」名單要用的<b>全新資料表</b>（純新增、不影響現有資料、可重複按）。供師是普渡底下一份<b>不進財務</b>的名單（姓名＋金額＋繳費打勾）。建好後才能在報名頁與供師名單頁使用。</p>
      <div className="mt-3">
        <button type="button" disabled={busy}
          onClick={() => { if (window.confirm("建立『供師』資料表？（只新增、不影響現有資料）")) run(true); }}
          style={{ backgroundColor: "#2f7d5b", color: "#fff", opacity: busy ? 0.5 : 1 }}
          className="rounded-full px-5 py-2 text-sm font-semibold">
          {busy ? "建立中…" : "建立供師資料表"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-blossom-500">⚠️ {error}</p>}
      {report && committed && (
        <p className="mt-2 text-sm">{report.ok
          ? <span className="text-emerald-700">✅ 完成：供師資料表已就緒。{report.created ? "（本次新建）" : "（原本就有）"}</span>
          : <span className="text-blossom-500">⚠️ 尚未完成：{report.error ?? "請再試一次"}</span>}</p>
      )}
    </section>
  );
}

function AddressAudit() {
  const { report, busy, error, run } = useTool("address-audit");
  const [onlySus, setOnlySus] = useState(true);
  const rows: AddrRow[] = report?.rows ?? [];
  const shown = onlySus ? rows.filter((r) => r.suspicious) : rows;
  return (
    <section className="rounded-2xl bg-white/70 p-5 shadow-card">
      <h2 className="text-base font-medium text-ink">牌位地址逐筆對帳（唯讀）</h2>
      <p className="mt-1 text-sm text-ink-soft">把每張牌位「<b>印出來的地址</b>」跟它的各個來源（永久牌位安奉地／家戶地址／信眾地址）並排，一次揪出印錯的地址（例如印成香港）。<b>只看不改</b>；看到錯的再用下面的工具或到該戶去修。</p>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" disabled={busy} onClick={() => run(false)} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">{busy ? "查詢中…" : "查詢地址對帳"}</button>
        <label className="flex items-center gap-1 text-xs text-ink-soft"><input type="checkbox" checked={onlySus} onChange={(e) => setOnlySus(e.target.checked)} />只看可疑的</label>
      </div>
      {error && <p className="mt-2 text-sm text-blossom-500">⚠️ {error}</p>}
      {report && (
        <div className="mt-3 text-sm">
          <p className="text-ink">共 {report.total} 張牌位｜<b className="text-blossom-500">可疑 {report.suspiciousCount} 張</b>（缺地址／印的不是安奉地／來源對不上）。目前顯示 {shown.length} 張。</p>
          <div className="mt-2 max-h-[36rem] overflow-auto rounded-lg border border-mist-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-cream-100 text-ink-soft">
                <tr>
                  {["類別", "主文", "陽上人", "印出地址", "永久牌位安奉地", "家戶地址", "信眾地址", "來源／問題"].map((h) => (
                    <th key={h} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 400).map((r) => (
                  <tr key={r.entryId} className={r.suspicious ? "bg-blossom-50/60" : "odd:bg-white/40"}>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.categoryLabel}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.mainName}</td>
                    <td className="px-2 py-1.5">{r.yangshang || "—"}</td>
                    <td className="px-2 py-1.5 font-medium">{r.printedAddress || <span className="text-blossom-500">（空白）</span>}</td>
                    <td className="px-2 py-1.5 text-ink-soft">{r.worshipLocation || "—"}</td>
                    <td className="px-2 py-1.5 text-ink-soft">{r.householdAddress || "—"}</td>
                    <td className="px-2 py-1.5 text-ink-soft">{r.memberAddresses.join(" / ") || "—"}</td>
                    <td className="px-2 py-1.5 text-blossom-500">{r.suspicious ? r.note : r.matchSource}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length === 0 && <p className="mt-2 text-emerald-700">✅ 沒有可疑地址，很乾淨。</p>}
        </div>
      )}
    </section>
  );
}

function fmtTime(iso: string) {
  try { const d = new Date(iso); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
  catch { return iso; }
}

function WorshipDedup() {
  const [report, setReport] = useState<{ totalWorshipRecords: number; duplicateGroups: number; groups: WorshipDupGroup[]; archivedCount?: number } | null>(null);
  const [committed, setCommitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 每張牌位要不要留：key=牌位id，true=保留。預設＝每組最早那張。
  const [keep, setKeep] = useState<Record<string, boolean>>({});

  async function preview() {
    setBusy(true); setError(null); setCommitted(false);
    try {
      const res = await fetchRegistration(`/api/admin/universal-salvation/maintenance`, {
        method: "POST", body: JSON.stringify({ action: "worship-dedup", commit: false }),
      });
      const data = await res.json();
      if (!res.ok) { setError(toFriendlyError(res.status, data?.error)); return; }
      const rep = data.report as { groups: WorshipDupGroup[] };
      const init: Record<string, boolean> = {};
      for (const g of rep.groups) for (const r of g.records) init[r.id] = r.id === g.suggestedKeepId;
      setKeep(init); setReport(data.report);
    } catch { setError("連線問題，請稍後再試。"); } finally { setBusy(false); }
  }

  async function commit() {
    if (!report) return;
    const keepIds = Object.keys(keep).filter((id) => keep[id]);
    const archiveCount = report.groups.reduce((n, g) => n + g.records.filter((r) => !keep[r.id]).length, 0);
    if (archiveCount === 0) { window.alert("目前每一組你都全部保留，沒有要封存的牌位。"); return; }
    if (!window.confirm(`確定封存 ${archiveCount} 張沒有勾「保留」的牌位嗎？（是軟刪除，之後可以還原）`)) return;
    setBusy(true); setError(null);
    try {
      const res = await fetchRegistration(`/api/admin/universal-salvation/maintenance`, {
        method: "POST", body: JSON.stringify({ action: "worship-dedup", commit: true, confirm: true, keepIds }),
      });
      const data = await res.json();
      if (!res.ok) { setError(toFriendlyError(res.status, data?.error)); return; }
      setReport(data.report); setCommitted(true);
    } catch { setError("連線問題，請稍後再試。"); } finally { setBusy(false); }
  }

  const willArchive = report ? report.groups.reduce((n, g) => n + g.records.filter((r) => !keep[r.id]).length, 0) : 0;

  return (
    <section className="rounded-2xl bg-white/70 p-5 shadow-card">
      <h2 className="text-base font-medium text-ink">A. 永久牌位重複清理（逐張確認）</h2>
      <p className="mt-1 text-sm text-ink-soft">同一戶、同類別、同一位（主文相同）若被系統重複建了好幾張牌位，下面會<b>並排列出每一張的主文、陽上人、地址、建立時間</b>。系統會<b>預設幫你勾最早建立的那張</b>（通常是原本正確的）。你看過覺得沒問題就直接確認；如果同姓其實是不同支、要留多張，也可以自己多勾幾張。沒勾到的才會被封存（可還原）。冤親／無緣不受影響。</p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={preview} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">{busy ? "計算中…" : "1) 預覽（不寫入）"}</button>
      </div>
      {error && <p className="mt-2 text-sm text-blossom-500">⚠️ {error}</p>}
      {report && (
        <div className="mt-3 text-sm">
          <p className="text-ink">永久牌位共 {report.totalWorshipRecords} 張｜有重複的組別 {report.duplicateGroups} 組｜{committed ? `已封存 ${report.archivedCount ?? 0} 張` : `目前設定會封存 ${willArchive} 張`}</p>
          {committed && <p className="mt-1 text-emerald-700">✅ 已完成。可以再按一次「預覽」確認結果。</p>}
          {!committed && (
            <div className="mt-3 flex flex-col gap-4 max-h-[32rem] overflow-auto pr-1">
              {report.groups.map((g, gi) => (
                <div key={gi} className="rounded-xl border border-mist-200 bg-cream-50 p-3">
                  <p className="text-xs text-ink-soft">第 {gi + 1} 組｜家戶 {g.householdId}｜{g.type === "ANCESTOR_LINE" ? "歷代祖先" : "乙位正魂"}｜{g.coreName}</p>
                  <div className="mt-2 flex flex-col gap-2">
                    {g.records.map((r) => (
                      <label key={r.id} className={`flex items-start gap-2 rounded-lg px-2 py-2 cursor-pointer ${keep[r.id] ? "bg-emerald-50 ring-1 ring-emerald-300" : "bg-white/70"}`}>
                        <input type="checkbox" className="mt-0.5" checked={!!keep[r.id]} onChange={(e) => setKeep((k) => ({ ...k, [r.id]: e.target.checked }))} />
                        <span className="text-xs leading-relaxed">
                          <b className="text-ink">{keep[r.id] ? "保留" : "封存"}</b>
                          {r.id === g.suggestedKeepId && <span className="ml-1 text-emerald-700">（系統建議留這張）</span>}
                          <br />主文：{r.displayName || "（空）"}
                          <br />陽上人：{r.yangshang || "（空）"}
                          <br />地址：{r.location || "（空）"}
                          <br />建立時間：{fmtTime(r.createdAt)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!committed && report.duplicateGroups > 0 && (
            <button type="button" disabled={busy} onClick={commit}
              style={{ backgroundColor: "#c0392b", color: "#fff", opacity: busy ? 0.5 : 1 }}
              className="mt-4 rounded-full px-5 py-2 text-sm font-semibold">
              {busy ? "封存中…" : `2) 確認封存（沒勾保留的 ${willArchive} 張）`}
            </button>
          )}
          {!committed && report.duplicateGroups === 0 && <p className="mt-2 text-emerald-700">✅ 沒有發現重複的永久牌位，很乾淨。</p>}
        </div>
      )}
    </section>
  );
}

type CreditorUnbornChange = { entryId: string; householdId: string; category: string; displayName: string; yangshang: string | null; newAddress: string; source: string };

type PurgeRow = { ritualRecordId: string; householdId: string; householdName: string | null; year: number; eligible: boolean; blocker: string | null; removed?: boolean };

type BatchConfirmRow = { ritualRecordId: string; householdId: string; householdName: string | null; summary: string; participantCount: number; willAddParticipant: string | null; canConfirm: boolean; reason: string | null; confirmed?: boolean };

function BatchConfirmUs() {
  const { report, committed, busy, error, run } = useTool("batch-confirm-us");
  const rows: BatchConfirmRow[] = report?.rows ?? [];
  return (
    <section className="rounded-2xl bg-white/70 p-5 shadow-card">
      <h2 className="text-base font-medium text-ink">一鍵批次確認（草稿→正式）</h2>
      <p className="mt-1 text-sm text-ink-soft">把本年度「<b>有內容但還停在草稿</b>」的普渡報名一次確認轉正式。下面會列出<b>每一筆的報名內容明細</b>供核對。缺報名成員的會<b>自動帶入戶長</b>當報名成員（明細會標示）。已收款／已列印不影響。<b>核對好手寫本後再按確認。</b></p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={() => run(false)} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">{busy ? "計算中…" : "1) 預覽明細（看每一筆內容）"}</button>
      </div>
      {error && <p className="mt-2 text-sm text-blossom-500">⚠️ {error}</p>}
      {report && (
        <div className="mt-3 text-sm">
          <p className="text-ink">草稿共 {report.totalDraft} 筆｜{committed ? `已確認 ${report.confirmed}` : `可確認 ${report.confirmable}`} 筆｜略過 {rows.length - report.confirmable} 筆</p>
          <ul className="mt-2 max-h-96 overflow-auto text-xs flex flex-col gap-1">
            {rows.slice(0, 400).map((r) => (
              <li key={r.ritualRecordId} className={`rounded px-2 py-1.5 ${r.canConfirm ? "bg-cream-50" : "bg-blossom-50"}`}>
                <div>
                  <a href={`/household/${r.householdId}`} className="text-blossom-500 underline">{r.householdId}</a>
                  <span className="text-ink">{r.householdName ? `（${r.householdName}）` : ""}</span>
                  <span className="text-ink-soft"> ｜ {r.summary}</span>
                </div>
                <div className="mt-0.5 text-ink-faint">
                  報名成員：{r.participantCount} 位
                  {r.willAddParticipant && <span className="text-emerald-700">（確認時自動帶入戶長「{r.willAddParticipant}」）</span>}
                  {r.confirmed && <span className="text-emerald-700"> ｜✅ 已確認</span>}
                  {!r.canConfirm && <span className="text-blossom-500"> ｜略過：{r.reason}</span>}
                </div>
              </li>
            ))}
          </ul>
          {!committed && report.confirmable > 0 && (
            <button type="button" disabled={busy}
              onClick={() => { if (window.confirm(`確定把 ${report.confirmable} 筆有效草稿一次確認轉正式？（缺成員者自動帶入戶長；已核對手寫本）`)) run(true); }}
              style={{ backgroundColor: "#c0392b", color: "#fff", opacity: busy ? 0.5 : 1 }}
              className="mt-3 rounded-full px-5 py-2 text-sm font-semibold">
              {busy ? "確認中…" : `2) 確認轉正式（${report.confirmable} 筆）`}
            </button>
          )}
          {committed && <p className="mt-2 text-emerald-700">✅ 已確認 {report.confirmed} 筆轉正式。</p>}
          {report.totalDraft === 0 && <p className="mt-2 text-emerald-700">✅ 沒有停在草稿的普渡報名。</p>}
        </div>
      )}
    </section>
  );
}

type SponsorAuditRow = {
  itemId: string; key: string; label: string; buyerName: string | null;
  householdCode: string | null; householdName: string | null; quantity: number;
  amountDue: number; amountPaid: number; status: string; isDeleted: boolean;
  deletedByName: string | null; createdAt: string; restorable: boolean;
};

function SponsorAudit() {
  const [query, setQuery] = useState("");
  const [report, setReport] = useState<{ total: number; rows: SponsorAuditRow[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function search() {
    setBusy(true); setError(null); setMsg(null);
    try {
      const res = await fetchRegistration(`/api/admin/universal-salvation/maintenance`, {
        method: "POST", body: JSON.stringify({ action: "sponsor-audit", query }),
      });
      const data = await res.json();
      if (!res.ok) { setError(toFriendlyError(res.status, data?.error)); return; }
      setReport(data.report);
    } catch { setError("連線問題，請稍後再試。"); } finally { setBusy(false); }
  }
  async function restore(r: SponsorAuditRow) {
    if (!window.confirm(`確定還原「${r.buyerName ?? "（無名）"}」的${r.label}（${r.amountDue} 元）？還原後會回到正式名單。`)) return;
    setRestoring(r.itemId); setError(null); setMsg(null);
    try {
      const res = await fetchRegistration(`/api/admin/universal-salvation/maintenance`, {
        method: "POST", body: JSON.stringify({ action: "restore-sponsor-item", itemId: r.itemId, commit: true, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) { setError(toFriendlyError(res.status, data?.error)); return; }
      setMsg(`已還原「${r.buyerName ?? "（無名）"}」的${r.label}。`);
      await search();
    } catch { setError("還原失敗，請稍後再試。"); } finally { setRestoring(null); }
  }

  const statusZh = (r: SponsorAuditRow) =>
    r.isDeleted ? "已刪除" : r.status === "CANCELLED" ? "已取消" : r.status === "CONFIRMED" ? "正式" : r.status === "DRAFT" ? "草稿" : r.status;

  return (
    <section className="rounded-2xl bg-white/70 p-5 shadow-card">
      <h2 className="text-base font-medium text-ink">贊普認購人查詢／還原</h2>
      <p className="mt-1 text-sm text-ink-soft">舊版贊普是「<b>一戶只留一筆</b>」，同戶報第二個認購人時會把前一筆<b>蓋掉／取消</b>，認購人就「消失」了。這裡輸入<b>認購人名字、戶名或戶號</b>，把符合的<b>所有</b>贊普／隨喜贊普都列出來（含<b>已取消／已刪除</b>）。被系統誤刪、未收款的可以<b>一鍵還原</b>回名單。<br/><span className="text-ink-faint">（註：若當初是「同一筆一直被改名」覆蓋掉，舊名字沒有留存、無法還原，需重新報名。）</span></p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }}
          placeholder="認購人名字／戶名／戶號（留空＝全部贊普）"
          className="rounded-full border border-mist-200 bg-white px-4 py-1.5 text-sm text-ink w-72" />
        <button type="button" disabled={busy} onClick={search} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">{busy ? "查詢中…" : "查詢"}</button>
      </div>
      {error && <p className="mt-2 text-sm text-blossom-500">⚠️ {error}</p>}
      {msg && <p className="mt-2 text-sm text-emerald-700">{msg}</p>}
      {report && (
        <div className="mt-3 text-sm">
          <p className="text-ink">共 {report.total} 筆（含已取消／已刪除）｜可還原 <b className="text-blossom-500">{report.rows.filter((r) => r.restorable).length}</b> 筆。</p>
          <ul className="mt-2 max-h-96 overflow-auto text-xs flex flex-col gap-1">
            {report.rows.map((r) => (
              <li key={r.itemId} className={`rounded px-2 py-2 flex flex-wrap items-center justify-between gap-2 ${r.isDeleted || r.status === "CANCELLED" ? "bg-blossom-50" : "bg-cream-50"}`}>
                <span>
                  <b className="text-ink">{r.buyerName ?? "（無名）"}</b>
                  <span className="text-ink-faint"> ｜{r.label}×{r.quantity}｜{r.amountDue} 元</span>
                  {r.householdCode && <span className="text-ink-faint"> ｜戶 {r.householdCode}{r.householdName ? `（${r.householdName}）` : ""}</span>}
                  <span className={r.isDeleted || r.status === "CANCELLED" ? "text-blossom-500" : "text-emerald-700"}> ｜{statusZh(r)}</span>
                  {r.amountPaid > 0 && <span className="text-emerald-700"> ｜已收 {r.amountPaid}</span>}
                </span>
                {r.restorable && (
                  <button type="button" disabled={restoring === r.itemId} onClick={() => restore(r)}
                    style={{ backgroundColor: "#2f7d5b", color: "#fff", opacity: restoring === r.itemId ? 0.5 : 1 }}
                    className="rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap">
                    {restoring === r.itemId ? "還原中…" : "一鍵還原"}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {report.total === 0 && <p className="mt-2 text-ink-soft">查無符合的贊普。</p>}
        </div>
      )}
    </section>
  );
}

function ClearAllRice() {
  const { report, committed, busy, error, run } = useTool("clear-all-rice");
  return (
    <section className="rounded-2xl bg-white/70 p-5 shadow-card">
      <h2 className="text-base font-medium text-ink">白米全部清空（重做用）</h2>
      <p className="mt-1 text-sm text-ink-soft">把本年度<b>所有白米報名一次清空</b>（軟刪除、可從回收區還原），清完再用「現場快速報名」重報。<b>已收款的不動</b>（避免帳務對不上）。先按預覽看會清幾筆，再確認。</p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={() => run(false)} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">{busy ? "計算中…" : "1) 預覽（看會清幾筆）"}</button>
      </div>
      {error && <p className="mt-2 text-sm text-blossom-500">⚠️ {error}</p>}
      {report && (
        <div className="mt-3 text-sm">
          <p className="text-ink">目前有效白米 {report.matched} 筆｜{committed ? `已清空 ${report.cleared}` : `將清空 ${report.matched - report.skippedPaid}`} 筆｜已收款略過 {report.skippedPaid} 筆</p>
          {!committed && (report.matched - report.skippedPaid) > 0 && (
            <button type="button" disabled={busy}
              onClick={() => { if (window.confirm(`確定清空 ${report.matched - report.skippedPaid} 筆白米報名？（軟刪除、可還原；已收款不動）`)) run(true); }}
              style={{ backgroundColor: "#c0392b", color: "#fff", opacity: busy ? 0.5 : 1 }}
              className="mt-3 rounded-full px-5 py-2 text-sm font-semibold">
              {busy ? "清空中…" : `2) 全部清空（${report.matched - report.skippedPaid} 筆）`}
            </button>
          )}
          {committed && <p className="mt-2 text-emerald-700">✅ 已清空 {report.cleared} 筆白米，可以開始重報了。</p>}
          {report.matched === 0 && <p className="mt-2 text-ink-soft">目前沒有白米報名。</p>}
        </div>
      )}
    </section>
  );
}

type SoulNameRow = { source: string; id: string; householdId: string | null; displayName: string; location: string | null; yangshang: string | null };

function SoulNameAudit() {
  const { report, busy, error, run } = useTool("soul-name-audit");
  const rows: SoulNameRow[] = report?.suspicious ?? [];
  const [converting, setConverting] = useState<string | null>(null);
  const [convMsg, setConvMsg] = useState<string | null>(null);
  const [convErr, setConvErr] = useState<string | null>(null);

  async function convert(r: SoulNameRow) {
    if (!window.confirm(`確定把「${r.displayName}乙位正魂」轉成「${r.displayName}歷代祖先」？（保留地址／陽上人；可再查詢確認）`)) return;
    setConverting(r.id); setConvErr(null); setConvMsg(null);
    try {
      const res = await fetchRegistration(`/api/admin/universal-salvation/maintenance`, {
        method: "POST", body: JSON.stringify({ action: "convert-soul-to-ancestor", id: r.id, source: r.source, commit: true, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) { setConvErr(toFriendlyError(res.status, data?.error)); return; }
      setConvMsg(`已把「${r.displayName}乙位正魂」轉成歷代祖先。`);
      await run(false);
    } catch { setConvErr("轉換失敗，請稍後再試。"); } finally { setConverting(null); }
  }
  return (
    <section className="rounded-2xl bg-white/70 p-5 shadow-card">
      <h2 className="text-base font-medium text-ink">乙位正魂命名檢查（找「某姓乙位正魂」）</h2>
      <p className="mt-1 text-sm text-ink-soft">乙位正魂是<b>個人往生者</b>，主文應是<b>全名</b>（例：溫崇仁乙位正魂）；如果被命成「陳姓」這種只有姓的祖先式命名（顯示成「陳姓乙位正魂」），多半是類別選錯或名字打錯。這裡把可疑的一次列出來（<b>只看不改</b>），你到該戶用「編輯」修正，或改成歷代祖先。</p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={() => run(false)} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">{busy ? "查詢中…" : "查詢可疑命名"}</button>
      </div>
      {error && <p className="mt-2 text-sm text-blossom-500">⚠️ {error}</p>}
      {convMsg && <p className="mt-2 text-sm text-emerald-700">{convMsg}</p>}
      {convErr && <p className="mt-2 text-sm text-blossom-500">⚠️ {convErr}</p>}
      {report && (
        <div className="mt-3 text-sm">
          <p className="text-ink">乙位正魂共 {report.totalSouls} 筆｜<b className="text-blossom-500">可疑 {rows.length} 筆</b>（主文以「姓」結尾或只有一個字）。可直接按「轉成歷代祖先」一鍵更正。</p>
          <ul className="mt-2 max-h-80 overflow-auto text-xs text-ink-soft flex flex-col gap-1">
            {rows.map((r) => (
              <li key={r.id} className="rounded bg-blossom-50 px-2 py-2 flex flex-wrap items-center justify-between gap-2">
                <span>
                  <b className="text-ink">{r.displayName}乙位正魂</b>
                  <span className="text-ink-faint">（{r.source}）</span>
                  {r.householdId && <> ｜家戶 <a href={`/household/${r.householdId}`} className="text-blossom-500 underline">{r.householdId}</a></>}
                  {r.yangshang && <> ｜陽上：{r.yangshang}</>}
                  {r.location && <> ｜安奉地：{r.location}</>}
                </span>
                <button type="button" disabled={converting === r.id} onClick={() => convert(r)}
                  style={{ backgroundColor: "#2f7d5b", color: "#fff", opacity: converting === r.id ? 0.5 : 1 }}
                  className="rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap">
                  {converting === r.id ? "轉換中…" : "轉成歷代祖先"}
                </button>
              </li>
            ))}
          </ul>
          {rows.length === 0 && !error && <p className="mt-2 text-emerald-700">✅ 沒有可疑的乙位正魂命名，很乾淨。</p>}
        </div>
      )}
    </section>
  );
}

function PurgeArchivedUsRecords() {
  const { report, committed, busy, error, run } = useTool("purge-archived-us-records");
  const rows: PurgeRow[] = report?.rows ?? [];
  const eligible = rows.filter((r) => r.eligible);
  return (
    <section className="rounded-2xl bg-white/70 p-5 shadow-card">
      <h2 className="text-base font-medium text-ink">收回「已封存家戶」還留著的普渡報名</h2>
      <p className="mt-1 text-sm text-ink-soft">封存家戶時，底下的普渡報名沒有一起收，會造成「列印看不到、但<b>報名名單／總數還算得到</b>」。這裡把<b>已封存家戶</b>底下還開著的報名一次收乾淨——收完列印、名單、總數就一致。<b>只收未收款、未列印</b>的（有收款/列印會擋下不動）；軟刪、可從回收區還原。<br/><span className="text-ink-faint">（往後用「封存家戶（依編號）」封存時，會自動一起收，不用再跑這個。）</span></p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={() => run(false)} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">{busy ? "查詢中…" : "1) 預覽（看有哪些）"}</button>
      </div>
      {error && <p className="mt-2 text-sm text-blossom-500">⚠️ {error}</p>}
      {report && (
        <div className="mt-3 text-sm">
          <p className="text-ink">已封存家戶還開著的普渡報名 {rows.length} 筆｜{committed ? `已收回 ${report.removed}` : `可收回 ${eligible.length}`} 筆</p>
          <ul className="mt-2 max-h-72 overflow-auto text-xs text-ink-soft flex flex-col gap-1">
            {rows.map((r) => (
              <li key={r.ritualRecordId} className="rounded bg-cream-50 px-2 py-1">
                {r.householdId}{r.householdName ? `（${r.householdName}）` : ""}｜民國 {r.year} 年
                {r.eligible ? <span className="text-emerald-700">｜可收回</span> : <span className="text-blossom-500">｜擋下：{r.blocker}</span>}
                {committed && r.removed && <span className="text-emerald-700">｜✅ 已收回（可還原）</span>}
              </li>
            ))}
          </ul>
          {!committed && eligible.length > 0 && (
            <button type="button" disabled={busy}
              onClick={() => { if (window.confirm(`確定收回 ${eligible.length} 筆已封存家戶的普渡報名？（軟刪、可還原；列印/名單/總數會一起少掉）`)) run(true); }}
              style={{ backgroundColor: "#c0392b", color: "#fff", opacity: busy ? 0.5 : 1 }}
              className="mt-3 rounded-full px-5 py-2 text-sm font-semibold">
              {busy ? "收回中…" : `2) 確認收回（${eligible.length} 筆）`}
            </button>
          )}
          {rows.length === 0 && !error && <p className="mt-2 text-emerald-700">✅ 沒有殘留：已封存家戶底下都沒有還開著的普渡報名。</p>}
        </div>
      )}
    </section>
  );
}

function BackfillCreditorUnborn() {
  const { report, committed, busy, error, run } = useTool("backfill-creditor-unborn-address");
  const changes: CreditorUnbornChange[] = report?.changes ?? [];
  return (
    <section className="rounded-2xl bg-white/70 p-5 shadow-card">
      <h2 className="text-base font-medium text-ink">冤親／無緣 空白地址回填</h2>
      <p className="mt-1 text-sm text-ink-soft">把本年度<b>冤親（累世冤親債主）／無緣子女／地基主</b>目前<b>空白</b>的牌位地址一次補上（例：許佩瑜冤親、馮是嘉無緣）。來源＝<b>陽上人個人地址 → 家戶地址</b>。不用刪掉重報；只補空白、不動已有地址、不動收款。</p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={() => run(false)} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">{busy ? "計算中…" : "1) 預覽（不寫入）"}</button>
      </div>
      {error && <p className="mt-2 text-sm text-blossom-500">⚠️ {error}</p>}
      {report && (
        <div className="mt-3 text-sm">
          <p className="text-ink">目前空白 {report.totalBlank} 張｜{committed ? "已補上" : "可補上"} {changes.length} 張｜仍無來源 {report.stillBlank} 張</p>
          <ul className="mt-2 max-h-72 overflow-auto text-xs text-ink-soft flex flex-col gap-1">
            {changes.slice(0, 300).map((c) => (
              <li key={c.entryId} className="rounded bg-cream-50 px-2 py-1">
                {c.householdId}・{c.category === "DEBT_CREDITOR" ? "冤親" : "無緣/地基主"}｜陽上人：{c.yangshang || "（空）"} → <b>{c.newAddress}</b>　<span className="text-ink-faint">（{c.source}）</span>
              </li>
            ))}
          </ul>
          {!committed && changes.length > 0 && (
            <button type="button" disabled={busy}
              onClick={() => { if (window.confirm(`確定回填 ${changes.length} 張冤親／無緣牌位的地址？只補空白，可再預覽確認。`)) run(true); }}
              style={{ backgroundColor: "#c0392b", color: "#fff", opacity: busy ? 0.5 : 1 }}
              className="mt-3 rounded-full px-5 py-2 text-sm font-semibold">
              {busy ? "回填中…" : `2) 確認回填（${changes.length} 張）`}
            </button>
          )}
          {changes.length === 0 && !error && <p className="mt-2 text-emerald-700">✅ 沒有空白的冤親／無緣地址（或都已補齊）。</p>}
        </div>
      )}
    </section>
  );
}

type YangChange = { entryId: string; householdId: string | null; category: string; displayName: string; newYangshang: string; source: string };

function BackfillCreditorUnbornYangshang() {
  const { report, committed, busy, error, run } = useTool("backfill-creditor-unborn-yangshang");
  const changes: YangChange[] = report?.changes ?? [];
  return (
    <section className="rounded-2xl bg-white/70 p-5 shadow-card">
      <h2 className="text-base font-medium text-ink">冤親／無緣 空白陽上人回填</h2>
      <p className="mt-1 text-sm text-ink-soft">把本年度<b>冤親／無緣子女／地基主</b>目前<b>陽上人空白</b>的牌位補上（例：馮是嘉的無緣，地址有、陽上人空）。來源＝<b>該筆的報名人</b>。不用刪掉重報；只補空白、不動已有的、不動地址／收款。</p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={() => run(false)} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">{busy ? "計算中…" : "1) 預覽（不寫入）"}</button>
      </div>
      {error && <p className="mt-2 text-sm text-blossom-500">⚠️ {error}</p>}
      {report && (
        <div className="mt-3 text-sm">
          <p className="text-ink">陽上人目前空白 {report.totalBlank} 張｜{committed ? "已補上" : "可補上"} {changes.length} 張｜仍無來源 {report.stillBlank} 張</p>
          <ul className="mt-2 max-h-72 overflow-auto text-xs text-ink-soft flex flex-col gap-1">
            {changes.slice(0, 300).map((c) => (
              <li key={c.entryId} className="rounded bg-cream-50 px-2 py-1">
                {c.householdId ?? "—"}｜{c.category === "DEBT_CREDITOR" ? "冤親" : "無緣/地基主"}｜陽上人 →<b>{c.newYangshang}</b>　<span className="text-ink-faint">（{c.source}）</span>
              </li>
            ))}
          </ul>
          {!committed && changes.length > 0 && (
            <button type="button" disabled={busy}
              onClick={() => { if (window.confirm(`確定回填 ${changes.length} 張冤親／無緣牌位的陽上人？只補空白，可再預覽確認。`)) run(true); }}
              style={{ backgroundColor: "#c0392b", color: "#fff", opacity: busy ? 0.5 : 1 }}
              className="mt-3 rounded-full px-5 py-2 text-sm font-semibold">
              {busy ? "回填中…" : `2) 確認回填（${changes.length} 張）`}
            </button>
          )}
          {changes.length === 0 && !error && <p className="mt-2 text-emerald-700">✅ 沒有空白的冤親／無緣陽上人（或都已補齊）。</p>}
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
      <p className="mt-1 text-sm text-ink-soft">把本年度普渡牌位的安奉地，一次對齊成「同家戶＋同姓」那張<b>永久牌位</b>的地址。修正匯入時抓成戶籍地（新北）而非安奉地（雲林）的問題。<b>不用重匯</b>。<br/><span className="text-blossom-500">※ 這個工具只處理「歷代祖先／乙位正魂」（只有這兩類有永久牌位安奉地）。冤親／無緣不在這裡，但一樣會照常列印。</span></p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={() => run(false)} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">{busy ? "計算中…" : "1) 預覽（不寫入）"}</button>
      </div>
      {error && <p className="mt-2 text-sm text-blossom-500">⚠️ {error}</p>}
      {report && (
        <div className="mt-3 text-sm">
          <p className="text-ink">祖先／正魂牌位 {report.totalEntries} 張（不含冤親／無緣）｜{committed ? "已更新" : "預計更新"} {report.changes.length} 張｜永久牌位查無對應 {report.noWorshipMatch} 張</p>
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
