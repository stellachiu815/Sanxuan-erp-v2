# 台北三玄宮 ERP — 月底自動財務報表（Monthly Financial Report）規格定稿（V7.1.1）

**狀態：規格、資料模型、流程圖、低保真 Wireframe、排程方案、Migration
計畫定案，尚未實作、尚未套用 migration、尚未開發任何正式 UI/API、尚未
執行 Build、尚未變更正式資料庫。**

本文件是「月底自動財務報表」的權威規格文件，涵蓋每月自動產生上個月
財務報表草稿、依活動/依帳戶分開統計、代收待繳回附件、報表確認與鎖定、
跨月調整、A4 列印版式。**本輪不得推翻**既有 V7.0 Finance Core、
V7.0.2 Annual Activity Engine、V7.0.3 報名當下立即付款、V7.1
Collection Center、以及本次同時交付的
`docs/AGENT_COLLECTION_RECONCILIATION.md` 的架構。

---

## 目錄

1. 目標與核心原則
2. 月底報表產生時機與期間定義
3. 報表內容總覽
4. 依活動分開統計
5. 依帳戶分開對帳
6. 代收人對帳附件
7. 資料模型：`MonthlyFinancialReport`
8. 報表狀態機
9. 報表確認與鎖定規則
10. 遲到資料與跨月更正：`PeriodAdjustment`
11. 報表編號規則
12. 列印與匯出
13. 首頁「上月財務報表待對帳」提醒卡
14. 低保真 Wireframe（A4 版式）
15. ER Diagram
16. 月底關帳流程圖
17. 報表產生流程圖
18. 對帳與鎖定流程圖
19. 跨月調整流程圖
20. 建議 Prisma Schema
21. 排程方案
22. 哪些資料可以沿用／哪些要新增
23. Migration 計畫（本輪不執行）
24. 開發順序
25. 風險與尚待確認事項
26. 本輪確認：本次完全沒有做的事

---

## 一、目標與核心原則

三玄宮需要一份「每個月自動生成、但不會自動變成正式定案」的財務報表：
系統在次月初自動把上個月所有活動、帳戶、代收款的數字彙整成一份草稿，
行政人員核對無誤後才正式確認鎖定，之後如果發現遺漏或錯誤，只能用
「調整紀錄」處理，不能悄悄改掉已經鎖定的歷史報表。

**核心原則**：

1. **草稿自動產生，鎖定需要人工確認**——系統絕不自行判斷「這個月的
   帳沒問題」就自動鎖定，永遠停在草稿或待對帳狀態，等管理者確認。
2. **已鎖定的報表是歷史事實的快照，不可被之後補登的資料悄悄覆蓋**
   ——任何遲到資料都走 `PeriodAdjustment`，明確標示「這是事後的調整」，
   不會讓 115 年 7 月的報表因為 8 月才發現的一筆漏帳而在無聲無息中
   變動內容。
3. **報表數字必須跟收款中心、代收對帳、財務核心的既有資料完全一致**
   ——本文件不重新設計任何金額計算邏輯，只是把
   `Receivable`/`Payment`/`LedgerEntry`/`FinancialAccount`/
   `AgentCollectionItem` 既有欄位在月底做一次彙總快照。

---

## 二、月底報表產生時機與期間定義

**時區固定 Asia/Taipei**。報表期間：每月 1 日 00:00:00 至該月最後一日
23:59:59（依國曆月份，例如 115 年 7 月 = 2026-07-01 00:00:00 至
2026-07-31 23:59:59）。

**建議執行時間：次月 1 日 00:10**（例如 115 年 8 月 1 日 00:10 自動
產生 115 年 7 月份財務報表草稿）——刻意晚 10 分鐘於午夜整點執行，
留一點緩衝，避免系統時鐘或排程觸發的些微誤差導致「上月最後一秒的交易」
被誤判到下個月，**不得因報表產生時間延遲，把次月資料算入上月**——
報表的資料篩選一律以 `periodStart`/`periodEnd` 這兩個明確的時間戳記
為準，不是以「排程實際執行的時間」為準，兩者必須分開看待。

