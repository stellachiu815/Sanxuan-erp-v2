-- V41：光明燈／太歲燈／祭改 改為「一人一份」。
-- 同一個人同一項目不再建立第二筆（份數 quantity 仍可填多盞，只是不會有兩筆同項目報名）。
-- 種子為 create-only 不會更新既有紀錄，故以本 migration 更新正式資料庫既有的這三個項目。
-- 冪等：重跑只是再次設為 false，無副作用。全家燈（LANTERN_FAMILY）本來就是一人一份，不動。
UPDATE "registration_item_types"
SET "allowMultiplePerMember" = false
WHERE "key" IN ('LANTERN_GUANGMING', 'LANTERN_TAISUI', 'LANTERN_PURIFICATION');
