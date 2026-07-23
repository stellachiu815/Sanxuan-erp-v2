-- V14.1：對外文字「補褲」統一更正為「補庫」。
--
-- ⚠️ 只更新「顯示文字」欄位（name／activityGroupName），且只針對這個固定 key，
-- 不動 key、不動 enum、不動任何金額或關聯。冪等：再次執行結果相同。
-- internal key／ReceivableSourceType 仍為 STORAGE_TROUSERS（避免破壞既有資料）。
UPDATE "registration_item_types"
   SET "name" = '補庫報名', "activityGroupName" = '補庫'
 WHERE "key" = 'STORAGE_TROUSERS'
   AND ("name" = '補褲報名' OR "activityGroupName" = '補褲');

-- 列印模板顯示名稱一併更正（若已建立）。
UPDATE "template_definitions"
   SET "name" = '補庫報名總名單'
 WHERE "category" = 'PRINT' AND "key" = 'STORAGE_TROUSERS_ROSTER' AND "name" = '補褲報名總名單';

-- 對外文字：冤親債主 → 累世冤親債主（只改顯示名，key 不動）。
UPDATE "registration_item_types"
   SET "name" = '累世冤親債主'
 WHERE "key" = 'US_YUANQIN' AND "name" = '冤親債主';