---

## 三、月底報表至少包含

| # | 項目 | 資料來源 |
|---|---|---|
| 1 | 月初餘額 | 上月報表的「月底帳面餘額」快照（第一份報表則為系統啟用時的期初值） |
| 2 | 本月收入 | 本期間內 `LedgerEntry.type=INCOME` 加總 |
| 3 | 本月支出 | 本期間內 `LedgerEntry.type=EXPENSE` 加總 |
| 4 | 月底帳面餘額 | 月初餘額 + 本月收入 − 本月支出 |
| 5 | 現金餘額 | `FinancialAccount.type="CASH"` 的期末餘額 |
| 6 | 各銀行帳戶餘額 | 各 `FinancialAccount.type="BANK"` 的期末餘額（見第五節） |
| 7 | 應收總額 | 本期間內活躍 `Receivable.totalAmount` 加總 |
| 8 | 已收總額 | `Receivable.paidAmount` 加總 |
| 9 | 未收總額 | `Receivable.unreceivedAmount` 加總 |
| 10 | 代收人保管中總額 | `AgentCollectionItem.status IN (PENDING, PARTIAL)` 的未繳回餘額加總 |
| 11 | 已繳回代收款總額 | 本期間內確認的 `ReconciliationBatch.actualReceivedAmount` 加總 |
| 12 | 尚未繳回代收款總額 | 同第 10 項（月底時點快照） |
| 13 | 有爭議待確認金額 | `status=DISPUTED` 的 `AgentCollectionItem`/`ReconciliationBatch` 加總 |
| 14 | 退款金額 | 本期間內 `isRefund=true` 的 `Payment` 加總 |
| 15 | 作廢收款紀錄 | 本期間內 `Payment.status=VOIDED` 或 `Receivable.status=VOIDED` 筆數與金額 |
| 16 | 電子收據開立張數 | 預留欄位（電子收據正式模板本輪不開發，見第二十六節） |
| 17 | 作廢收據張數 | 預留欄位（同上） |
| 18 | 尚未列印收據張數 | 預留欄位（同上） |
| 19 | 前期調整金額 | 本期間內生效的 `PeriodAdjustment.amount` 加總（第十節） |
| 20 | 本月差額調整金額 | 本期間內 `ReconciliationBatch.discrepancyAmount` 已處理完成部分的加總 |

第 16-18 項（電子收據張數）在目前系統裡沒有對應的資料來源（電子收據
模組本輪明確排除在開發範圍外），欄位先保留在報表快照結構中，值先固定
為 0 或 null，等電子收據模組正式開發後再串接真實數字——這是**明確的
欄位預留**，不是本輪就要做出收據功能。

---

## 四、依活動分開統計

依 V7.0.2 既有的七項年度活動固定順序分區：年度燈、祭改、南巡、宮慶、
普渡、補庫、北巡。每個活動至少顯示：報名應收、本月實收、累計實收、
未收、本月支出、累計支出、活動結餘（沿用 V7.0 `ActivitySummary` 既有
彙總欄位精神，本報表只是把 `ActivitySummary` 在月底時間點的快照
收斂進 `MonthlyFinancialReport`，不重新設計活動損益計算邏輯）。

**年度燈需再分**：光明燈、太歲燈、全家燈（`FamilyLampGroup`，沿用
V7.1 第八節既有設計）三個子分類各自的應收/實收/未收數字。

**南巡與北巡另外顯示**：各車次人數、各車次車資、雙人房加價、海報
贊助、活動總額（沿用 V6.2/V7.0/V7.1 既有的 `TourVehicle`/
`TourRoomCharge` 資料，本報表只做彙總呈現）。

