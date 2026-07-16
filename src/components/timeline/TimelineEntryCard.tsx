"use client";

import { useState } from "react";
import type { TimelineEntry } from "@/lib/timeline";

type Props = {
  entry: TimelineEntry;
};

const ENTRY_CATEGORY_ORDER = ["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "DEBT_CREDITOR", "UNBORN_CHILD"] as const;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * 單筆時間軸紀錄卡片（V6.0 新增）。純唯讀——沒有任何修改/刪除操作，
 * 「展開」只是顯示更多欄位，不會呼叫任何 API。
 */
export default function TimelineEntryCard({ entry }: Props) {
  const [expanded, setExpanded] = useState(false);
  const detail = entry.universalSalvationDetail;

  return (
    <div className="rounded-2xl bg-white/70 p-5 shadow-soft">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-blossom-50 px-3 py-1 text-sm text-ink">
          {entry.activityTypeLabel}
        </span>
        {entry.statusLabel && (
          <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs text-ink-soft">
            {entry.statusLabel}
          </span>
        )}
        <span className="rounded-full bg-sage-50 px-2 py-0.5 text-xs text-ink-soft">
          {entry.member ? entry.member.name : "家戶共同"}
        </span>
        {entry.source === "LEGACY_ACTIVITY" && (
          <span className="rounded-full bg-cream-200/70 px-2 py-0.5 text-xs text-ink-faint">
            舊資料（唯讀）
          </span>
        )}
        <span className="ml-auto whitespace-nowrap text-xs text-ink-faint">
          建立於 {formatDateTime(entry.createdAt)}
          {entry.updatedAt && <> ・更新於 {formatDateTime(entry.updatedAt)}</>}
        </span>
      </div>

      <div className="mt-3 text-sm text-ink-soft">
        {entry.universalSalvationSummary ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>{entry.universalSalvationSummary.isRegistered ? "已報名普渡" : "尚未報名"}</span>
            <span>歷代祖先 {entry.universalSalvationSummary.ancestorLineCount} 筆</span>
            <span>個人乙位正魂 {entry.universalSalvationSummary.individualSoulCount} 筆</span>
            <span>冤親債主 {entry.universalSalvationSummary.debtCreditorCount} 筆</span>
            <span>無緣子女 {entry.universalSalvationSummary.unbornChildCount} 筆</span>
            <span>{entry.universalSalvationSummary.isSponsor ? "已贊普" : "未贊普"}</span>
            {entry.universalSalvationSummary.tableNumber && (
              <span>普渡桌：{entry.universalSalvationSummary.tableNumber}</span>
            )}
          </div>
        ) : entry.notes ? (
          <p>{entry.notes}</p>
        ) : (
          <p className="text-ink-faint">（沒有摘要資料）</p>
        )}
      </div>

      {detail && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-ink-faint underline-offset-4 hover:text-ink-soft hover:underline"
          >
            {expanded ? "收合詳細內容 ▲" : "展開詳細內容 ▼"}
          </button>
        </div>
      )}

      {expanded && detail && (
        <div className="mt-3 rounded-xl bg-cream-100/60 p-4 text-sm text-ink">
          {ENTRY_CATEGORY_ORDER.map((cat) => {
            const items = detail.entries.filter((e) => e.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat} className="mb-3 last:mb-0">
                <p className="text-xs text-ink-faint">{items[0].categoryLabel}</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {items.map((item, i) => (
                    <li key={i}>
                      {item.displayName}
                      {item.yangshangName && (
                        <span className="text-ink-soft">（陽上：{item.yangshangName}）</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 border-t border-cream-200 pt-3 sm:grid-cols-2">
            <DetailRow label="陽上姓名" value={detail.yangshangName} />
            <DetailRow label="安奉位置" value={detail.enshrinementLocation} />
            <DetailRow
              label="贊普"
              value={
                detail.isSponsor
                  ? [
                      detail.sponsorQuantity !== null ? `數量 ${detail.sponsorQuantity}` : null,
                      detail.sponsorUnitPrice !== null ? `單價 ${detail.sponsorUnitPrice}` : null,
                      detail.sponsorAmount !== null ? `金額 ${detail.sponsorAmount}` : null,
                      detail.sponsorNotes,
                    ]
                      .filter(Boolean)
                      .join("・") || "是"
                  : "否"
              }
            />
            <DetailRow label="普渡桌" value={detail.tableNumber} />
            <DetailRow label="備註" value={detail.notes} className="sm:col-span-2" />
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string | null;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="text-xs text-ink-faint">{label}：</span>
      <span className="text-ink-soft">{value || "（未填寫）"}</span>
    </div>
  );
}
