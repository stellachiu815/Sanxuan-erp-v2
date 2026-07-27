"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useOperator } from "@/lib/operatorClient";
import { canSystem } from "@/lib/permissions";

/**
 * V19「驗收／健康檢查中心」畫面（只讀）。
 * 一鍵掃描；每筆問題以「可理解、可追查、可處理」呈現：人可讀摘要、相關資料欄位、
 * 問題原因、可能影響、建議處理方式、可直接前往的處理入口；技術 ID 放折疊區。
 * 統計卡可點擊篩選；錯誤與警告優先；PASS 不預設展開明細。不提供自動修復。
 */

type Severity = "PASS" | "WARNING" | "ERROR" | "UNKNOWN";
type DetailField = { label: string; value: string };
type DetailLink = { label: string; href: string };
type DetailRow = { title: string; fields: DetailField[]; links: DetailLink[]; techIds: string[] };
type Finding = {
  code: string;
  name: string;
  module: string;
  severity: Severity;
  summary: string;
  cause: string;
  impact: string;
  recommendation: string;
  affectedCount: number;
  rows: DetailRow[];
};
type ScanResult = {
  ranAt: string;
  findings: Finding[];
  summary: {
    total: number;
    bySeverity: Record<Severity, number>;
    byModule: Record<string, { pass: number; warning: number; error: number; unknown: number }>;
  };
};

const MODULE_LABEL: Record<string, string> = {
  ACTIVITY: "活動",
  REGISTRATION: "報名",
  RICE: "白米",
  FINANCE: "財務",
  PRINT: "列印",
  DEVOTEE: "信眾",
  HOUSEHOLD: "家戶",
  TRANSACTION: "交易收據",
  SECURITY: "帳號權限",
  SYSTEM: "系統設定",
};
const SEVERITY_LABEL: Record<Severity, string> = { PASS: "通過", WARNING: "警告", ERROR: "錯誤", UNKNOWN: "無法自動判斷" };
const SEVERITY_TONE: Record<Severity, string> = {
  PASS: "bg-sage-100 text-ink-soft",
  WARNING: "bg-yolk-100 text-ink",
  ERROR: "bg-blossom-100 text-blossom-500",
  UNKNOWN: "bg-cream-200 text-ink-faint",
};
const ROWS_STEP = 10;

