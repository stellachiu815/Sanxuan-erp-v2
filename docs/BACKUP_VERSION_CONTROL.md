# 台北三玄宮 ERP — 備份、還原與版本管理系統（V8.0）

**狀態：本文件涵蓋 V8.0 整體十大項需求的範圍規劃，以及第一個子模組
「資料版本紀錄＋刪除保護」的實際程式碼設計（已完成、已寫入
`prisma/schema.prisma`／`src/lib/`／`src/app/api/`／`src/components/`，
尚待部署與實機測試）。其餘子模組（手動備份、資料還原核心、程式版本管理
頁面、更新保護、備份儲存位置、權限強化）尚未開發，規劃如下方第三節。**

本文件是 `prisma/schema.prisma`、`src/lib/recycleBin.ts`、
`src/app/api/recycle-bin/restore/route.ts` 等程式碼註解中提到「見
docs/BACKUP_VERSION_CONTROL.md 已知限制與風險事項」的權威文件，記錄這
一輪實際做了什麼、還沒做什麼、以及已知的限制與風險，方便日後接續開發時
查閱，不需要重新爬程式碼推敲設計理由。

---

## 目錄

1. V8.0 原始需求十大項對照表
2. 本輪（V8.0 第一子模組）實際完成範圍
3. 尚未開發的子模組與後續規劃
4. 已知限制與風險事項
5. 受影響檔案清單

---

## 一、V8.0 原始需求十大項對照表

| 項次 | 需求 | 本輪狀態 |
|---|---|---|
| 一、自動備份 | 每日/每週/每月自動備份 | 尚未開發 |
| 二、手動備份 | 管理者隨時建立備份 | 尚未開發 |
| 三、資料還原 | 選擇備份版本還原 | 尚未開發 |
| 四、資料版本紀錄 | 重要資料保留修改歷史 | **本輪已開發**（範圍見第二節） |
| 五、刪除保護 | 回收區、30 天保留、管理者可恢復 | **本輪已開發**（範圍見第二節） |
| 六、程式版本管理 | 版本資訊頁面 | 尚未開發 |
| 七、更新保護 | 更新前自動備份、失敗可回復 | 尚未開發 |
| 八、備份儲存位置 | 本機/雲端/手動下載 | 尚未開發 |
| 九、權限 | 只有超級管理員可操作備份/還原/版本 | 尚未開發（見第四節「權限」限制） |
| 十、設計原則 | 完整整合、簡單安全、資料完整性優先 | 持續適用於已開發的部分 |

十大項是一次性的完整需求說明；依照專案「一次只開發一個模組」的原則，
這一輪只實作第四項（資料版本紀錄）與第五項（刪除保護），其餘七項留待
後續分別確認、分別開發，不會一次做完整個備份系統。

---

## 二、本輪（V8.0 第一子模組）實際完成範圍

### 2.1 資料版本紀錄（RecordVersion）

- 新增 `RecordVersion` 資料表（`prisma/schema.prisma`），記錄
  `entityType`／`entityId`／`action`（CREATE/UPDATE/DELETE/RESTORE/PURGE）
  ／`beforeData`／`afterData`（JSON 快照）／`operatorName`（自由文字）／
  `changeNote`／`createdAt`。
- 只對「目前已經有真正修改/建立 API」的資料實際寫入版本紀錄，沒有為了
  這個功能而新增原本不存在的修改/刪除流程：
  - **家戶（Household）**：PATCH 修改會記錄一筆 UPDATE。目前系統沒有
    「刪除家戶」的 API/UI，所以家戶不會出現 DELETE 版本紀錄。
  - **成員（Member）**：POST 新增會記錄一筆 CREATE。目前系統沒有
    「修改/刪除成員」的 API/UI，所以成員只會有 CREATE 版本紀錄，不會有
    UPDATE/DELETE。
  - **普渡登記（RitualRecord + UniversalSalvationDetail +
    UniversalSalvationEntry）**：建立（複製去年資料／建立空白登記）、
    修改明細、新增/修改/刪除登記項目、刪除整筆登記，全部都有對應的
    CREATE/UPDATE/DELETE 版本紀錄。
- 提供「修改紀錄」畫面（`VersionHistoryPanel` 元件），可以查看某筆資料
  的完整歷史、展開查看修改前後差異、並可以把 CREATE/UPDATE 類型的版本
  「回復」到當時的欄位內容（`src/lib/versionRestore.ts`）。回復動作本身
  也會留下一筆新的 RESTORE 版本紀錄，時間軸不會出現空洞。
- 家戶詳細頁的「快速操作」面板新增「🕘 修改紀錄」按鈕，開啟家戶本身的
  修改紀錄。