**普渡**：內部完整祭祀明細維持既有隱藏規則（V6.3 ADR-0007，四個內部
類別不對外顯示），對外報表只依財務項目統計（贊普/白米/一般報名金額
加總），不顯示歷代祖先/個人乙位正魂/冤親債主/無緣子女等敏感祭祀文字
——這條規則延伸適用到月底報表的呈現，不是只限於個別收款畫面。

---

## 五、依帳戶分開對帳

每個 `FinancialAccount` 在報表中分別顯示：帳戶名稱、期初餘額、本月
收入、本月支出、系統計算月底餘額、實際盤點或銀行對帳單餘額（人工
輸入）、差額（系統計算 − 實際輸入）、差額說明、對帳狀態。

**對帳狀態**：`UNRECONCILED`（尚未對帳）／`MATCHED`（已對帳相符）／
`DISCREPANCY`（有差額待處理）／`ADJUSTED`（已調整完成）。

**帳面餘額與實際餘額不同時，不得自行修改帳目使其相符**——必須保留
差額、必須填寫原因、必須保留調整紀錄（走第十節 `PeriodAdjustment`
流程，或至少在報表本身的「差額說明」欄位留下文字記錄，視差額金額大小
決定是否需要正式的調整紀錄，見第二十五節尚待確認事項）。

---

## 六、代收人對帳附件

月底報表附上代收明細，依代收人分組顯示：本月代收總額、本月已繳回、
月底尚未繳回、尚未繳回筆數、最久未繳回天數、已提醒次數、有爭議款項、
最後一次繳回日期——這些數字全部從
`docs/AGENT_COLLECTION_RECONCILIATION.md` 定義的 `AgentCollectionItem`/
`ReconciliationBatch` 彙總而來，本文件不重新定義代收款的資料結構，
只負責在月底做一次快照。

**尚未繳回款項可以列為信眾已付款，但不可算入宮內現金或銀行餘額**
——這正是 `AGENT_COLLECTION_RECONCILIATION.md` 第三節「雙軌帳本」
原則在月底報表這個情境下的直接體現：報表第 7-9 項（應收/已收/未收）
反映的是軌道 A（信眾付款進度），第 5-6 項（現金/銀行餘額）反映的是
軌道 B（宮方實際持有），兩者不會因為報表彙總而混在一起。

---

## 七、資料模型：`MonthlyFinancialReport`

一份月報是一次「月底時間點」的完整快照，欄位分兩類：**識別/狀態欄位**
（可直接查詢）與**內容快照欄位**（`Json` 型別，保存當時計算出來的
完整結構化數字，之後即使原始資料再變動，已產生的報表內容也不會跟著
變動）。

- **識別/狀態**：`reportNumber`（見第十一節）、`year`、`month`、
  `periodStart`、`periodEnd`、`generatedAt`、`reportStatus`（見第八
  節）、`generatedBy`、`confirmedBy`/`confirmedAt`、
  `lockedBy`/`lockedAt`、`notes`。
- **內容快照**（均為 `Json`，內部結構對應第三～六節的表格）：
  `financialSummarySnapshot`（第三節 20 項）、
  `accountBalanceSnapshot`（第五節，每帳戶一筆）、
  `activitySummarySnapshot`（第四節，每活動一筆，年度燈/南北巡另有
  子結構）、`agentCollectionSnapshot`（第六節，每代收人一筆）、
  `discrepancySnapshot`（差額相關彙總）。

**為什麼用 `Json` 快照而不是即時查詢彙總**：報表一旦產生/鎖定，內容
必須是「當時的樣子」，不能因為之後有人補登資料、或代收款繼續被對帳
處理，讓已經確認/鎖定的報表數字自動跟著變動——這是延伸 V7.0
`ActivitySummary`（ADR-0010，快取/彙總表設計）的精神，但月報比
`ActivitySummary` 更進一步：`ActivitySummary` 會隨資料異動即時重算，
月報快照則是**凍結的歷史紀錄**，兩者用途不同、並存不衝突。

---

## 八、報表狀態機

