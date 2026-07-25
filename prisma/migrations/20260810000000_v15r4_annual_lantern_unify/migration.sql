-- V15R4 年度燈統一（正式規格）：每一年度只有一個「年度燈」TempleEvent，
-- 其下固定四個 RegistrationItemType（光明燈／太歲燈／全家燈／祭改），四項共用
-- 同一活動狀態、年度帳本、統計與列印入口；祭改不再是獨立 TempleEvent。
--
-- ── 根因與最小必要變更 ─────────────────────────────────────────
-- 原本四個 RegistrationItemType 各自掛不同的 activityType（GUANGMING_LANTERN／
-- TAISUI_LANTERN／FAMILY_LANTERN／PURIFICATION），而 ensureRitualRecord 以
-- itemType.activityType 對應 TempleEvent（@@unique[activityType, year]）與
-- RitualRecord（@@unique[householdId, year, activityType]）——因此四項被拆成
-- 四個獨立 TempleEvent。
--
-- 最小必要變更＝把這四列的 activityType 統一改為**既有的** ANNUAL_LANTERN enum 值：
--   * ANNUAL_LANTERN 早已存在於 ActivityType enum（schema 標註為 V1 舊欄位保留），
--     不新增 enum 值。
--   * activityType 欄位早已存在，不改結構、不新增欄位、不新增資料表。
-- 改完後四項一律走 activityType=ANNUAL_LANTERN → 單一 TempleEvent、單一 RitualRecord，
-- 光明燈／太歲燈／全家燈／祭改的 RitualRegistrationItem 全部掛在同一筆底下。
--
-- ── 舊資料相容策略 ─────────────────────────────────────────────
-- 只更新「項目型別定義」四列，不搬移任何既有 RitualRecord／RitualRegistrationItem／
-- PurificationEntry。舊年度四個獨立 TempleEvent 與其報名／祭改資料維持原狀、可正常
-- 讀取與列印（祭改模組同時接受 PURIFICATION 舊事件與 ANNUAL_LANTERN 新事件）。
-- 新年度／新建立資料一律寫入單一 ANNUAL_LANTERN TempleEvent。
--
-- 冪等：以 key 精準比對，可重複執行；只改這四列，不動其他項目型別。

UPDATE "registration_item_types"
SET "activityType" = 'ANNUAL_LANTERN'
WHERE "key" IN ('LANTERN_GUANGMING', 'LANTERN_TAISUI', 'LANTERN_FAMILY', 'LANTERN_PURIFICATION')
  AND "activityType" <> 'ANNUAL_LANTERN';
