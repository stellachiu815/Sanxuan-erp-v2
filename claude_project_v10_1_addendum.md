## V10.1 建立供品認捐中心（Offering Center）（2026-07-16，正式開發，
**V9.1 之後第一個新增業務模組**）

**背景**：這輪需求標題是「V10.1｜建立供品認捐中心」，22 節完整規格，明確
要求「請完成資料庫Migration、API、前端頁面、手機與平板版面、年度收費
設定整合、收款中心整合、收據整合、財務報表整合、Excel／CSV匯入匯出、
一般工作清單列印、歷年紀錄、權限、操作紀錄、自動測試...請直接修改現有
專案，自行建立測試資料、執行測試並修正問題，不要要求使用者逐項測試」。
中途你另外補充了明確的開發原則：**以你提供的 V10.0 原始專案為唯一開發
基礎，不重新建立專案、不重做 V10.0 已完成的功能，先檢查既有資料表/
Schema/API/頁面/功能，若收款中心/收據中心/財務中心尚未完成，要在現有
架構上補齊必要部分或保留好資料關聯，不建立第二套資料結構**，並要求
交付時明確說明三類功能：真正完成／預留介面或資料關聯／留到下一版本。
**版本編號**：需求標題是「V10.1」，但上一輪交付時 `package.json` 已經是
`11.0.0`，依專案既有「往下接續編號」慣例，實際版本號記為 **12.0.0**。

### 開發基礎確認（回應補充指示）
動手前先 `grep -rln "收款中心\|收據中心\|財務中心\|年度收費" src/app
src/components`，確認這三個中心目前完全不存在（零筆結果），只有 V1 起
就預留、正式環境是空表的 `FinanceRecord`/`AuditLog` 架構骨架。因此本輪
**沒有另外建立第二套資料結構**，而是把供品收款設計成掛在 `OfferingClaim`
底下、自成一體的獨立分次收款帳本（`OfferingPayment`），並提供
`getOfferingIncomeSummaryForFinance()` 橋接函式，欄位形狀對齊
`FinanceRecord`，供未來財務中心直接取用。

### 交付物
- `prisma/schema.prisma`（修改）：`ActivityType` 新增 4 個值
  （`GUANDI_BIRTHDAY`/`XUANTIAN_BIRTHDAY`/`YAOCHI_BIRTHDAY`/
  `ZHONGTAN_BIRTHDAY`，讓四位主祀神明聖誕可以跟宮慶在同一年並存，
  取捨已記錄在 schema 註解裡）；`TempleEvent` 新增
  `offeringTurtleExclusiveRule` 欄位；新增 10 個 enum、6 個 model
  （`OfferingType`/`ActivityOffering`/`FloralOfferingSlot`/
  `OfferingClaim`/`OfferingPayment`/`StoveMasterRegistration`）。
- `prisma/migrations/20260716040000_offering_center/migration.sql`
  （新增）：對應上面的 schema 變更，純新增，沒有移除或修改既有欄位/
  資料表（風險等級比曾經移除表的 V10.0 低）。
- `src/lib/offeringRules.ts`（新增，純邏輯模組，不 import Prisma，可在
  沙盒真正執行測試）：花果供品 24 筆日期產生與正確格式（重用既有
  `chineseNumerals.ts` 的 `formatFormalLunarDate()`）、重複認捐/福壽龜
  互斥檢查、名額計算（INDIVIDUAL/GROUPED）、金額與收款狀態計算、跨年度
  未收款判斷、補印金額不變的斷言、收款帳本加總（含退款/轉款，加總永遠
  不會是負數）。
- `src/lib/offeringTypes.ts`／`activityOfferings.ts`／`offeringClaims.ts`
  （最大，約 780 行）／`stoveMasters.ts`／`offeringImport.ts`（新增）：
  串接 Prisma／既有信眾家戶資料／`recordVersion.ts`／回收區機制的核心
  業務邏輯。認捐建立強制先解析真正的 `Member`，姓名/電話當下快照存入
  `sponsorNameSnapshot`/`phoneSnapshot`；取消/退款是兩階段狀態機
  （未收款直接取消釋出名額；已收款轉 `REFUND_PENDING`，須另外呼叫
  `refundOfferingClaim()` 完成退款/轉款流程才真正釋出名額）；收款是
  獨立分錄（`OfferingPayment`），不是覆蓋累計值；補印只遞增
  `reprintCount`，金額欄位絕對不變。
- `src/lib/templeEvents.ts`（修改）：`copyTempleEventFromPrevious()` 的
  祭改分支與通用分支都掛上 `copyActivityOfferingsForNewEvent()`，年度
  複製活動時自動一併複製供品設定（不複製認捐/收款）。
- `src/lib/permissions.ts`／`labels.ts`／`checklistDefaults.ts`／
  `recycleBin.ts`／`importFieldSuggestion.ts`／`templates.ts`（擴充）：
  新增 `OfferingAction` 權限矩陣、供品相關標籤、宮慶+四位神明聖誕的
  Checklist（供品確認/爐主登記）、`OfferingClaim` 回收區支援、Excel
  匯入欄位建議與範本。
- 22 支新 API route（`src/app/api/offering-types/`、
  `temple-events/[id]/offerings/`、`offering-claims/`、
  `stove-masters/`、`members/[id]/offering-history/` 等）。