```prisma
enum MonthlyReportStatus {
  DRAFT                  // 草稿（排程自動產生，剛出爐）
  PENDING_RECONCILIATION // 待對帳（草稿已就緒，等管理者核對確認）
  CONFIRMED              // 已確認（管理者核對無誤）
  LOCKED                 // 已鎖定（正式定案，不可修改內容）
  VOID                   // 已作廢
}
```

**狀態轉換**：

```
DRAFT ──排程產生後自動──▶ PENDING_RECONCILIATION
PENDING_RECONCILIATION ──管理者核對確認──▶ CONFIRMED
CONFIRMED ──管理者按下鎖定──▶ LOCKED
PENDING_RECONCILIATION/CONFIRMED ──發現本月報表整體有誤──▶ VOID（需搭配新草稿或調整紀錄）
```

`LOCKED` 是終態（正常情況下不會再變動），任何之後發現的問題一律透過
第十節 `PeriodAdjustment` 處理，不會讓已鎖定報表的狀態往回走。

---

## 九、報表確認與鎖定規則

月底報表自動產生後，**只先建立草稿**（`DRAFT` → 立即轉
`PENDING_RECONCILIATION`，因為草稿本身已經是「等待對帳」的狀態，不需
要額外的人工動作才轉入待對帳），**不自動鎖定**。

**首頁顯示「上月財務報表待對帳」**（見第十三節），**財務中心顯示待
確認提醒**。

**只有以下角色可確認與鎖定**：`OWNER`、`SUPER_ADMIN`、經授權的
`FINANCE`（沿用 `docs/AGENT_COLLECTION_RECONCILIATION.md` 第十二節
已定案的角色矩陣與 `canLockMonthlyReport` 授權欄位，本文件不重複
定義一套新的權限規則）。

**鎖定後**：不可直接修改原報表內容、不可覆蓋原始快照、後續錯誤須
建立 `PeriodAdjustment`、必須保留 `AuditLog`。

---

## 十、遲到資料與跨月更正：`PeriodAdjustment`

如果月底報表產生（甚至鎖定）後，才補登屬於上個月的收支，**不可默默
修改已鎖定報表**，必須建立 `PeriodAdjustment`：

- `adjustmentNumber`：調整紀錄編號。
- `originalPeriod`：這筆調整實際歸屬的月份（例如 115-07）。
- `enteredPeriod`：實際輸入這筆調整的月份（例如 115-08，代表 8 月
  才發現 7 月有漏帳）。
- `adjustmentDate`：調整輸入日期。
- `amount`：調整金額（可正可負）。
- `accountId`：影響哪個 `FinancialAccount`。
- `activityId`：影響哪個活動（`ActivityType`/`ActivityYear`，可選）。
- `reason`：調整原因（必填）。
- `createdBy`/`approvedBy`：建立人與核准人（分開角色，避免自己建立
  自己核准）。
- `status`：`PENDING_APPROVAL`／`APPROVED`／`REJECTED`／`APPLIED`。

**下一期報表要顯示「前期調整」**（對應第三節第 19 項），確保每個月的
歷史報表都可以追溯——`originalPeriod` 那個月的報表本身不會被改動，
但下一期報表的快照裡會明確列出「這期有一筆調整，屬於上個月的
`amount` 元」，讓管理者查帳時能夠串起完整的軌跡。

---

## 十一、報表編號規則

建議格式：**民國年度-月份-FR-四位流水號**，例如 `115-07-FR-0001`。

規則：報表編號不得重複（`@@unique`）；已作廢報表編號不得重新使用
（`VOID` 狀態的報表其編號永久保留，不可以讓新報表沿用同一個編號）；
補印使用同一報表編號，補印時額外標示「補印」字樣（不是產生新編號、
新報表，只是同一份已鎖定內容的重新輸出）。

---

## 十二、列印與匯出

未來必須支援：A4 列印版、PDF 下載、Excel 匯出——**本輪只規劃 A4
Wireframe（第十四節）與資料結構，不開發正式列印/PDF/Excel 功能**。