export default function AcceptanceScanScreen() {
  const { operatorUser, operatorUserId, loading } = useOperator();
  const [data, setData] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moduleFilter, setModuleFilter] = useState<string>("ALL");
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [shownRows, setShownRows] = useState<Record<string, number>>({});
  const [openTech, setOpenTech] = useState<Record<string, boolean>>({});

  const canScan = !!operatorUser?.role && canSystem(operatorUser.role, "runAcceptanceScan");

  async function runScan() {
    if (!operatorUserId) return;
    setScanning(true);
    setError(null);
    setExpanded({});
    setShownRows({});
    try {
      const res = await fetch(`/api/system-center/acceptance-scan?operatorUserId=${encodeURIComponent(operatorUserId)}`);
      const d = await res.json();
      if (!res.ok) {
        setError(d?.error ?? "掃描失敗");
        return;
      }
      setData(d);
    } catch {
      setError("無法連線到伺服器。");
    } finally {
      setScanning(false);
    }
  }

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.findings.filter(
      (f) => (moduleFilter === "ALL" || f.module === moduleFilter) && (severityFilter === "ALL" || f.severity === severityFilter)
    );
  }, [data, moduleFilter, severityFilter]);

  if (loading) return <p className="text-sm text-ink-faint">載入中…</p>;
  if (!canScan)
    return (
      <div className="rounded-3xl bg-blossom-100 p-6 text-sm text-ink">
        您目前的角色沒有執行驗收／健康檢查的權限（僅限最高管理員與管理員）。
      </div>
    );

  const sev = data?.summary.bySeverity;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl bg-white/70 p-6 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-medium text-ink">ERP 驗收／健康檢查</h2>
            <p className="mt-1 text-xs text-ink-faint">
              一鍵只讀掃描全系統資料完整性與流程串接；不會修改任何正式資料、金額、列印次數或交易狀態，也不會自動修復。
            </p>
          </div>
          <button
            type="button"
            onClick={runScan}
            disabled={scanning}
            className="min-h-11 rounded-full bg-sage-200 px-5 py-2 text-sm font-medium text-ink transition hover:bg-sage-300 disabled:opacity-40"
          >
            {scanning ? "掃描中…" : data ? "重新掃描" : "開始完整掃描"}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-blossom-500">{error}</p>}
        {data && <p className="mt-3 text-xs text-ink-faint">掃描時間：{new Date(data.ranAt).toLocaleString("zh-Hant")}</p>}
      </div>

      {data && sev && (
        <>
          {/* 全系統摘要（可點擊篩選） */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(["ERROR", "WARNING", "UNKNOWN", "PASS"] as Severity[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeverityFilter(severityFilter === s ? "ALL" : s)}
                className={`rounded-2xl p-4 text-left transition ${SEVERITY_TONE[s]} ${severityFilter === s ? "ring-2 ring-ink/30" : ""}`}
              >
                <p className="text-xs">{SEVERITY_LABEL[s]}</p>
                <p className="text-2xl font-medium">{sev[s]}</p>
              </button>
            ))}
          </div>

          {/* 篩選 */}
          <div className="flex flex-wrap items-center gap-2">
            <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className="min-h-[40px] rounded-xl border border-cream-200 bg-cream-50 px-3 py-2 text-sm">
              <option value="ALL">全部模組</option>
              {Object.keys(MODULE_LABEL).map((m) => (
                <option key={m} value={m}>
                  {MODULE_LABEL[m]}
                </option>
              ))}
            </select>
            <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} className="min-h-[40px] rounded-xl border border-cream-200 bg-cream-50 px-3 py-2 text-sm">
              <option value="ALL">全部嚴重程度</option>
              {(["ERROR", "WARNING", "UNKNOWN", "PASS"] as Severity[]).map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_LABEL[s]}
                </option>
              ))}
            </select>
            {(moduleFilter !== "ALL" || severityFilter !== "ALL") && (
              <button type="button" onClick={() => { setModuleFilter("ALL"); setSeverityFilter("ALL"); }} className="text-xs text-ink-faint underline-offset-4 hover:underline">
                清除篩選
              </button>
            )}
          </div>

          {/* 各模組統計 */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {Object.entries(data.summary.byModule).map(([m, c]) => (
              <button
                key={m}
                type="button"
                onClick={() => setModuleFilter(moduleFilter === m ? "ALL" : m)}
                className={`rounded-2xl bg-cream-50 p-3 text-left text-xs text-ink-soft transition hover:bg-cream-100 ${moduleFilter === m ? "ring-2 ring-ink/20" : ""}`}
              >
                <p className="font-medium text-ink">{MODULE_LABEL[m] ?? m}</p>
                <p className="mt-1">錯誤 {c.error}・警告 {c.warning}・待確認 {c.unknown}・通過 {c.pass}</p>
              </button>
            ))}
          </div>

          {/* 問題清單（錯誤／警告優先，伺服器已排序） */}
          <div className="flex flex-col gap-2">
            {filtered.map((f) => {
              const isOpen = expanded[f.code] ?? false;
              const shown = shownRows[f.code] ?? ROWS_STEP;
              const hasDetail = f.affectedCount > 0 || f.severity === "UNKNOWN";
              return (
                <div key={f.code} className="rounded-2xl bg-white/70 p-4 shadow-soft">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs ${SEVERITY_TONE[f.severity]}`}>{SEVERITY_LABEL[f.severity]}</span>
                    <span className="rounded-full bg-mist-100 px-2.5 py-0.5 text-xs text-ink-soft">{MODULE_LABEL[f.module] ?? f.module}</span>
                    <span className="font-mono text-xs text-ink-faint">{f.code}</span>
                    <span className="text-sm font-medium text-ink">{f.name}</span>
                    {f.affectedCount > 0 && <span className="ml-auto text-xs text-ink-soft">影響 {f.affectedCount} 筆</span>}
                  </div>

                  {/* 人可讀摘要（主要資訊） */}
                  <p className="mt-2 text-sm text-ink">{f.summary}</p>

                  {hasDetail && (
                    <button
                      type="button"
                      onClick={() => setExpanded((s) => ({ ...s, [f.code]: !isOpen }))}
                      className="mt-2 text-xs text-ink-soft underline-offset-4 hover:underline"
                    >
                      {isOpen ? "收合詳細資料" : "查看詳細資料"}
                    </button>
                  )}

                  {isOpen && (
                    <div className="mt-3 flex flex-col gap-3">
                      {f.cause && <p className="text-xs text-ink-soft"><span className="font-medium text-ink">問題原因：</span>{f.cause}</p>}
                      {f.impact && <p className="text-xs text-ink-soft"><span className="font-medium text-ink">可能影響：</span>{f.impact}</p>}
                      {f.recommendation && <p className="text-xs text-ink-soft"><span className="font-medium text-ink">建議處理：</span>{f.recommendation}</p>}

                      {/* 逐筆明細（前 10，可顯示更多） */}
                      {f.rows.slice(0, shown).map((row, idx) => (
                        <div key={idx} className="rounded-xl bg-cream-50 p-3">
                          <p className="text-sm font-medium text-ink">{row.title}</p>
                          {row.fields.length > 0 && (
                            <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                              {row.fields.map((fld, i) => (
                                <div key={i} className="flex gap-1 text-xs">
                                  <dt className="text-ink-faint">{fld.label}：</dt>
                                  <dd className="text-ink-soft">{fld.value}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                          {row.links.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {row.links.map((lk, i) => (
                                <Link key={i} href={lk.href} className="rounded-full bg-white px-3 py-1 text-xs text-ink-soft shadow-soft transition hover:bg-mist-50">
                                  {lk.label} →
                                </Link>
                              ))}
                            </div>
                          )}
                          {row.techIds.length > 0 && (
                            <div className="mt-2">
                              <button type="button" onClick={() => setOpenTech((s) => ({ ...s, [`${f.code}:${idx}`]: !s[`${f.code}:${idx}`] }))} className="text-[11px] text-ink-faint underline-offset-4 hover:underline">
                                {openTech[`${f.code}:${idx}`] ? "隱藏技術資料" : "技術資料"}
                              </button>
                              {openTech[`${f.code}:${idx}`] && <p className="mt-1 break-all font-mono text-[11px] text-ink-faint">{row.techIds.join("、")}</p>}
                            </div>
                          )}
                        </div>
                      ))}
                      {f.rows.length > shown && (
                        <button type="button" onClick={() => setShownRows((s) => ({ ...s, [f.code]: shown + ROWS_STEP }))} className="text-xs text-ink-soft underline-offset-4 hover:underline">
                          顯示更多（還有 {f.rows.length - shown} 筆，總影響 {f.affectedCount} 筆）
                        </button>
                      )}
                      {f.affectedCount > f.rows.length && (
                        <p className="text-[11px] text-ink-faint">＊為效能考量，明細最多顯示前 {f.rows.length} 筆；其餘請依建議處理後重新掃描。</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && <p className="text-sm text-ink-faint">沒有符合條件的項目。</p>}
          </div>
        </>
      )}

      {!data && !scanning && <p className="text-sm text-ink-faint">尚未掃描。點「開始完整掃描」執行只讀檢查。</p>}
    </div>
  );
}
