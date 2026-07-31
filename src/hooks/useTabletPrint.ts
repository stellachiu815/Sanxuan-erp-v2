"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * V27.10：專用列印頁的列印觸發 hook。
 *
 * - 只在**版面資料載入完成後**才呼叫 window.print()，避免 Chrome 抓到尚未 render 的空白。
 * - 只負責觸發瀏覽器列印對話框，**不寫任何 printCount／printedAt**（列印紀錄一律由管理頁
 *   「確認完成列印」呼叫既有 confirm API 才更新）。
 * - 自動列印僅執行一次；使用者取消 Chrome 列印不會被視為完成。
 */
export function useTabletPrint(ready: boolean, opts?: { auto?: boolean; delayMs?: number }) {
  const auto = opts?.auto ?? true;
  const delayMs = opts?.delayMs ?? 400;
  const firedRef = useRef(false);
  const [autoEnabled, setAutoEnabled] = useState(auto);

  useEffect(() => {
    if (!ready || !autoEnabled || firedRef.current || typeof window === "undefined") return;
    firedRef.current = true;
    const t = window.setTimeout(() => {
      try {
        window.print();
      } catch {
        /* 忽略：列印預覽失敗不影響資料 */
      }
    }, delayMs);
    return () => window.clearTimeout(t);
  }, [ready, autoEnabled, delayMs]);

  const print = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.print();
    } catch {
      /* 忽略 */
    }
  }, []);

  return { print, cancelAuto: () => setAutoEnabled(false) };
}