**A4 報表至少包含**：台北三玄宮（宮名）、地址「台北市中山區吉林路
199 巷 25 號 1 樓」、電話「02-2523-4163」、Facebook 網址／QR Code
預留位置、報表年度與月份、報表編號、產生日期、財務摘要、各帳戶明細、
各活動明細、代收待繳回明細、差額與備註、製表人、核對人、確認日期、
每頁頁碼。

**設計原則**：黑白列印優先、不使用大面積底色、表格清楚、金額右對齊、
使用等寬數字、A4 事務機可直接列印、不依賴彩色列印才看得懂——這跟
`docs/COLLECTION_CENTER.md` 系統畫面的莫蘭迪暖色系是刻意不同的兩套
視覺語言：系統畫面給行政人員每天長時間使用，追求柔和不刺眼；正式報表
是要拿去黑白影印、存查、也許給查帳人員/會計師看的正式文件，追求清晰
易讀優先於美觀。

---

## 十三、首頁「上月財務報表待對帳」提醒卡

首頁新增卡片，顯示：報表月份、報表編號、產生時間、對帳狀態、差額
狀態、尚未繳回代收款（引用 `AgentCollectionItem` 彙總數字，跟第十四
節「代收待繳回」提醒卡數字一致，但這裡呈現的是「該報表期間當時的
快照數字」，不是「現在當下」的即時數字——兩者在報表鎖定後可能出現
差異，這是預期行為，不是錯誤）、【進入對帳】按鈕。

---

## 十四、低保真 Wireframe（A4 版式）

隨附 `v7_1_1_wireframe.html` 額外包含 2 個畫面：首頁「上月財務報表
待對帳」提醒卡、A4 月底報表列印預覽（黑白/等寬數字/頁碼版式）。

---

## 十五、ER Diagram

```
MonthlyFinancialReport
      │  reportNumber／year／month／periodStart／periodEnd／
      │  generatedAt／reportStatus／
      │  financialSummarySnapshot(Json)／accountBalanceSnapshot(Json)／
      │  activitySummarySnapshot(Json)／agentCollectionSnapshot(Json)／
      │  discrepancySnapshot(Json)／
      │  generatedBy／confirmedBy／confirmedAt／lockedBy／lockedAt／notes
      │
      ├──N:1（快照來源，非資料庫外鍵，僅邏輯關聯）── FinancialAccount（多筆）
      ├──N:1（快照來源）── ActivityYear（多筆）
      ├──N:1（快照來源）── AgentCollectionItem／ReconciliationBatch（多筆）
      │
      └──1───N PeriodAdjustment（跨月調整，實際影響下一期報表的快照內容）
                    │  adjustmentNumber／originalPeriod／enteredPeriod／
                    │  amount／accountId／activityId／reason／
                    │  createdBy／approvedBy／status

ScheduledJobRun（與 docs/AGENT_COLLECTION_RECONCILIATION.md 共用模型）
      │  jobName="MONTHLY_FINANCIAL_REPORT_GENERATION"
      └── 記錄每次月報產生排程的成功/失敗
```

（快照欄位是 `Json`，不是真正的外鍵關聯，圖中用「快照來源」標示這種
邏輯關聯，強調報表內容是產生當下的複製，不是即時查詢連結。）

---

## 十六、月底關帳流程圖

```
次月 1 日 00:10（Asia/Taipei，排程觸發）
        │
        ▼
   檢查是否已存在該 (year, month) 的非 VOID 報表
        │
        ├─ 已存在 → 記錄 ScheduledJobRun(status=SKIPPED) → 結束
        │
        └─ 不存在 → 繼續
                │
                ▼
        彙總計算 periodStart~periodEnd 期間所有數字（第三～六節）
                │
                ▼
        建立 MonthlyFinancialReport（status=PENDING_RECONCILIATION，
        reportNumber 依第十一節規則產生）
                │
                ▼
        記錄 ScheduledJobRun(status=SUCCESS)
                │
                ▼
        首頁顯示「上月財務報表待對帳」提醒卡
```

