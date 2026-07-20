"use client";

import SearchBar from "@/components/SearchBar";
import { OperatorProvider } from "@/lib/operatorClient";

/**
 * V12.2「信眾建立與查詢中心」指令「五」的配套元件。
 *
 * GET /api/search 這次補上了信眾 view 權限檢查，SearchBar 因此改用既有的
 * useOperator() 取得 operatorUserId——也就是說它必須放在 <OperatorProvider>
 * 內才能使用。首頁走 DevoteeQuickActions，但另外兩個頁面
 * （/household/[id] 與 /import）的頂部固定搜尋框都是直接放在 Server
 * Component 的 header 裡，沒有 Provider。
 *
 * 這個元件就只是「幫頂部搜尋框補上 Provider」，沒有其他邏輯，也**沒有**
 * 額外的 <OperatorBar/>——那兩個頁面各自本來就有選擇操作人員的地方
 * （家戶頁在 QuickActionsPanel、匯入頁在 SystemCenterGate 上方），而
 * OperatorProvider 是從同一個 localStorage key 讀取，選過一次就會一致，
 * 不需要在同一頁重複出現兩個操作人員選單。
 */
export default function HeaderSearchBar() {
  return (
    <OperatorProvider>
      <SearchBar variant="compact" />
    </OperatorProvider>
  );
}
