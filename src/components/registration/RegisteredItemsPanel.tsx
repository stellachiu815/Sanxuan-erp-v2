"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
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
  /** V15R2：認購人／報名成員實際姓名（白米認購人、贊普本人）。 */
  memberName: string | null;
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
  /** V15R2：舊 Detail 贊普唯讀相容列（非真實 item，不可從此取消）。 */
  readOnlyLegacy?: boolean;
  /** V27.6：不計入「本次報名總計」（額外寶袋——有自己的收款來源，這裡只顯示）。 */
  excludeFromTotal?: boolean;
};

/** V15R6.1：依報名者姓名分組，保留首次出現順序。 */
function groupByRegistrant(items: Item[], registrant: (it: Item) => string): [string, Item[]][] {
  const map = new Map<string, Item[]>();
  for (const it of items) {
    const key = registrant(it);
    const arr = map.get(key);
    if (arr) arr.push(it);
    else map.set(key, [it]);
  }
  return Array.from(map.entries());
}

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

  // V15R5.1：報名者姓名一律取 item.memberId 對應的 Member.name（listRegisteredItems 已回 memberName），
  // 不依陣列順序猜測；memberName 為空才退回 subjectName（贊普本人／牌位當事人），再退「—」。
  const registrant = (it: Item) => (it.memberName?.trim() || it.subjectName?.trim() || "—");
  const statusLabel = (s: string) =>
    s === "CONFIRMED" ? "已確認" : s === "CANCELLED" ? "已取消" : "草稿";
  const qtyUnit = (it: Item) => (it.contentKind === "RICE" ? " 斤" : it.contentKind === "SPONSOR" ? " 份" : "");
  // 名稱下方補充列（單價／陽上／地址）；白米「認購人」已由報名者欄顯示，此處不再重複，只留單價。
  const subDetails = (it: Item) => (
    <>
      {it.contentKind === "RICE" && it.unitPrice !== null && (
        <div className="text-xs text-ink-faint">單價 {it.unitPrice} 元／斤</div>
      )}
      {it.contentKind === "SPONSOR" && it.unitPrice !== null && (
        <div className="text-xs text-ink-faint">單價 {it.unitPrice} 元／份</div>
      )}
      {it.yangshangNames.length > 0 && (
        <div className="text-xs text-ink-faint">陽上：{it.yangshangNames.join("、")}</div>
      )}
      {it.tabletAddress && <div className="text-xs text-ink-faint">牌位地址：{it.tabletAddress}</div>}
    </>
  );
  const cancelCell = (it: Item) =>
    it.readOnlyLegacy ? (
      <span className="text-xs text-ink-faint">
        {it.itemKey === "US_POCKET_EXTRA" ? "（於寶袋區塊管理）" : "舊資料（下次儲存自動轉正式項目）"}
      </span>
    ) : (
      it.status !== "CANCELLED" && (
        <button
          type="button"
          onClick={() => void cancelItem(it.id)}
          disabled={busyId === it.id}
          className="rounded-full bg-cream-100 px-3 py-1 text-xs text-ink-soft hover:bg-blossom-100 hover:text-ink disabled:opacity-50"
        >
          {busyId === it.id ? "處理中…" : "取消項目"}
        </button>
      )
    );

  return (
    <section className="rounded-3xl bg-white/70 p-6 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm text-ink">已報名項目</h2>
        {/* V41：一鍵重新整理清單（加項目後若沒自動更新，按這顆即可，不必整頁重載）。 */}
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-full bg-cream-100 px-3 py-1 text-xs text-ink-soft hover:bg-cream-200"
        >
          🔄 重新整理
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-blossom-500">{error}</p>}
      {items === null ? (
        <p className="mt-2 text-xs text-ink-faint">讀取中…</p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-xs text-ink-faint">
          尚未報名任何項目。可從信眾詳情頁「新增活動報名」選擇具體項目。
        </p>
      ) : (
        /* V15R2：項目多時，清單改成固定最大高度、區塊內垂直捲動（表頭 sticky），
           避免整頁被撐長導致後面項目與「取消項目」按鈕看不到。手機、平板、桌機皆可捲。
           V15R5.1：桌機用表格（含「報名者」欄）；窄螢幕改用卡片，姓名等資訊直接可見、不橫向難讀。 */
        <div className="mt-3 max-h-[380px] overflow-y-auto overflow-x-hidden rounded-2xl border border-cream-200">
        {/* ── 桌機／平板：表格（報名者｜類別／名稱｜數量｜應收｜未收｜狀態｜操作）── */}
        <table className="hidden w-full text-left text-sm sm:table">
          <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur">
            <tr className="text-xs text-ink-faint">
              <th className="px-2 py-1.5">報名者</th>
              <th className="px-2 py-1.5">類別｜名稱</th>
              <th className="px-2 py-1.5">數量</th>
              <th className="px-2 py-1.5">應收</th>
              <th className="px-2 py-1.5">未收</th>
              <th className="px-2 py-1.5">狀態</th>
              {!readOnly && <th className="px-2 py-1.5" />}
            </tr>
          </thead>
          <tbody>
            {/* V15R6.1（UI 小修）：已報名項目依「報名者」分組，每組一列小標。 */}
            {groupByRegistrant(items, registrant).map(([member, its]) => (
              <Fragment key={member}>
                <tr className="bg-cream-50">
                  <td colSpan={readOnly ? 6 : 7} className="px-2 py-1 text-xs text-ink-soft">
                    報名者：{member}（{its.length} 項）
                  </td>
                </tr>
                {its.map((it) => (
                  <tr key={it.id} className="border-t border-cream-200 align-top">
                    <td className="whitespace-nowrap px-2 py-1.5 text-ink-faint">{registrant(it)}</td>
                    <td className="px-2 py-1.5">
                      <div className="text-ink">{it.displayLabel}</div>
                      {subDetails(it)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-ink-soft">
                      {it.quantity}
                      {qtyUnit(it)}
                    </td>
                    <td className="px-2 py-1.5 text-ink-soft">{it.amountDue.toLocaleString("zh-Hant")}</td>
                    <td className="px-2 py-1.5 text-ink-soft">{it.amountUnpaid.toLocaleString("zh-Hant")}</td>
                    <td className="px-2 py-1.5 text-ink-faint">{statusLabel(it.status)}</td>
                    {!readOnly && <td className="px-2 py-1.5">{cancelCell(it)}</td>}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>

        {/* ── 手機：依報名者分組的卡片 ── */}
        <div className="sm:hidden">
          {groupByRegistrant(items, registrant).map(([member, its]) => (
            <div key={member} className="border-t border-cream-200 first:border-t-0">
              <p className="bg-cream-50 px-3 py-1 text-xs text-ink-soft">報名者：{member}（{its.length} 項）</p>
              <ul className="divide-y divide-cream-200">
                {its.map((it) => (
                  <li key={it.id} className="px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm text-ink-soft">{it.displayLabel}</span>
                      <span className="whitespace-nowrap text-xs text-ink-faint">{statusLabel(it.status)}</span>
                    </div>
                    {subDetails(it)}
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-soft">
                      <span>數量：{it.quantity}{qtyUnit(it)}</span>
                      <span>應收：{it.amountDue.toLocaleString("zh-Hant")}</span>
                      <span className="text-blossom-500">未收：{it.amountUnpaid.toLocaleString("zh-Hant")}</span>
                    </div>
                    {!readOnly && <div className="mt-1.5">{cancelCell(it)}</div>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        </div>
      )}

      {/* V14.2：本次報名總計——直接彙總各項目「同一套收費來源」的金額
          （listRegisteredItems 已依項目型別讀真正收費來源：贊普→明細、年度燈→明細、
          牌位→本項），不另建第二套統計，與收款中心一致。 */}
      {items !== null && items.length > 0 && (() => {
        // V27.6：本次報名總計排除 excludeFromTotal 列（額外寶袋——其收款於收款中心各自計，
        // 這裡只顯示金額、不重複併入總計），維持既有總計行為不變。
        const active = items.filter((it) => it.status !== "CANCELLED" && !it.excludeFromTotal);
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
