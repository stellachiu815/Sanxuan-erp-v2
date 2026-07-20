"use client";

import { useCallback, useEffect, useState } from "react";
import { LanternTablet, PetitionSheet, TABLET_PAGE_LAYOUTS, TABLET_PAGE_LAYOUT_ORDER, DEFAULT_TABLET_PAGE_LAYOUT, type TabletPageLayoutKey } from "@/components/ritual/tablets";
import type { LanternPrintBatch, PetitionData } from "@/lib/lanternPrint";

/**
 * V13.1 指令十一：年度燈列印中心（燈牌 + 疏文）。
 *
 * ── 這個畫面的核心是「列印預覽必須先確認」──────────────────
 * 指令十一逐字要求：列印預覽必須清楚顯示
 *   活動使用年度／本次採用的歲數／生肖／太歲判斷／建生瑞生
 * 使用者確認後才列印。
 *
 * 所以這個畫面的順序是：
 *   選年度 → 看核對表（每一筆的年度、歲數、生肖、太歲、建生瑞生）
 *   → 資料不完整者明確標示、不可列印
 *   → 使用者按下「確認資料無誤，開始列印」→ 才顯示列印版面
 *
 * ⚠️ 年度由使用者選擇並顯示在最上方，**畫面上不會出現「今年」字樣**——
 * 民國 115 年印 116 年度是正常情境，不是異常。
 */

type Props = {
  activityType: string;
  activityTypeLabel: string;
  /** 可選的活動年度（已建立的活動） */
  availableYears: number[];
  /** 預設年度（由 activityYear 共用判斷得出，非今年） */
  defaultYear: number;
  operatorUserId: string | null;
};

