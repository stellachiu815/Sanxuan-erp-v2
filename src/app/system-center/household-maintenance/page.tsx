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
      <AddressAudit />
      <WorshipDedup />
      <BackfillAddress />
      <MergeCheck />
      <HouseholdAddress />
      <PublicRegInit />
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
