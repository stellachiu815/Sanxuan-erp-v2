"use client";

import { useCallback, useEffect, useState } from "react";
import { errorTextClass } from "@/components/household/formStyles";
import { fetchUniversalSalvation } from "@/lib/universalSalvationFetch";
import OneClickPrintButton from "./OneClickPrintButton";
import { BATCH_KEYS, type BatchItem } from "@/lib/TabletBatchService";

/**
 * V27.10：跨家戶「三個實體紙張／版型批次」列印區。三個獨立區塊，各自一鍵列印、
 * 各自統計、各自手動補印，三批不可互相混印（每區塊只含自己批次的項目）。
 * 資料沿用既有 /print-items API（已含 tabletMissingFields／sourceLocation／陽上等欄位）。
 */
export default function TabletBatchPrintSection({ year }: { year: number }) {
  const [items, setItems] = useState<BatchItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchUniversalSalvation(`/api/universal-salvation/${year}/print-items`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "讀取失敗，請稍後再試一次。");
        return;
      }
      setItems(data.items as BatchItem[]);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    }
  }, [year]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium text-ink">跨家戶批次列印（依紙張／版型分三批）</h2>
        <p className="mt-1 text-xs text-ink-faint">
          三批分別列印、不可混印：祖先／乙位正魂（黃色紙）、累世冤親債主（黃色紙、獨立）、寶袋（紅色紙）。
          牌位批次以專用列印頁只印 A4 版面；開啟預覽不計列印次數，按「確認完成列印」才更新列印紀錄。
        </p>
      </div>

      {error && <p className={errorTextClass}>{error}</p>}
      {items === null && !error && <p className="text-sm text-ink-faint">載入列印統計中…</p>}

      {items && BATCH_KEYS.map((batch) => (
        <OneClickPrintButton key={batch} year={year} batch={batch} items={items} onChanged={load} />
      ))}
    </div>
  );
}
