-- V14（第三段）：報名項目種子資料（普渡 7 / 年度燈 4 / 宮慶 3 / 補褲 / 龍鳳燈）
--
-- ⚠️ 冪等（idempotent）：固定 id + ON CONFLICT (key) DO NOTHING，可重複執行、
-- 不覆蓋管理者事後調整過的數量／單價。純 INSERT，不 UPDATE、不 DELETE 既有資料。
-- 數量與單價都存在資料裡（如福壽大龜=1、中龜=6），管理者可改，程式不寫死。

INSERT INTO "registration_item_types"
  ("id","activityType","activityGroup","activityGroupName","key","name","contentKind","feeMode","defaultUnitPrice","defaultQuantity","allowMultiplePerMember","printDocumentKeys","metadataJson","sortOrder","isActive","updatedAt")
VALUES
  -- ── 中元普渡：七項 ──────────────────────────────────────────
  ('rit_us_ancestor','UNIVERSAL_SALVATION','UNIVERSAL_SALVATION','中元普渡','US_ANCESTOR','超拔祖先','TABLET','NONE',NULL,1,true, ARRAY['US_ANCESTOR_TABLET','US_BASIC_POCKET'], NULL, 1, true, CURRENT_TIMESTAMP),
  ('rit_us_zhenghun','UNIVERSAL_SALVATION','UNIVERSAL_SALVATION','中元普渡','US_ZHENGHUN','乙位正魂','TABLET','NONE',NULL,1,true, ARRAY['US_ZHENGHUN_TABLET'], NULL, 2, true, CURRENT_TIMESTAMP),
  ('rit_us_yuanqin','UNIVERSAL_SALVATION','UNIVERSAL_SALVATION','中元普渡','US_YUANQIN','冤親債主','TABLET','NONE',NULL,1,true, ARRAY['US_YUANQIN_TABLET','US_BASIC_POCKET'], NULL, 3, true, CURRENT_TIMESTAMP),
  ('rit_us_wuyuan','UNIVERSAL_SALVATION','UNIVERSAL_SALVATION','中元普渡','US_WUYUAN','無緣子女','TABLET','NONE',NULL,1,true, ARRAY['US_WUYUAN_TABLET','US_BASIC_POCKET'], NULL, 4, true, CURRENT_TIMESTAMP),
  ('rit_us_pocket_extra','UNIVERSAL_SALVATION','UNIVERSAL_SALVATION','中元普渡','US_POCKET_EXTRA','增加寶袋','POCKET','PER_UNIT',300,1,true, ARRAY['US_EXTRA_POCKET'], NULL, 5, true, CURRENT_TIMESTAMP),
  ('rit_us_rice','UNIVERSAL_SALVATION','UNIVERSAL_SALVATION','中元普渡','US_RICE','白米登記','RICE','NONE',NULL,1,false, ARRAY['US_RICE_ROSTER'], NULL, 6, true, CURRENT_TIMESTAMP),
  ('rit_us_sponsor','UNIVERSAL_SALVATION','UNIVERSAL_SALVATION','中元普渡','US_SPONSOR','贊普','SPONSOR','FIXED_OR_CUSTOM',NULL,1,false, ARRAY['US_SPONSOR_ROSTER'], NULL, 7, true, CURRENT_TIMESTAMP),

  -- ── 年度燈：四項（跨 GUANGMING/TAISUI/FAMILY/PURIFICATION 四種 activityType）──
  ('rit_lantern_guangming','GUANGMING_LANTERN','ANNUAL_LANTERN','年度燈','LANTERN_GUANGMING','光明燈','LANTERN','PER_UNIT',500,1,true, ARRAY['GUANGMING_LANTERN_TABLET','GUANGMING_LANTERN_PETITION'], NULL, 1, true, CURRENT_TIMESTAMP),
  ('rit_lantern_taisui','TAISUI_LANTERN','ANNUAL_LANTERN','年度燈','LANTERN_TAISUI','太歲燈','LANTERN','PER_UNIT',500,1,true, ARRAY['TAISUI_LANTERN_TABLET','TAISUI_LANTERN_PETITION'], NULL, 2, true, CURRENT_TIMESTAMP),
  ('rit_lantern_family','FAMILY_LANTERN','ANNUAL_LANTERN','年度燈','LANTERN_FAMILY','全家燈','LANTERN','FIXED',NULL,1,false, ARRAY['FAMILY_LANTERN_TABLET','FAMILY_LANTERN_PETITION'], NULL, 3, true, CURRENT_TIMESTAMP),
  ('rit_lantern_purification','PURIFICATION','ANNUAL_LANTERN','年度燈','LANTERN_PURIFICATION','祭改','PURIFICATION','NONE',NULL,1,true, ARRAY['PURIFICATION_STICKER'], NULL, 4, true, CURRENT_TIMESTAMP),

  -- ── 宮慶：三項（福壽龜的大龜/中龜子項數量存 metadataJson，可改）──
  ('rit_celebration_table','TEMPLE_CELEBRATION','TEMPLE_CELEBRATION','宮慶','CELEBRATION_TABLE','訂桌名單','TABLE','PER_UNIT',NULL,1,true, ARRAY['CELEBRATION_TABLE_ROSTER'], '{"tableKinds":[{"key":"DEVOTEE","name":"信眾訂桌"},{"key":"ALLIED_TEMPLE","name":"友宮訂桌"}]}', 1, true, CURRENT_TIMESTAMP),
  ('rit_celebration_turtle','TEMPLE_CELEBRATION','TEMPLE_CELEBRATION','宮慶','CELEBRATION_TURTLE','福壽龜','TURTLE','PER_UNIT',NULL,1,true, ARRAY['CELEBRATION_TURTLE_ROSTER'], '{"sizes":[{"key":"BIG","name":"福壽大龜","defaultQuantity":1},{"key":"MID","name":"福壽中龜","defaultQuantity":6}]}', 2, true, CURRENT_TIMESTAMP),
  ('rit_celebration_stove','TEMPLE_CELEBRATION','TEMPLE_CELEBRATION','宮慶','CELEBRATION_STOVE','爐主／副爐主名單','STOVE','NONE',NULL,1,false, ARRAY['CELEBRATION_STOVE_ROSTER'], NULL, 3, true, CURRENT_TIMESTAMP),

  -- ── 補褲：只有名單＋收費＋收據＋總名單 ──
  ('rit_storage_trousers','STORAGE_REPAYMENT','STORAGE_REPAYMENT','補褲','STORAGE_TROUSERS','補褲報名','ROSTER','CUSTOM',NULL,1,false, ARRAY['STORAGE_TROUSERS_ROSTER'], NULL, 1, true, CURRENT_TIMESTAMP),

  -- ── 龍鳳燈：報名＋固定列印格式＋年底名單＋總名單 ──
  ('rit_dragon_phoenix','DRAGON_PHOENIX_LANTERN','DRAGON_PHOENIX_LANTERN','龍鳳燈','DRAGON_PHOENIX','龍鳳燈報名','LANTERN','PER_UNIT',NULL,1,true, ARRAY['DRAGON_PHOENIX_LANTERN_TABLET','DRAGON_PHOENIX_LANTERN_ROSTER'], NULL, 1, true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