### 2.2 刪除保護（回收區）

- `Household`／`Member`／`RitualRecord`／`UniversalSalvationEntry` 四張
  表新增 `deletedAt`／`deletedByName` 欄位（軟刪除），所有正常查詢
  （搜尋、家戶詳細頁、時間軸、普渡登記畫面等）都已改為只讀取
  `deletedAt: null` 的資料。
- 目前只有「普渡登記」有真正的刪除 API（`deleteUniversalSalvationRecord`／
  `deleteUniversalSalvationEntry`），這兩支已經從真正的 SQL DELETE 改成
  軟刪除。Household／Member 的軟刪除欄位已經建好，但**這一輪沒有新增
  「刪除家戶」或「刪除成員」的 API/UI**——避免自行增加需求裡沒有的流程。
  等未來真的需要「刪除家戶/成員」功能、正式確認需求後，可以直接沿用
  已經建好的 `deletedAt` 欄位與回收區機制，不需要再改資料庫結構。
- 新增「🗑 回收區」頁面（`/system/recycle-bin`），列出所有已軟刪除的
  資料（目前實際上只會出現普渡登記/登記項目，因為只有這兩種有刪除
  入口），可以個別「還原」，超過 30 天保留期限後可以「永久刪除」
  （`RECYCLE_BIN_RETENTION_DAYS = 30`，見 `src/lib/recycleBin.ts`）。
  永久刪除前也會寫入一筆 PURGE 版本紀錄（含刪除前的完整快照），即使
  原始資料列真的消失，還是留得住「曾經存在過什麼」的紀錄。

---

## 三、尚未開發的子模組與後續規劃

以下維持 V8.0 原始需求的完整項目，但**都還沒有開始開發**，需要在下一輪
分別確認範圍後才會動工（每次只做一個）：

1. **手動備份＋資料還原核心**（原始需求二、三）：管理者建立一份完整
   資料庫備份（時間/建立者/大小/內容/說明），並可以選擇任一備份版本
   整批還原（還原前顯示警告、再次確認、自動建立目前資料的臨時備份）。
2. **程式版本管理頁面**（原始需求六）：獨立的版本資訊頁面，記錄每次
   系統更新的版本號/日期/內容/修正/新增功能。
3. **更新保護**（原始需求七）：系統更新前自動建立完整備份，更新失敗
   可以立即回復上一版本。這一項高度依賴實際部署方式（Render 等），
   需要先確認部署流程才能設計。
4. **自動排程備份**（原始需求一）：每日/每週/每月自動備份，涵蓋全部
   資料表。這一項也需要先確認實際部署環境是否支援排程工作
   （cron job／worker），才能決定技術做法。
5. **備份儲存位置**（原始需求八）：本機下載/雲端儲存/管理者手動下載，
   需要與「手動備份」「自動備份」一起確認儲存方案（例如是否要接
   S3-相容的雲端儲存服務）。
6. **權限強化**（原始需求九）：只有超級管理員可以操作備份/還原/永久
   刪除/查看所有版本紀錄。目前系統完全沒有登入/session 機制
   （見第四節），這一項只能等登入功能做出來後才能真正落實。

---

## 四、已知限制與風險事項

1. **沒有登入/session 機制，`operatorName` 是自由文字、未經驗證。**
   `src/lib/permissions.ts` 的 `getCurrentUser()` 目前永遠回傳 `null`，
   系統還沒有辦法知道「誰」正在操作。這一輪的 `RecordVersion.operatorName`
   與回收區的「操作人姓名」欄位，都是使用者自己在畫面上填寫的文字，
   **不是後端驗證過的真實身份**。這代表：
   - 任何人都可以在欄位填寫任意姓名，甚至留空。
   - 無法用這個欄位做真正的權限判斷或究責。
   - 這是刻意的暫時設計，不是疏漏——等系統做出登入/session 機制後，
     應該把 `operatorName` 升級成真正關聯 `User` 的外鍵欄位，並在
     API 層自動帶入目前登入者，不再需要使用者自己填寫。
2. **需求「九、權限」（只有超級管理員可操作）目前無法在後端強制執行。**
   回收區頁面與修改紀錄頁面目前對所有人開放，只在畫面上用文字提醒
   「這裡本來應該限定超級管理員」，沒有真正的存取控制。等登入/session
   與角色驗證機制做出來後，必須在 `/api/recycle-bin/*` 與
   `/api/version-history/*` 這幾支 API 補上後端角色檢查，不能只靠前端
   畫面提示。
