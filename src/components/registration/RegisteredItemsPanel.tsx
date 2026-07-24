"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";

/**
 * V14：統一報名編輯頁的「已報名項目」清單（指令八.5：已報名項目需清楚顯示）。
 *
 * 顯示這筆 RitualRecord 底下已報名的所有項目（名稱、成員、數量、金額、狀態）。
 * 資料來自 GET /api/registrations/[id]/items（後端權限、共用查詢，無 N+1）。
 */

type Item = {
  id: string;
  itemKey: string;
  itemName: string;
  categoryName: string;
  subjectName: string;
  /** V14.2：最終顯示字串（牌位名稱／類別｜姓名／本人…）。 */
  displayLabel: string;
  /** V14.4：內容型態＋鎖定單價（白米＝每斤金額）。 */
  contentKind: string;
  unitPrice: number | null;
  /** V14.2：陽上人（祖先／乙位正魂）。 */
  yangshangNames: string[];
  /** V14.2：牌位地址（沿用既有 UniversalSalvationEntry.tabletAddress）。 */
  tabletAddress: string | null;
  activityGroupName: string;
  quantity: number;
  amountDue: number;
  amountPaid: number;
  amountUnpaid: number;
  status: string;
};

export default function RegisteredItemsPanel({
  ritualRecordId,
  refreshKey = 0,
  readOnly = false,
}: {
  ritualRecordId: string;
  refreshKey?: number;
  readOnly?: boolean;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchRegistration(`/api/registrations/${ritualRecordId}/items`);
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setItems(data.items);
      setError(null);
    } catch {
      setError("讀取已報名項目時發生連線問題。");
    }
  }, [ritualRecordId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function cancelItem(itemId: string) {
    setBusyId(itemId);
    setError(null);
    try {
      const res = await fetchRegistration(
        `/api/registrations/${ritualRecordId}/items/${itemId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      await load();
    } catch {
      setError("取消項目時發生連線問題。");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-3xl bg-white/70 p-6 shadow-card">
      <h2 className="text-sm text-ink">已報名項目</h2>
      {error && <p className="mt-2 text-xs text-blossom-500">{error}</p>}
      {items === null ? (
        <p className="mt-2 text-xs text-ink-faint">讀取中…</p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-xs text-ink-faint">
          尚未報名任何項目。可從信眾詳情頁「新增活動報名」選擇具體項目。
        </p>
      ) : (
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-ink-faint">
              <th className="px-2 py-1.5">類別｜名稱</th>
              <th className="px-2 py-1.5">數量</th>
              <th className="px-2 py-1.5">應收</th>
              <th className="px-2 py-1.5">未收</th>
              <th className="px-2 py-1.5">狀態</th>
              {!readOnly && <th className="px-2 py-1.5" />}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t border-cream-200">
                <td className="px-2 py-1.5">
                  <div className="text-ink">{it.displayLabel}</div>
                  {it.contentKind === "RICE" && it.unitPrice !== null && (
                    <div className="text-xs text-ink-faint">單價 {it.unitPrice} 元／斤</div>
                  )}
                  {it.yangshangNames.length > 0 && (
                    <div className="text-xs text-ink-faint">陽上：{it.yangshangNames.join("、")}</div>
                  )}
                  {it.tabletAddress && (
                    <div className="text-xs text-ink-faint">牌位地址：{it.tabletAddress}</div>
                  )}
                </td>
                <td className="px-2 py-1.5 text-ink-soft">
                  {it.quantity}
                  {it.contentKind === "RICE" && " 斤"}
                </td>
                <td className="px-2 py-1.5 text-ink-soft">{it.amountDue}</td>
                <td className="px-2 py-1.5 text-ink-soft">{it.amountUnpaid}</td>
                <td className="px-2 py-1.5 text-ink-faint">
                  {it.status === "CONFIRMED" ? "已確認" : it.status === "CANCELLED" ? "已取消" : "草稿"}
                </td>
                {!readOnly && (
                  <td className="px-2 py-1.5">
                    {it.status !== "CANCELLED" && (
                      <button
                        type="button"
                        onClick={() => void cancelItem(it.id)}
                        disabled={busyId === it.id}
                        className="rounded-full bg-cream-100 px-3 py-1 text-xs text-ink-soft hover:bg-blossom-100 hover:text-ink disabled:opacity-50"
                      >
                        {busyId === it.id ? "處理中…" : "取消項目"}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* V14.2：本次報名總計——直接彙總各項目「同一套收費來源」的金額
          （listRegisteredItems 已依項目型別讀真正收費來源：贊普→明細、年度燈→明細、
          牌位→本項），不另建第二套統計，與收款中心一致。 */}
      {items !== null && items.length > 0 && (() => {
        const active = items.filter((it) => it.status !== "CANCELLED");
        const due = active.reduce((s, it) => s + it.amountDue, 0);
        const paid = active.reduce((s, it) => s + it.amountPaid, 0);
        const unpaid = active.reduce((s, it) => s + it.amountUnpaid, 0);
        return (
          <div className="mt-4 rounded-2xl bg-cream-100 px-4 py-3">
            <p className="text-xs text-ink-soft">本次報名總計</p>
            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-ink">應收總額：{due.toLocaleString("zh-Hant")} 元</span>
              <span className="text-sage-300">已收：{paid.toLocaleString("zh-Hant")} 元</span>
              <span className="text-blossom-500">未收：{unpaid.toLocaleString("zh-Hant")} 元</span>
            </div>
          </div>
        );
      })()}
    </section>
  );
}
