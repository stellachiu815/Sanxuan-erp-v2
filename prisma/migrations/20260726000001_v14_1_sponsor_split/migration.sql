-- V14.1：贊普 / 隨喜贊普 拆成兩個獨立、可同時勾選的品項。
--
-- ⚠️ 向下相容、冪等：
--  1) 既有「贊普」改為固定單價模式（feeMode=FIXED），並清掉先前錯誤寫死的
--     預設金額（不寫死價格，改讀活動贊普價格設定；未設定時顯示尚未設定）。
--  2) 新增「隨喜贊普」品項（自訂金額）——INSERT ... ON CONFLICT DO NOTHING。
--  兩者 key 各自獨立、分開保存/計價/列印，不重複建立應收。

UPDATE "registration_item_types"
   SET "feeMode" = 'FIXED', "defaultUnitPrice" = NULL, "allowMultiplePerMember" = true
 WHERE "key" = 'US_SPONSOR';

INSERT INTO "registration_item_types"
  ("id","activityType","activityGroup","activityGroupName","key","name","contentKind","feeMode","defaultUnitPrice","defaultQuantity","allowMultiplePerMember","printDocumentKeys","metadataJson","sortOrder","isActive","updatedAt")
VALUES
  ('rit_us_sponsor_donation','UNIVERSAL_SALVATION','UNIVERSAL_SALVATION','中元普渡','US_SPONSOR_DONATION','隨喜贊普','SPONSOR','CUSTOM',NULL,1,true, ARRAY['US_SPONSOR_ROSTER'], NULL, 8, true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