---

## 十七、報表產生流程圖

```
彙總計算開始
        │
        ├─ 財務摘要（第三節 20 項）
        ├─ 帳戶餘額（第五節，逐帳戶）
        ├─ 活動統計（第四節，逐活動，年度燈/南北巡另有子結構）
        └─ 代收人附件（第六節，逐代收人）
        │
        ▼
   組成四份 Json 快照，寫入 MonthlyFinancialReport
        │
        ▼
   status = PENDING_RECONCILIATION
```

---

## 十八、對帳與鎖定流程圖

```
管理者開啟「上月財務報表待對帳」
        │
        ▼
   逐項核對：財務摘要／帳戶餘額（含人工輸入實際盤點/對帳單金額，
   第五節）／活動統計／代收附件
        │
        ├─ 帳戶餘額有差額 → 填寫差額說明 → 對帳狀態＝DISCREPANCY
        │        │
        │        ▼
        │   （視差額大小決定是否建立 PeriodAdjustment，見第二十五節
        │   尚待確認事項）
        │
        └─ 全部核對無誤 → status = CONFIRMED
                │
                ▼
           管理者按下【鎖定報表】（需要 canLockMonthlyReport 權限）
                │
                ▼
           status = LOCKED，lockedBy／lockedAt 寫入
                │
                ▼
           之後任何更正只能透過 PeriodAdjustment（第十九節）
```

---

## 十九、跨月調整流程圖

```
發現屬於已鎖定月份（例如 115-07）的漏帳/錯帳
        │
        ▼
   建立 PeriodAdjustment
   （originalPeriod=115-07，enteredPeriod=目前月份，例如 115-08）
        │
        ▼
   狀態 PENDING_APPROVAL → 需要 approvedBy 核准
        │
        ├─ 核准 → status = APPROVED → 下一期（115-08）報表產生時
        │           自動把這筆金額計入「前期調整」快照欄位
        │           （第三節第 19 項），status 轉 APPLIED
        │
        └─ 不核准 → status = REJECTED，115-07 報表維持原樣不受影響
```

---

## 二十、建議 Prisma Schema

**本輪僅為建議提案，不套用到 `prisma/schema.prisma`，不建立
migration**：

```prisma
enum MonthlyReportStatus {
  DRAFT
  PENDING_RECONCILIATION
  CONFIRMED
  LOCKED
  VOID
}

enum AccountReconciliationStatus {
  UNRECONCILED
  MATCHED
  DISCREPANCY
  ADJUSTED
}

/// V7.1.1 新增：月底自動財務報表，內容以 Json 快照保存，
/// 一旦產生不受之後資料異動影響（CONFIRMED/LOCKED 後尤其如此）。
model MonthlyFinancialReport {
  id           String   @id @default(cuid())
  reportNumber String   @unique // 例如 115-07-FR-0001
  year         Int
  month        Int
  periodStart  DateTime
  periodEnd    DateTime

  generatedAt DateTime
  reportStatus MonthlyReportStatus @default(DRAFT)

  financialSummarySnapshot Json // 第三節 20 項
  accountBalanceSnapshot   Json // 第五節，逐帳戶陣列
  activitySummarySnapshot  Json // 第四節，逐活動陣列
  agentCollectionSnapshot  Json // 第六節，逐代收人陣列
  discrepancySnapshot      Json? // 差額相關彙總

  generatedBy String
  confirmedBy String?
  confirmedAt DateTime?
  lockedBy    String?
  lockedAt    DateTime?

  notes String? @db.Text

  adjustmentsApplied PeriodAdjustment[] @relation("AppliedToReport")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([year, month])
  @@map("monthly_financial_reports")
}

enum PeriodAdjustmentStatus {
  PENDING_APPROVAL
  APPROVED
  REJECTED
  APPLIED
}

model PeriodAdjustment {
  id               String @id @default(cuid())
  adjustmentNumber String @unique

  originalPeriod String // 例如 "115-07"
  enteredPeriod  String // 例如 "115-08"
  adjustmentDate DateTime @db.Date

  amount     Decimal @db.Decimal(12, 2)
  accountId  String
  account    FinancialAccount @relation(fields: [accountId], references: [id])
  activityId String? // ActivityYear.id，可選

  reason String @db.Text

  createdBy  String
  approvedBy String?
  status     PeriodAdjustmentStatus @default(PENDING_APPROVAL)

  appliedToReportId String?
  appliedToReport   MonthlyFinancialReport? @relation("AppliedToReport", fields: [appliedToReportId], references: [id])

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("period_adjustments")
}

// FinancialAccount 新增欄位（比照既有 model 擴充，非重新定義）：
//   本月報表用的 reconciliationStatus 不直接存在 FinancialAccount 上，
//   而是存在 MonthlyFinancialReport.accountBalanceSnapshot 這個 Json
//   快照裡（每帳戶一筆，包含 AccountReconciliationStatus），
//   避免在 FinancialAccount 本體疊加「這是哪個月份的對帳狀態」這種
//   跟月份綁定的暫時性欄位。
```