3. **回收區與版本紀錄的範圍不對稱。** 家戶與成員的 `deletedAt` 欄位
   已經存在於資料庫，但沒有對應的刪除 API/UI，所以回收區裡「實際上」
   只會出現普渡登記與登記項目。這不是 bug，是刻意的範圍控制（見第二節
   說明），但未來如果新增「刪除家戶/成員」功能時，要記得同步在
   `src/lib/recycleBin.ts` 的 `listRecycleBin()`／`restoreRecycleBinItem()`／
   `purgeRecycleBinItem()` 裡補上真正可執行的 case（目前程式碼架構已經
   預留了這些型別與 switch 分支，只是還沒有實際的刪除入口會觸發它們）。
4. **`RecordVersion` 與既有 `AuditLog` 是兩張不同的表，刻意不合併。**
   `AuditLog` 是財務模組原本就設計好、`operatorId` 為必填 User 外鍵的
   稽核表，這一輪沒有動它。`RecordVersion` 是這一輪新增、`entityType`/
   `entityId` 是通用字串（非外鍵）的版本歷史表。兩者的定位不同，未來
   財務模組正式上線、系統有登入機制後，可以評估是否要統一或保留分開。
5. **唯一鍵（`@@unique([householdId, year, activityType])`）不因軟刪除
   而釋放。** 同一戶同一年度的普渡登記如果被移入回收區，這個組合鍵
   依然「被佔用」，無法直接建立新的一筆——這是刻意的設計（避免同一個
   唯一鍵同時存在兩筆語意衝突的資料），程式已經在建立時偵測這種情況並
   給出「請先從回收區還原」的明確錯誤訊息，不會讓使用者誤以為系統壞了。
6. **無法在目前的開發環境（sandbox）實際執行 `prisma migrate dev`、
   `npm install`、或啟動伺服器測試。** 這一輪的 migration SQL
   （`prisma/migrations/20260716000000_version_history_recycle_bin/`）
   是依照既有 migration 的手寫風格產生，schema 變更已經過括號/大括號
   平衡檢查與 import 路徑檢查，但**尚未經過真正的資料庫 migration 執行
   與應用程式建置測試**，部署後請務必先在測試環境跑過一次
   `prisma migrate deploy` 並實際操作過一輪（新增→修改→刪除→回收區
   還原→查看修改紀錄→回復到舊版本）再上線使用。

---

## 五、受影響檔案清單

- `prisma/schema.prisma`（新增欄位/新增資料表）
- `prisma/migrations/20260716000000_version_history_recycle_bin/migration.sql`（新增）
- `src/lib/recordVersion.ts`（新增）
- `src/lib/recycleBin.ts`（新增）
- `src/lib/versionRestore.ts`（新增）
- `src/lib/ritual.ts`（修改：軟刪除、版本紀錄、`deletedAt` 過濾）
- `src/lib/household.ts`（修改：`deletedAt` 過濾）
- `src/lib/timeline.ts`（修改：`deletedAt` 過濾）
- `src/app/api/households/[id]/route.ts`（修改）
- `src/app/api/households/[id]/members/route.ts`（修改）
- `src/app/api/households/[id]/worship/route.ts`（修改：`deletedAt` 過濾）
- `src/app/api/households/[id]/rituals/universal-salvation/[year]/route.ts`（修改）
- `src/app/api/households/[id]/rituals/universal-salvation/[year]/entries/route.ts`（修改）
- `src/app/api/households/[id]/rituals/universal-salvation/[year]/entries/[entryId]/route.ts`（修改）
- `src/app/api/search/route.ts`（修改：`deletedAt` 過濾）
- `src/app/household/[id]/rituals/universal-salvation/page.tsx`（修改：`deletedAt` 過濾）
- `src/app/household/[id]/rituals/universal-salvation/print/page.tsx`（修改：`deletedAt` 過濾）
- `src/app/api/version-history/route.ts`（新增）
- `src/app/api/version-history/restore/route.ts`（新增）
- `src/app/api/recycle-bin/route.ts`（新增）
- `src/app/api/recycle-bin/restore/route.ts`（新增）
- `src/app/api/recycle-bin/purge/route.ts`（新增）
- `src/components/system/ConfirmDialog.tsx`（新增）
- `src/components/system/VersionHistoryPanel.tsx`（新增）
- `src/components/system/RecycleBinScreen.tsx`（新增）
- `src/app/system/recycle-bin/page.tsx`（新增）
- `src/components/household/QuickActionsPanel.tsx`（修改：新增「修改紀錄」按鈕）
- `src/app/page.tsx`（修改：新增「回收區」入口連結）

（未列出未修改的其他既有檔案。已知的小範圍不一致——匯入批次比對
`docs/`下`import`相關流程中，比對既有家戶編號時尚未排除已軟刪除的家戶
——維持現狀不變，屬於既有匯入功能的既有行為，不在這一輪範圍內調整。）
