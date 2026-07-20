"use client";

import { useState } from "react";
import SearchBar from "@/components/SearchBar";
import CreateDevoteeModal from "@/components/devotee/CreateDevoteeModal";
import OperatorBar from "@/components/system/OperatorBar";
import { OperatorProvider, useOperator } from "@/lib/operatorClient";
import { canDevotee } from "@/lib/permissions";

/**
 * V12.2「信眾建立與查詢中心」指令「五」＋「一」：首頁的「查詢＋建立」區塊。
 *
 * 兩件事必須放在同一個元件裡：
 *
 * 1. **搜尋需要操作人身分**：GET /api/search 這次補上了權限檢查，SearchBar
 *    必須帶 operatorUserId。首頁原本是 Server Component、沒有掛
 *    <OperatorProvider>，所以這裡包一層——沿用既有作法（同
 *    QuickActionsPanel／RecycleBinScreen），**不新增第二套登入或角色邏輯**。
 * 2. **建立信眾入口**：指令要求建立與查詢是首頁最容易找到的操作，兩者放在
 *    一起，就在搜尋框正下方，不被其他模組卡片遮蔽。
 *
 * 「新增信眾」按鈕只顯示給有 updateProfile 權限的角色——前端隱藏只是體驗
 * 優化，真正的把關在 POST /api/devotee-center/create。
 */
export default function DevoteeQuickActions() {
  return (
    <OperatorProvider>
      <DevoteeQuickActionsInner />
    </OperatorProvider>
  );
}

function DevoteeQuickActionsInner() {
  const { operatorUser, operatorUserId, loading } = useOperator();
  const [showCreate, setShowCreate] = useState(false);

  /**
   * ⚠️ V12.2 Smoke test 修正：這裡原本寫成 `{canCreate && <button/>}`，只要
   * 還沒選操作人員（operatorUser 為 null，例如第一次使用、換瀏覽器、清過
   * localStorage），按鈕就**整個不會出現**，畫面上也沒有任何說明——使用者
   * 只會看到「首頁沒有新增信眾入口」。
   *
   * 現在改成按鈕一律顯示（桌面與手機都看得到），只有在「還沒選操作人員」或
   * 「角色沒有權限」時停用並說明原因。前端顯示與否本來就不是安全機制，真正
   * 的把關在 POST /api/devotee-center/create 的權限檢查，維持不變。
   */
  const hasOperator = Boolean(operatorUserId && operatorUser);
  const canCreate = operatorUser?.role ? canDevotee(operatorUser.role, "updateProfile") : false;
  const disabled = loading || !hasOperator || !canCreate;

  const hint = loading
    ? "載入操作人員名單中…"
    : !hasOperator
      ? "請先在上方選擇「目前操作人員」，才能新增信眾"
      : !canCreate
        ? `目前操作人員（${operatorUser?.name}）沒有新增信眾的權限`
        : null;

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-3">
      <OperatorBar />
      <SearchBar variant="hero" />

      <button
        type="button"
        onClick={() => setShowCreate(true)}
        disabled={disabled}
        className="min-h-12 w-full rounded-2xl bg-sage-200 px-6 py-3 text-base text-ink shadow-soft
                   transition hover:bg-sage-300 disabled:cursor-not-allowed disabled:bg-cream-200
                   disabled:text-ink-faint sm:w-auto sm:min-w-64"
      >
        ➕ 新增信眾
      </button>

      {hint && <p className="text-center text-xs text-ink-faint">{hint}</p>}

      {showCreate && <CreateDevoteeModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