---

## 二十一、排程方案

建議使用 **Render Cron Job**（或等效可靠的後端排程服務），設定在
每日 00:10（Asia/Taipei）執行一次檢查（不是只在每月 1 號才啟動排程
本身，而是每天都執行、但只有「今天是 1 號」時才真的產生報表——這樣
即使某天排程系統本身臨時故障，隔天的每日檢查也有機會補跑，不會因為
「只設定每月 1 號執行一次」而在那唯一一次失敗後，整整一個月都沒有
報表）。

排程執行後：檢查是否已存在該月份的非 `VOID` 報表（idempotency，
避免重複產生正式草稿）→ 建立報表 → 寫入 `ScheduledJobRun`
（`jobName="MONTHLY_FINANCIAL_REPORT_GENERATION"`）→ 成功或失敗都
保留 log → 失敗時首頁顯示提醒（呈現方式同
`docs/AGENT_COLLECTION_RECONCILIATION.md` 第二十七節尚待確認事項，
兩個排程共用同一套告警呈現機制，不需要各自設計一套）。

---

## 二十二、哪些資料可以沿用／哪些要新增

**完全沿用**：`FinancialAccount`/`LedgerEntry`/`Receivable`/
`ActivitySummary`/`AgentCollectionItem`/`ReconciliationBatch`（本文件
只讀取這些既有模型的資料做彙總快照，不修改它們的欄位定義）。

**全新模型**：`MonthlyFinancialReport`、`PeriodAdjustment`、
`MonthlyReportStatus`/`AccountReconciliationStatus`/
`PeriodAdjustmentStatus` enum。`ScheduledJobRun` 沿用
`docs/AGENT_COLLECTION_RECONCILIATION.md` 已規劃的共用模型，不重複
定義。

---

## 二十三、Migration 計畫（本輪不執行）

僅記錄未來實際套用時的建議步驟，**本輪完全不執行**：

1. 新增 enum：`MonthlyReportStatus`、`AccountReconciliationStatus`、
   `PeriodAdjustmentStatus`。
2. 新增資料表：`monthly_financial_reports`、`period_adjustments`。
3. 確認 `ScheduledJobRun`（如尚未因代收提醒排程而建立）一併建立，
   避免兩份規格分別各自建一次造成衝突——**正式開發時若兩個模組交付
   順序不同，需要注意這張表只能建立一次**。
4. 應用層需要設計「彙總計算」的實作方式（例如一支背景工作
   `generateMonthlyReport(year, month)`，讀取期間內所有相關資料表，
   組成四份 Json 快照），本輪只定案快照的欄位結構，不定案實際計算
   程式碼。

---

## 二十四、開發順序

1. `MonthlyFinancialReport`/`PeriodAdjustment` 模型與 enum。
2. 報表彙總計算邏輯（`generateMonthlyReport`，風險中等，需要正確
   讀取所有既有財務模型）。