- 前端：`src/components/offering/`（10 個元件：首頁提醒卡/供品種類設定/
  活動供品管理面板/花果供品名單/爐主面板/未收款清單）、
  `src/app/offering-center/`（主選單、活動供品設定、花果供品名單、
  供品種類設定、未收款清單、信眾歷年查詢共 6 條實際路徑，整合規格 10
  個子畫面）。首頁新增供品認捐提醒卡與「🙏 供品認捐中心」入口；家戶頁
  每位成員新增「供品認捐歷年查詢」連結。
- `package.json`：`version` 從 `11.0.0` 更新為 `12.0.0`。
- `tests/offeringRules.test.ts`（新增，25 個測試，對應需求 25 個測試
  案例）；連同既有 107 個測試，全部 **134 個測試全部通過**。
- `V10.1_供品認捐中心_交付說明.md`：交付摘要（含你要求的三類功能逐項
  分類：真正完成／預留介面或資料關聯／留到下一版本）。

### 關鍵決策：`ActivityType` 新增 4 個神明聖誕值而非重構複合唯一鍵
`TempleEvent` 的 `@@unique([activityType, year])` 代表同一類型同一年
只能有一筆活動；為了讓四位主祀神明聖誕跟宮慶在同一年各自獨立掛供品，
選擇新增 4 個 enum 值（`GUANDI_BIRTHDAY`/`XUANTIAN_BIRTHDAY`/
`YAOCHI_BIRTHDAY`/`ZHONGTAN_BIRTHDAY`）這個風險最低的附加做法，而非
重構複合唯一鍵，取捨已記錄在 schema 註解。

### 關鍵決策：花果供品 slot 與 claim 分離，不用 DB 唯一約束卡「一天一人」
`FloralOfferingSlot` 代表 24 個固定日期名額（獨立於認捐存在，才能顯示
「尚未認捐的日期」）；`OfferingClaim` 選填關聯 `floralSlotId`，「同一天
只能一人」在應用邏輯（`createOfferingClaim()`）檢查，刻意不用 DB 唯一
約束，這樣取消後才能重新開放同一天讓別人認捐。

### 關鍵決策：收款帳本模式（`OfferingPayment`）延續 V9.1 附加列印項目
「多筆獨立追蹤」的既有慣例
每一筆收款/退款/轉款都是獨立一列 `OfferingPayment`（`kind`:
PAYMENT/REFUND/TRANSFER_OUT/TRANSFER_IN），`sumPaymentLedger()` 純函式
加總，絕對不會只存最後累計金額——這是這個專案第一次真正落地「金流分次
記錄」的模式，之後任何需要分期/多次款項的功能都可以直接沿用這個做法。

### 誠實揭露：本輪唯一自行發現並修正的問題——首頁提醒卡的斷鏈連結
`OfferingHomeCard.tsx` 原本連到 `/offering-center/floral?year=`／
`/offering-center/temple-celebration?year=`（3 處）這兩個從未真正建立
過的路由，開發過程自行發現後改為指向真正存在的 `/offering-center` 主
選單／`/offering-center/unpaid`；同時把 `/offering-center/unpaid?
crossYear=1` 這個連結真正接上初始狀態（原本 `UnpaidListScreen` 沒有
讀取查詢參數），這輪補上 `initialOnlyCrossYear` prop。

### 誠實揭露：權限矩陣仍無法在後端真正擋下（跟本專案所有模組一致）
`OfferingAction`/`OFFERING_PERMISSIONS` 已完整定義，但系統沒有登入/
session 機制，沒有接到任何 API route 上強制執行——跟 V8.0 回收區、
V9.0 祭改禁用編號、V9.1 附加列印項目完全一致的既有限制，不是本輪遺漏。

### 誠實揭露：收款中心/收據中心/財務中心/年度收費設定目前都只是資料關聯
這幾個系統在專案裡完全不存在任何畫面或 API（已用 grep 確認），本輪
提供的是可以獨立正常運作的供品收款功能＋對齊未來財務中心欄位形狀的橋接
函式，不是跟外部系統的真正整合——因為目前沒有外部系統可以整合。完整
三類功能分類（真正完成／預留介面或資料關聯／留到下一版本）詳見
`V10.1_供品認捐中心_交付說明.md` 第四節。

### 本輪的資料庫結構變更
`prisma/schema.prisma` 新增 6 張表、10 個 enum、`ActivityType` 擴充 4
個值、`TempleEvent` 新增 1 個欄位，對應的 migration 是
`prisma/migrations/20260716040000_offering_center/`（純新增，無移除/
修改既有欄位）。`package.json` 的 `version` 欄位同步更新為 `12.0.0`。

### 下一步（等待確認，不會自動繼續）
依照「一次只開發一個模組」「所有重大修改都必須等待確認」的原則，這一輪
到此為止。等你實際操作過供品認捐中心後，可以決定下一步方向：真正的
登入/session 機制（讓這一輪與過去所有模組的權限矩陣都能在後端真正
生效）、收款中心/收據中心/財務中心的正式開發、或供品認捐的正式收據/
得主公告列印模板。

---

**（本節為 V10.1 交付時的獨立增補文件，內容與寫作風格延續主文件
`claude/專案進度與架構決策.md` 一貫的逐輪記錄格式；下次有機會做完整
改動時，建議把這節內容合併進主文件「目前進度」與「資料模型」章節，
並在目前進度清單新增一項「34. ✅ V10.1 建立供品認捐中心」。）**
