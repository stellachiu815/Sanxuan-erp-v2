-- V15R5：新增收款來源列舉值 ANNUAL_LANTERN_ITEM。
--
-- 年度燈統一後，光明燈／太歲燈／全家燈同掛一筆 ANNUAL_LANTERN RitualRecord，無法共用
-- 單一 LanternRegistration（@@unique(ritualRecordId) 會互相覆蓋金額）。改為以項目自身
-- 計價（RitualRegistrationItem.amountDue），透過本來源進待收款／收款中心（與龍鳳燈／贊普
-- 同一套 self-costed 機制）。祭改仍走既有 PURIFICATION_ENTRY。
--
-- 只新增一個必要的 enum 值，不改既有金流結構、不動任何既有資料。
ALTER TYPE "ReceivableSourceType" ADD VALUE IF NOT EXISTS 'ANNUAL_LANTERN_ITEM';
