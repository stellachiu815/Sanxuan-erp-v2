"use client";

import { useEffect, useState } from "react";
import { useOperator } from "@/lib/operatorClient";

/**
 * V11.3 把原本的 Server Component（直接在 page.tsx 裡 await prisma 查詢）
 * 改成 Client Component，透過已經補上權限檢查的 GET /api/import/pending 抓資料
 * （見該 API route 的 assertSystemPermissionForOperator 呼叫）。
 *
 * 這個改動是必要的，不是順便重構：Server Component 在使用者「打開頁面的
 * 當下」就會在伺服器端執行查詢並把結果直接嵌進 HTML，這一步發生在任何
 * 前端「畫面守門」邏輯執行之前——就算外面包一層 SystemCenterGate，資料
 * 早就已經送到瀏覽器了，等於守門形同虛設。系統管理中心其餘頁面的既有
 * 慣例（先確認操作人員身分，才透過 API 抓資料）本來就是為了避免這個問題，
 * 這裡改成同一種模式，才能真正把「補上權限缺口」這件事做到。
 *
 * 畫面內容（表格欄位、文字說明）跟原本的 Server Component 完全一致，只是
 * 資料來源換成 client-side fetch。
 */

type ExistingHousehold = {
  name: string;
  contactName: string | null;
  phone: string | null;
  address: string | null;
} | null;

type PendingRow = {
  batchFileName: string;
  batchCreatedAt: string;
  rowNumber: number;
  householdId: string;
  memberName: string | null;
  rawData: Record<string, unknown>;
  existingHousehold: ExistingHousehold;
};

export default function ImportPendingList() {
  const { operatorUserId } = useOperator();
  const [rows, setRows] = useState<PendingRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorUserId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/import/pending?operatorUserId=${encodeURIComponent(operatorUserId)}`)
      .then((res) => res.json().then((d) => ({ ok: res.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return;
        if (!ok) {
          setError(d.error ?? "載入失敗");
          return;
        }
        setRows(d.rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("無法連線到伺服器");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [operatorUserId]);

  if (!operatorUserId) return null; // SystemCenterGate 已經顯示提示訊息，這裡不用重複顯示
  if (loading) return <p className="text-sm text-ink-faint">載入中…</p>;
  if (error) return <p className="text-sm text-blossom-300">{error}</p>;

  return (
    <div className="rounded-3xl bg-white/70 p-8 shadow-card">
      {!rows || rows.length === 0 ? (
        <p className="text-sm text-ink-faint">目前沒有待確認的匯入資料。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="text-xs text-ink-faint">
                <th className="pb-2 pr-4">家戶編號</th>
                <th className="pb-2 pr-4">Excel 內容（成員）</th>
                <th className="pb-2 pr-4">資料庫既有家戶</th>
                <th className="pb-2">來源檔案</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const raw = r.rawData as Record<string, string>;
                return (
                  <tr key={`${r.householdId}-${r.rowNumber}-${i}`} className="border-t border-cream-200 align-top">
                    <td className="py-2 pr-4 text-ink">{r.householdId}</td>
                    <td className="py-2 pr-4 text-ink-soft">
                      {raw["家戶成員姓名"]}（{raw["家戶名稱"]}）
                    </td>
                    <td className="py-2 pr-4 text-ink-soft">
                      {r.existingHousehold
                        ? `${r.existingHousehold.name}（${r.existingHousehold.contactName ?? "無聯絡人"}）`
                        : "（找不到，可能已被處理）"}
                    </td>
                    <td className="py-2 text-ink-faint">
                      {r.batchFileName} · {new Date(r.batchCreatedAt).toLocaleString("zh-TW")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