3. 排程觸發（`ScheduledJobRun` 記錄，可與代收提醒排程一起規劃技術
   選型，風險低，建議跟
   `docs/AGENT_COLLECTION_RECONCILIATION.md` 開發順序第 7 項一起做）。
4. 首頁「上月財務報表待對帳」提醒卡（讀取為主，風險低）。
5. 對帳/鎖定畫面與權限檢查（風險中等，依賴
   `AGENT_COLLECTION_RECONCILIATION.md` 已定案的角色權限）。
6. `PeriodAdjustment` 建立/核准流程（風險中等，需要正確處理「下一期
   報表要顯示前期調整」的邏輯）。
7. A4 列印/PDF/Excel（本輪只做 Wireframe，正式開發列在最後，且需要
   額外評估用什麼函式庫產生 PDF——沿用 V4.1 牌位列印已經用過的
   `html2canvas`/`jspdf` 組合是候選方案之一）。

---

## 二十五、風險與尚待確認事項

1. **帳戶餘額差額多小可以直接在報表備註說明、多大需要正式建立
   `PeriodAdjustment`？** 本規格沒有設定金額門檻，兩種處理方式都
   支援，但沒有規則判斷該用哪一種，需要你確認是否要設定門檻（例如
   100 元以下只需備註，以上需要正式調整紀錄）。
2. **電子收據張數（報表第 16-18 項）目前完全沒有資料來源**，欄位
   保留但本輪固定回傳 0/null——這是明確的功能缺口，等電子收據模組
   立項時需要一併回頭補上這幾個快照欄位的實際計算邏輯。
3. **`PeriodAdjustment.activityId` 的型別**：本規格暫定指向
   `ActivityYear.id`，但如果需要更細（例如指定到某個
   `RegistrationItem` 層級的調整），需要再細化，本輪先用活動層級
   的粗粒度設計。
4. **報表鎖定後，`FinancialAccount` 本身的餘額如果因為新的正常收款
   （不是遲到資料，是這個月才發生的新交易）而改變，會不會讓下一期
   報表的「月初餘額」跟上一期報表的「月底帳面餘額」對不起來？** 理論
   上不會（因為下一期月初餘額就是讀取上一期報表快照裡的月底餘額，
   而不是即時查詢 `FinancialAccount` 當下餘額），但這個「銜接規則」
   需要在正式開發時特別寫測試驗證，本輪只在文件中說明規則，沒有
   實際程式碼可以驗證。
5. **排程「每天 00:10 檢查是否為 1 號」的設計，是否要改成更嚴謹的
   排程表達式（例如直接設定 cron 為每月 1 號執行）？** 本規格選擇
   「每天執行、內部判斷」是為了容錯（避免整月排程都沒觸發過一次），
   但這會讓排程比較頻繁地執行「空判斷」，需要你確認這個取捨是否
   可以接受，或是否有其他容錯機制的偏好。

---

## 二十六、本輪確認：本次完全沒有做的事

- 沒有開發月底報表的任何正式畫面或 API。
- 沒有修改 `prisma/schema.prisma`、沒有建立 migration、沒有變更正式
  資料庫。
- 沒有實作 Render Cron Job 或任何排程服務的實際程式碼，只規劃排程
  時間與資料記錄方式（沿用
  `docs/AGENT_COLLECTION_RECONCILIATION.md` 的共用排程紀錄設計）。
- 沒有開發電子收據正式模板、PDF 正式輸出、Excel 正式匯出，只規劃
  A4 版式 Wireframe 與資料結構。
- 沒有推翻既有 V7.0/V7.0.2/V7.0.3/V7.1 設計，也沒有推翻本次同時交付
  的 `docs/AGENT_COLLECTION_RECONCILIATION.md` 架構。
- 沒有部署 Render、沒有推送 GitHub、沒有執行
  `npm install`/`prisma generate`/`next build`。
- 沒有開始下一版。
