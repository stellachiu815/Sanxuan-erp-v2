-- V13.3B（第二段）：TempleEvent 新增寶袋年度預設單價
--
-- 與上一段分開的理由見 20260723000000 的說明（PostgreSQL enum ADD VALUE
-- 不能與使用該值的操作放在同一個 transaction）。這一段本身沒有用到新的
-- enum 值，但維持分開比較安全，也讓兩件事在版本歷史上各自獨立、可個別回溯。
--
-- ⚠️ 純附加，且**刻意為 NULL**：
--   * 既有活動一律維持 NULL，不會被強制改價（指令第十階段：
--     「不得因 migration 將所有歷史資料強制改價」）
--   * 程式讀取時 fallback 到 300（src/lib/pocketPricing.ts）
--   * 既有寶袋的 unitPrice 是建立當下的快照，完全不受這個欄位影響
--
-- 金額型別沿用全專案一致的 DECIMAL(12,2)。

ALTER TABLE "temple_events" ADD COLUMN "pocketUnitPrice" DECIMAL(12,2);