export default function LanternPrintCenter({
  activityType,
  activityTypeLabel,
  availableYears,
  defaultYear,
  operatorUserId,
}: Props) {
  const [year, setYear] = useState<number>(defaultYear);
  const [mode, setMode] = useState<"tablet" | "petition">("tablet");
  const [layout, setLayout] = useState<TabletPageLayoutKey>(DEFAULT_TABLET_PAGE_LAYOUT);

  const [batch, setBatch] = useState<LanternPrintBatch | null>(null);
  const [petition, setPetition] = useState<PetitionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 使用者是否已確認核對表。未確認前不顯示列印版面（指令十一） */
  const [confirmed, setConfirmed] = useState(false);

  const load = useCallback(async () => {
    if (!operatorUserId) {
      setError("請先於右上角選擇操作人員");
      return;
    }
    setLoading(true);
    setError(null);
    setConfirmed(false);
    try {
      const res = await fetch(
        `/api/lantern/${activityType}/${year}/print?operatorUserId=${encodeURIComponent(operatorUserId)}&mode=${mode}`
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "讀取列印資料失敗");
        setBatch(null);
        setPetition(null);
        return;
      }
      if (mode === "petition") {
        setPetition(data.data as PetitionData);
        setBatch(null);
      } else {
        setBatch(data.batch as LanternPrintBatch);
        setPetition(null);
      }
    } catch {
      setError("讀取列印資料時發生連線問題，請稍後再試");
    } finally {
      setLoading(false);
    }
  }, [activityType, year, mode, operatorUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  const readyRows = batch?.rows.filter((r) => r.canPrint) ?? [];
  const blockedRows = batch?.rows.filter((r) => !r.canPrint) ?? [];

  const perPage = TABLET_PAGE_LAYOUTS[layout].perPage;
  const pages: typeof readyRows[] = [];
  for (let i = 0; i < readyRows.length; i += perPage) {
    pages.push(readyRows.slice(i, i + perPage));
  }

  return (
    <div className="space-y-6">
      {/* ── 控制列（列印時隱藏）── */}
      <div className="space-y-4 rounded-3xl border border-cream-200 bg-cream-50/60 p-5 print:hidden">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-soft">活動使用年度</span>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="min-h-11 rounded-xl border border-cream-300 bg-white px-3 py-2 text-sm"
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  民國 {y} 年
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-soft">列印內容</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "tablet" | "petition")}
              className="min-h-11 rounded-xl border border-cream-300 bg-white px-3 py-2 text-sm"
            >
              <option value="tablet">燈牌</option>
              <option value="petition">疏文</option>
            </select>
          </label>

          {mode === "tablet" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-soft">每頁張數</span>
              <select
                value={layout}
                onChange={(e) => setLayout(e.target.value as TabletPageLayoutKey)}
                className="min-h-11 rounded-xl border border-cream-300 bg-white px-3 py-2 text-sm"
              >
                {TABLET_PAGE_LAYOUT_ORDER.map((k) => (
                  <option key={k} value={k}>
                    {TABLET_PAGE_LAYOUTS[k].label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {/* 明確標示採用的年度，避免與電腦目前年份混淆 */}
        <p className="rounded-2xl bg-mist-100 px-4 py-3 text-sm text-ink-soft">
          本次列印全部採用<span className="font-medium text-ink">民國 {year} 年度</span>計算：
          歲數、生肖、太歲判斷、建生／瑞生皆依此年度，與電腦目前日期無關。
        </p>

        {error && (
          <p className="rounded-2xl bg-blossom-100 px-4 py-3 text-sm text-ink">{error}</p>
        )}

        {batch && !batch.printOpen && (
          <p className="rounded-2xl bg-blossom-100 px-4 py-3 text-sm text-ink">
            這個年度目前不開放列印：{batch.printBlockedReason}
          </p>
        )}
      </div>

      {loading && <p className="text-sm text-ink-soft print:hidden">讀取中…</p>}

      {/* ── 核對表：確認後才顯示列印版面（指令十一）── */}
      {mode === "tablet" && batch && !confirmed && (
        <div className="space-y-4 print:hidden">
          <div className="rounded-3xl border border-cream-200 bg-white p-5">
            <h2 className="mb-3 text-base font-medium text-ink">
              列印前核對（民國 {batch.year} 年 {activityTypeLabel}）
            </h2>
            <p className="mb-4 text-sm text-ink-soft">
              可列印 {batch.readyCount} 筆
              {batch.blockedCount > 0 && `，待處理 ${batch.blockedCount} 筆`}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-cream-200 text-left text-xs text-ink-soft">
                    <th className="py-2 pr-3">姓名</th>
                    <th className="py-2 pr-3">虛歲</th>
                    <th className="py-2 pr-3">實歲</th>
                    <th className="py-2 pr-3">生肖</th>
                    <th className="py-2 pr-3">太歲</th>
                    <th className="py-2 pr-3">建生／瑞生</th>
                    <th className="py-2">狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.rows.map((r) => (
                    <tr key={r.memberId} className="border-b border-cream-100">
                      <td className="py-2 pr-3">{r.name}</td>
                      <td className="py-2 pr-3">{r.text.nominalAgeText || "—"}</td>
                      <td className="py-2 pr-3">{r.text.actualAgeText || "—"}</td>
                      <td className="py-2 pr-3">{r.text.zodiacText || "—"}</td>
                      <td className="py-2 pr-3">{r.text.taisuiText || "不犯"}</td>
                      <td className="py-2 pr-3">{r.text.jishiText || "—"}</td>
                      <td className="py-2">
                        {r.canPrint ? (
                          <span className="text-sage-300">可列印</span>
                        ) : (
                          <span className="text-ink-soft">{r.issues.join("、")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setConfirmed(true)}
            disabled={batch.readyCount === 0 || !batch.printOpen}
            className="min-h-12 w-full rounded-2xl bg-yolk-200 px-6 py-3 text-sm font-medium text-ink transition hover:bg-yolk-300 disabled:cursor-not-allowed disabled:bg-cream-200 disabled:text-ink-faint sm:w-auto"
          >
            {batch.readyCount === 0
              ? "沒有可列印的資料"
              : `資料無誤，預覽 ${batch.readyCount} 張燈牌`}
          </button>
        </div>
      )}

      {/* ── 燈牌列印版面 ── */}
      {mode === "tablet" && batch && confirmed && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-3 print:hidden">
            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-12 rounded-2xl bg-yolk-200 px-6 py-3 text-sm font-medium text-ink transition hover:bg-yolk-300"
            >
              開始列印
            </button>
            <button
              type="button"
              onClick={() => setConfirmed(false)}
              className="min-h-12 rounded-2xl border border-cream-300 px-6 py-3 text-sm text-ink-soft transition hover:bg-cream-100"
            >
              返回核對
            </button>
          </div>

          {pages.map((page, pi) => (
            <div
              key={pi}
              className="print-sheet mx-auto grid bg-white"
              style={{
                width: "210mm",
                minHeight: "297mm",
                padding: "12mm",
                gridTemplateColumns: `repeat(${TABLET_PAGE_LAYOUTS[layout].cols}, 1fr)`,
                gridTemplateRows: `repeat(${TABLET_PAGE_LAYOUTS[layout].rows}, 1fr)`,
                gap: "4mm",
                breakAfter: "page",
              }}
            >
              {page.map((r) => (
                <LanternTablet
                  key={r.memberId}
                  entry={{
                    lanternTypeText: batch.activityTypeLabel,
                    activityYearText: r.text.activityYearText,
                    sexagenaryText: r.text.sexagenaryText,
                    name: r.name,
                    addressText: r.addressText,
                    nominalAgeText: r.text.nominalAgeText,
                    zodiacText: r.text.zodiacText,
                    jishiText: r.text.jishiText,
                    taisuiText: r.text.taisuiText,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── 疏文 ── */}
      {mode === "petition" && petition && (
        <div className="space-y-6">
          <div className="print:hidden">
            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-12 rounded-2xl bg-yolk-200 px-6 py-3 text-sm font-medium text-ink transition hover:bg-yolk-300"
            >
              列印疏文
            </button>
          </div>
          <PetitionSheet data={petition} />
        </div>
      )}

      {mode === "tablet" && batch && blockedRows.length > 0 && confirmed && (
        <p className="text-sm text-ink-soft print:hidden">
          另有 {blockedRows.length} 筆資料不完整未列入本次列印，補齊後可重新列印。
        </p>
      )}
    </div>
  );
}
