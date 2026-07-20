"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * V12「信眾資料中心正式建置」指令「八、全站一鍵回首頁」。
 *
 * 放在共用 RootLayout（src/app/layout.tsx），不是每個頁面各自加一份連結——
 * 這樣之後任何新頁面都會自動有這顆按鈕，不需要每支頁面自己記得加。
 *
 * 位置選在畫面右下角、固定定位（position: fixed）：
 * - 不會跟現有各頁面「頂部 sticky header」裡原本就有的「← 上一頁」文字連結
 *   重疊/衝突（那些是既有的返回上一頁功能，跟這顆「直接回首頁」是兩件事，
 *   本次不動它們）。
 * - 桌面與手機都容易點擊到（右下角是慣用單手熱區，不需要滑到頁面最上方）。
 *
 * 首頁本身（"/"）不顯示這顆按鈕——已經在首頁，不需要「回首頁」。
 */
export default function GlobalHomeButton() {
  const pathname = usePathname();

  if (pathname === "/") return null;

  return (
    <Link
      href="/"
      className="fixed bottom-5 right-5 z-40 flex items-center gap-1.5 rounded-full bg-sage-200/95 px-4 py-2.5 text-sm text-ink shadow-card backdrop-blur transition hover:bg-sage-300 active:scale-95"
      aria-label="回首頁"
    >
      <span aria-hidden="true">🏠</span>
      <span>首頁</span>
    </Link>
  );
}
