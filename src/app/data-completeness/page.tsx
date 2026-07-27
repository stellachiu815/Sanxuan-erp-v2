"use client";

import { useCallback, useEffect, useState } from "react";
import BackButton from "@/components/navigation/BackButton";
import Link from "next/link";
import { fetchRegistration } from "@/lib/registrationFetch";
import { useCurrentUser } from "@/lib/permissionClient";

/**
 * V15R3 資料待補清單頁（純讀取）。列出各報名缺哪些欄位，可篩選並「前往補資料」（導向既有
 * 報名編輯頁，不建第二套編輯）。READONLY 可查看，但不顯示「前往補資料」寫入入口。
 */
type Row = {
  ritualRecordId: string;
  memberName: string | null;
  householdId: string;
  householdName: string | null;
  year: number;
  activityGroupName: string;
  activityType: string;
  missingFields: string[];
  status: string;
};

const STATUS_LABEL: Record<string, string> = { DRAFT: "草稿", CONFIRMED: "已確認", CANCELLED: "已取消" };

export default function DataCompletenessPage() {
  const { role, loading } = useCurrentUser();
  const canEdit = !!role && role !== "READONLY";
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<string>("");
  const [missingField, setMissingField] = useState<string>("");
  const [memberName, setMemberName] = useState<string>("");

  const load = useCallback(async () => {
    setRows(null);
    try {
      const qs = new URLSearchParams();
      if (year) qs.set("year", year);
      if (missingField) qs.set("missingField", missingField);
      if (memberName) qs.set("memberName", memberName);
      const res = await fetchRegistration(`/api/data-completeness/list?${qs.toString()}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError("讀取失敗"); return; }
      setRows(data.rows);
      setError(null);
    } catch {
      setError("讀取失敗");
    }
  }, [year, missingField, memberName]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <main className="mx-auto max-w-5xl px-6 py-8 text-sm text-ink-faint">載入中…</main>;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <BackButton fallbackHref="/" />
          <h1 className="mt-1 text-lg text-ink">⚠️ 資料待補清單</h1>
          <p className="text-xs text-ink-faint">正式確認／正式列印前需補齊缺項；草稿仍可儲存。</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="年度（民國）" className="w-32 rounded-xl border border-cream-300 px-3 py-1.5 text-sm" />
        <select value={missingField} onChange={(e) => setMissingField(e.target.value)} className="rounded-xl border border-cream-300 px-3 py-1.5 text-sm">
          <option value="">全部缺項</option>
          {["牌位地址", "陽上人", "生肖", "農曆生日", "性別", "地址", "姓名", "金額", "認購人", "重量", "燈種"].map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <input value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="信眾姓名" className="w-40 rounded-xl border border-cream-300 px-3 py-1.5 text-sm" />
      </div>

      {error && <p className="text-sm text-blossom-500">{error}</p>}
      {rows === null ? (
        <p className="text-sm text-ink-faint">讀取中…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-faint">目前沒有待補資料。</p>
      ) : (
        <div className="max-h-[70vh] overflow-y-auto rounded-2xl border border-cream-200">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white/95">
              <tr className="text-xs text-ink-faint">
                <th className="px-2 py-1.5">信眾</th>
                <th className="px-2 py-1.5">家戶</th>
                <th className="px-2 py-1.5">年度</th>
                <th className="px-2 py-1.5">活動</th>
                <th className="px-2 py-1.5">缺少欄位</th>
                <th className="px-2 py-1.5">狀態</th>
                {canEdit && <th className="px-2 py-1.5" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ritualRecordId} className="border-t border-cream-200 align-top">
                  <td className="px-2 py-1.5 text-ink">{r.memberName ?? "—"}</td>
                  <td className="px-2 py-1.5 text-ink-soft">{r.householdName ?? r.householdId}</td>
                  <td className="px-2 py-1.5 text-ink-soft">{r.year}</td>
                  <td className="px-2 py-1.5 text-ink-soft">{r.activityGroupName}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {r.missingFields.map((f) => (
                        <span key={f} className="rounded-full bg-blossom-100 px-2 py-0.5 text-xs text-ink">⚠ 缺{f}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-ink-faint">{STATUS_LABEL[r.status] ?? r.status}</td>
                  {canEdit && (
                    <td className="px-2 py-1.5">
                      <Link href={`/registration/${r.ritualRecordId}`} className="rounded-full bg-sage-100 px-3 py-1 text-xs text-ink hover:bg-sage-200">
                        前往補資料 →
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
