"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * V19.1「全系統統一返回上一頁」共用元件。
 *
 * 規則：
 *  - 主要返回按鈕一律顯示「← 返回上一頁」（label 可覆寫）。
 *  - 點擊後返回使用者實際進入本頁前的上一個頁面（router.back()）。
 *  - 若沒有 ERP 站內上一頁（直接輸入網址／書籤／外部連結進入）→ 使用 fallbackHref
 *    回到該頁所屬模組首頁，「絕不」離開 ERP 跳到外部網站。
 *
 * 站內返回判斷：
 *  以「同一分頁 session 內的 ERP 導覽深度（erpNavDepth）」判斷是否曾在站內導覽過。
 *  進入本頁前深度 > 0 且 window.history 有可退項目，才視為有安全的站內上一頁；
 *  否則一律走 fallbackHref。此判斷只看是否曾在本 ERP 分頁內移動過，
 *  不會把使用者帶往外部網域（外部或直接進入時 referrer/歷史不屬站內，走 fallback）。
 *
 * 不改變任何業務流程、資料、API、權限；只負責導覽返回。
 */
export default function BackButton({
  fallbackHref,
  label = "返回上一頁",
  className = "text-sm text-ink-soft hover:underline",
}: {
  /** 沒有站內上一頁時的退回目的地（該模組首頁）。 */
  fallbackHref: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    try {
      const depth = Number(sessionStorage.getItem("erpNavDepth") ?? "0");
      // 進入本頁前深度 > 0 → 本分頁曾在 ERP 站內導覽過，router.back() 會退回站內上一頁。
      setCanGoBack(depth > 0 && window.history.length > 1);
      sessionStorage.setItem("erpNavDepth", String(depth + 1));
    } catch {
      setCanGoBack(typeof window !== "undefined" && window.history.length > 1);
    }
  }, []);

  function handleBack() {
    if (canGoBack) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  }

  return (
    <button type="button" onClick={handleBack} className={className}>
      ← {label}
    </button>
  );
}
