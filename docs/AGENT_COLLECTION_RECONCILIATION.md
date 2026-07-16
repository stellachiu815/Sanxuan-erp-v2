# 台北三玄宮 ERP — 代收待繳回提醒與對帳（Agent Collection Reconciliation）規格定稿（V7.1.1）

**狀態：規格、資料模型、流程圖、低保真 Wireframe、排程方案、Migration
計畫定案，尚未實作、尚未套用 migration、尚未開發任何正式 UI/API、尚未
執行 Build、尚未變更正式資料庫。**

本文件是「代收待繳回提醒與對帳」的權威規格文件，**正式取代並大幅擴充**
V7.2 的 `docs/AGENT_REMITTANCE.md`。V7.2 定案的核心精神（代收追蹤層
不可直接影響銀行/現金餘額，只有確認繳回後才建立正式 `Payment`）**本輪
完全保留、不推翻**，但資料模型與流程本輪做了更細緻的設計（雙軌帳本、
持久化的對帳批次、部分繳回、防重複入帳、提醒紀錄、權限矩陣）。
`docs/AGENT_REMITTANCE.md` 保留作為 V7.2 歷史脈絡，頂部已加註指向本
文件。

**本輪不得推翻**既有 V7.0 Finance Core、V7.0.2 Annual Activity Engine、
V7.0.3 報名當下立即付款、V7.1 Collection Center 的架構。

---

## 目錄

1. 目標與核心原則（四種狀態定義）
2. 與 V7.2 `AGENT_REMITTANCE.md` 的關係
3. 雙軌帳本設計：信眾已付款 vs 宮方已持有
4. 資料模型：`AgentCollectionItem`
5. `ReconciliationBatch` 與 `ReconciliationBatchItem`
6. 逐筆勾選對帳流程
7. 實際交回金額核對與差額處理
8. 部分繳回設計
9. 防止重複對帳與重複入帳
10. 正式入帳規則
11. 提醒規則與 `ReminderLog`
12. 權限與角色
13. 使用者帳號前置需求
14. 首頁「代收待繳回」提醒卡
15. 收款中心「代收對帳」頁籤
16. 低保真 Wireframe 說明
17. ER Diagram
18. 代收款生命週期流程圖
19. 提醒流程圖
20. 繳回對帳流程圖
21. 差額與爭議處理流程圖
22. 建議 Prisma Schema
23. 排程方案
24. 哪些資料可以沿用／哪些要新增
25. Migration 計畫（本輪不執行）
26. 開發順序
27. 風險與尚待確認事項
28. 本輪確認：本次完全沒有做的事

---

## 一、目標與核心原則（四種狀態定義）

必須清楚區分四種狀態，這是本輪最核心的觀念：

| # | 狀態 | 說明 |
|---|---|---|
| 1 | 信眾尚未付款 | 一般的 `Receivable`（未繳），跟代收無關，本輪不變 |
| 2 | 信眾已付款，款項仍在代收人手上 | 建立 `AgentCollectionItem`，`Receivable.paidAmount` 可以更新，但**不影響**宮內現金/銀行帳戶餘額 |
| 3 | 代收人已將款項繳回三玄宮（尚待核對） | `AgentCollectionItem.handedOverAt` 記錄，對帳批次進入處理中 |
| 4 | 三玄宮已完成核對與正式入帳 | 對帳批次確認，建立正式 `Payment`／`LedgerEntry`，銀行/現金餘額才真正更新 |

**核心原則**：「信眾已經付款」與「三玄宮實際已經持有款項」**不是同一件
事**。狀態 2、3 都屬於「信眾已付款」的範疇，但只有狀態 4 才代表宮方
真正持有這筆錢。系統的每一個畫面、每一個彙總數字，都必須讓行政人員
一眼分辨「這筆錢，現在到底在誰手上」。

---

## 二、與 V7.2 `AGENT_REMITTANCE.md` 的關係

V7.2 已經定案「代收待繳回是獨立於 `Payment` 之外的追蹤層，只有確認繳回
才建立正式 `Payment`」這個核心架構（ADR-0016），本輪完全沿用這個精神，
但做了以下具體擴充，因此新增本文件作為權威版本：

| 項目 | V7.2 設計 | V7.1.1 本輪擴充 |
|---|---|---|
| 追蹤模型 | `AgentRemittance`（單一模型） | `AgentCollectionItem`（更完整欄位）＋新增 `ReconciliationBatch`／`ReconciliationBatchItem` |
| 「本次對帳」工作區 | UI 暫存，不落地存檔 | **升級為持久化的 `ReconciliationBatch`（`status=DRAFT`）**，因為需要交易安全與防重複勾選（見第九節），純前端暫存無法保證這件事 |
| 部分繳回 | 沒有規劃 | 新增 `remittedAmount`／`ReconciliationBatchItem.amountAppliedThisBatch`，支援同一筆代收款分次繳回 |
| 差額處理 | 沒有規劃 | 新增差額比對、爭議標記、差額原因欄位（第七、二十一節） |
| 提醒紀錄 | 只有彙總欄位（`reminderCount` 等） | 新增 `ReminderLog` 保留每一次提醒的完整歷史，即使失敗也留紀錄 |
| 權限 | 只提到「哪些操作需要主管層級」是待確認事項 | 正式定案角色矩陣（第十二節）與 `Role` enum 擴充 |
| 資金位置概念 | 只在文字說明「不影響銀行餘額」 | 正式定義「雙軌帳本」（第三節），`Payment` 新增 `collectionItemId`/`reconciliationBatchId` 欄位追溯 |

`docs/AGENT_REMITTANCE.md` 本身**不刪除**，作為 V7.2 歷史決策紀錄保留，
頂部已加註「本文件已由 `docs/AGENT_COLLECTION_RECONCILIATION.md`（V7.1.1）
正式取代，欄位與流程請以新文件為準」。

---

## 三、雙軌帳本設計：信眾已付款 vs 宮方已持有

本輪最重要的架構決策是把「帳」拆成兩條完全獨立的軌道：

**軌道 A：信眾付款進度（`Receivable.paidAmount`/`status`）**——回答
「這位信眾，錢繳了沒？」。`AgentCollectionItem` 建立的當下，就會更新
對應 `Receivable.paidAmount`（增加 `originalAmount`），重新計算
`ReceivableStatus`（`PARTIAL`/`PAID` 等，沿用 V7.1 既有 7 值狀態機，
本輪不新增值）——**這一步完全不觸碰 `FinancialAccount`/`LedgerEntry`**。

**軌道 B：宮方實際持有現金（`FinancialAccount.balance`，透過
`LedgerEntry`）**——回答「宮方帳戶裡，現在實際有多少錢？」。只有
`ReconciliationBatch` 確認（狀態轉為 `CONFIRMED`）之後，才會針對這次
確認的金額建立正式 `Payment`（見第十節），觸發 `LedgerEntry` 與
`FinancialAccount` 餘額更新。

**關鍵不變量**：軌道 A 的更新（`AgentCollectionItem` 建立時）與軌道 B
的更新（對帳確認時）**永遠是兩個獨立的時間點**，中間可能相隔數天甚至
數週；`Payment.collectionItemId` 非 null 時，代表這筆 `Payment` 只
負責觸發軌道 B（`LedgerEntry`/帳戶餘額），**不會**重複更新軌道 A（因為
軌道 A 早在 `AgentCollectionItem` 建立時就已經更新過），避免同一筆錢
在 `Receivable.paidAmount` 被重複加總兩次（見第十節「不得重複計算活動
已收金額」）。

---

## 四、資料模型：`AgentCollectionItem`

每一筆「信眾付款給代收人」的事實，建立一筆 `AgentCollectionItem`：

- **信眾付款事實**：`originalAmount`（不可修改，代收人向信眾收到的
  原始金額）、`paidOn`（信眾付款日期）、`paymentMethod`、
  `collectorNotes`（代收備註）。
- **代收人身分**：`collectorUserId`（若代收人剛好是系統使用者，可選）
  ＋ `collectorDisplayName`（**必填的姓名快照**，因為代收人可能是宮內
  阿姨、外部協助收款的親友，不能只依賴 `User` 帳號）。
- **功德主與付款人分開**（沿用 V7.1 第五節既有規則）：
  `sponsorNameSnapshot`（功德主/唱名對象）與 `payerNameSnapshot`（實際
  付錢給代收人的人，可選填 `payerMemberId`/`payerHouseholdId`）——這兩者
  都跟「代收人」是三個不同角色，代收人是「幫忙轉交」的第三方，付款人
  才是「真的掏錢的人」。
- **繳回進度**：`remittedAmount`（累計已繳回，初始為 0）、`status`
  （`PENDING`/`PARTIAL`/`REMITTED`/`DISPUTED`，見第八節）、
  `handedOverAt`（代收人交回現場/對帳開始處理的時間戳記）、
  `confirmedById`/`confirmedAt`（最終確認人與時間）、
  `destinationAccountId`（最近一次繳回指定的帳戶）。
- **提醒彙總**：`reminderCount`/`lastRemindedAt`/`nextReminderAt`（沿用
  V7.2 設計，本輪不變）。
- **爭議**：`disputeReason`。
- **對帳批次關聯**：`reconciliationBatchId`（目前暫存所屬的「本次對帳」
  草稿批次，處理完成或作廢後清空；歷史上實際套用過哪些批次，記錄在
  `ReconciliationBatchItem`，見第五節）。

完整 Prisma 定義見第二十二節。

---

## 五、`ReconciliationBatch` 與 `ReconciliationBatchItem`

「本次對帳」在 V7.1 是純前端暫存概念，本輪**升級為持久化的資料表**，
理由是：對帳批次需要交易安全、需要 idempotency key 防止重複提交、需要
在多人同時操作時知道「這筆款項是不是已經被別人勾選走了」——純前端狀態
無法提供這些保證（見第九節）。

**`ReconciliationBatch`**：一次對帳作業的完整紀錄。

- `batchNumber`：批次編號（建議格式見第二十三節，可比照月報編號邏輯）。
- `collectorDisplayName`/`collectorUserId`：這次對帳鎖定處理的代收人
  （沿用「選擇某位代收人後，列出所有尚未繳回款項」的操作流程，一個
  批次對應一位代收人）。
- `remittedOn`：繳回日期。
- `selectedItemsCount`/`selectedItemsTotal`：勾選筆數與總額（草稿階段
  即時計算）。
- `actualReceivedAmount`：確認階段填寫的實際收到金額。
- `destinationAccountId`：收入帳戶。
- `discrepancyAmount`/`discrepancyReason`：差額與原因（見第七節）。
- `status`：`DRAFT`（本次對帳，勾選中）／`CONFIRMED`（已確認）／
  `DISPUTED`（有爭議待確認）／`VOIDED`（已作廢）／`ADJUSTED`（爭議
  解決後建立調整紀錄的最終狀態）。
- `idempotencyKey`：防止使用者連按兩次或網路重送造成重複批次。
- `confirmedById`/`confirmedAt`、`voidedById`/`voidedAt`/`voidReason`。

**`ReconciliationBatchItem`**：批次底下的明細，記錄「這個批次對這一筆
代收款套用了多少金額」（`amountAppliedThisBatch`），支援同一筆代收款
分次、跨批次繳回。

---

## 六、逐筆勾選對帳流程

管理者選擇某位代收人後，畫面列出該代收人所有 `status` 為 `PENDING`／
`PARTIAL` 的 `AgentCollectionItem`（例如：☐ 王小華｜光明燈＋祭改｜
2,400 元），可以逐筆勾選。勾選當下即時顯示：

- 本次勾選筆數
- 本次勾選總額
- 該代收人尚未繳回總額（勾選前的全部未繳回金額）
- 確認後剩餘未繳回總額（= 尚未繳回總額 − 本次勾選總額）

**勾選動作本身建立/更新一筆 `status=DRAFT` 的 `ReconciliationBatch`**
（見第五節），把被勾選的 `AgentCollectionItem.reconciliationBatchId`
指向這筆草稿批次——這一步**不會**變動任何 `Receivable`/`Payment`/
`LedgerEntry`/`FinancialAccount` 資料，純粹是「圈起這次要處理的項目」。

管理者按下【確認本次已繳回】之前，系統不得更改任何正式帳戶餘額。未
勾選的款項繼續保留在「尚未繳回」，繼續提醒，不會自動消失或被視為已
繳回。

---

## 七、實際交回金額核對與差額處理

按下【確認本次已繳回】時，畫面要求填寫：實際收到金額、收入帳戶（現金
或指定銀行帳戶）、繳回日期、確認人（自動帶入目前登入者）、備註。

系統比對「勾選項目合計」（`selectedItemsTotal`）與「實際收到金額」
（`actualReceivedAmount`）：

- **相同**：`ReconciliationBatch.status` → `CONFIRMED`，進入第十節的
  正式入帳流程。
- **不同**：**不可直接完成**，畫面顯示「本次勾選合計與實際收到金額
  不一致」，提供四個選項：
  1. 返回重新勾選（放棄本次草稿的部分/全部勾選，回到第六節重新操作）。
  2. 標記為有爭議待確認（`ReconciliationBatch.status` →
     `DISPUTED`，對應的 `AgentCollectionItem.status` 也一併標記
     `DISPUTED`）。
  3. 記錄差額（`discrepancyAmount` = 實際收到 − 勾選合計）。
  4. 填寫差額原因（`discrepancyReason`，必填，不可留白直接送出）。

**明確禁止**：系統不可以自行把差額吞掉、平均分攤到各筆款項、或悄悄
修改某一筆 `AgentCollectionItem.originalAmount` 來讓帳兜起來——差額
永遠留下清楚痕跡，等管理者之後用「有爭議待確認」流程另外處理。

---

## 八、部分繳回設計

同一位代收人可以只交回其中幾筆（未勾選的繼續保留），單一筆代收款也
可能只繳回部分金額（例如代收人這次先繳回 1,000 元，剩下的下次再交）。

**單筆代收款狀態**：

| 狀態 | 條件 |
|---|---|
| `PENDING`（尚未繳回） | `remittedAmount = 0` |
| `PARTIAL`（部分繳回） | `0 < remittedAmount < originalAmount` |
| `REMITTED`（已繳回） | `remittedAmount >= originalAmount` |
| `DISPUTED`（有爭議待確認） | 對帳批次比對不符且尚未解決（覆蓋上述判斷，優先顯示） |

**不得直接修改 `originalAmount`**——原始代收金額是信眾當初實際付款的
金額，永遠保持不變，作為稽核基準；每次部分繳回只增加
`remittedAmount`（透過 `ReconciliationBatchItem.amountAppliedThisBatch`
累加），「尚未繳回餘額」永遠是計算欄位（`originalAmount -
remittedAmount`），不單獨儲存、不會跟累加結果不一致。

---

## 九、防止重複對帳與重複入帳

必須防止的五種情境與對應機制：

| 風險 | 防範機制 |
|---|---|
| 同一筆款項被兩個人同時勾選 | `AgentCollectionItem` 進入草稿批次時寫入 `reconciliationBatchId`；第二個人嘗試勾選同一筆時，畫面顯示「已被其他對帳作業選取」，需重新整理清單 |
| 同一筆款項被重複確認繳回 | 確認送出前，在同一個資料庫 Transaction 內重新讀取每筆 `AgentCollectionItem.status`／`remittedAmount`，如果已經被其他批次處理過（狀態或金額跟畫面上不一致），整批拒絕，要求重新整理 |
| 使用者連按兩次按鈕產生兩筆入帳 | `ReconciliationBatch.idempotencyKey`（前端產生一次性 key 隨請求送出）搭配資料庫 `@@unique` 約束，第二次相同 key 的請求視為重複，直接回傳第一次的結果，不重新處理 |
| 網路重送造成重複 `LedgerEntry` | 沿用 V7.0 既有的 `LedgerEntry.paymentId` `@@unique` 約束（見第十節），加上本節的 idempotency key，雙重保險 |
| 同一 `ReconciliationBatch` 被重複提交 | 確認動作只允許對 `status=DRAFT` 的批次執行，執行後立即轉為 `CONFIRMED`/`DISPUTED`，Transaction 內用資料庫層級的狀態檢查（例如 `WHERE status = 'DRAFT'` 的條件更新，影響筆數為 0 就代表已經被處理過）防止競態 |

以上機制全部要求在**同一個資料庫 Transaction** 內完成「重新驗證狀態→
建立 Payment/LedgerEntry→更新 AgentCollectionItem/ReconciliationBatch
狀態」，不可以分成多次個別呼叫。

---

## 十、正式入帳規則

**信眾付款給代收人時**（`AgentCollectionItem` 建立）：
- 只更新軌道 A（`Receivable.paidAmount`/`status`），資金位置標示為
  「代收人保管中」。
- **不建立** `Payment`、不建立 `LedgerEntry`、不影響
  `FinancialAccount` 餘額。

**管理者確認繳回時**（`ReconciliationBatch` 確認為 `CONFIRMED`）：
- 針對這批次涵蓋的每一筆 `AgentCollectionItem`（依
  `ReconciliationBatchItem.amountAppliedThisBatch`），建立對應的正式
  `Payment`（`amount = amountAppliedThisBatch`、
  `payerNameSnapshot` = 代收人姓名快照、`financialAccountId` = 這批次
  的 `destinationAccountId`、`collectionItemId`/`reconciliationBatchId`
  記錄來源）。
- 這筆 `Payment` **依然**自動建立唯一一筆 `LedgerEntry`
  （`@@unique([paymentId])`，V7.0 既有約束不變），更新
  `FinancialAccount` 餘額——這是資金真正從「代收人保管中」轉入正式
  帳戶的那一刻。
- **不得再建立第二筆信眾付款事實**：因為信眾付款這件事早在
  `AgentCollectionItem` 建立時就已經記錄過，這裡的 `Payment` 只負責
  觸發軌道 B，建立 `Payment` 的邏輯必須明確跳過「更新
  `Receivable.paidAmount`」這一步（用 `collectionItemId` 非 null 作為
  判斷依據，見第三節）——避免同一筆錢在應收金額上被重複計算兩次。

`Payment` 表示「這筆錢現在確定在哪個正式帳戶裡」這個付款事實；
`AgentCollectionItem`（搭配其 `status`）等同於「資金位置」欄位，標示
目前資金是在代收人手上還是已經入帳。

---

## 十一、提醒規則與 `ReminderLog`

**時區固定 Asia/Taipei，排程時間：每週三、週五晚上 19:30**（沿用
V7.2 設計，本輪不變）。每次系統實際產生提醒後：`reminderCount` 加 1、
`lastRemindedAt` 更新、`nextReminderAt` 更新至下一個週三或週五
19:30；每筆至少提醒五次，五次後若仍未確認繼續提醒，只有管理者完成
「已繳回」對帳後才停止；`DISPUTED` 狀態的款項也要提醒（用不同顏色/
狀態顯示，見第十四節）；未勾選的款項不會自動消失；已繳回後保留完整
提醒次數與歷史資料（不刪除）。

**本輪新增 `ReminderLog`**：每次系統實際觸發提醒（不論成功與否），
建立一筆紀錄：`agentCollectionItemId`、`remindedAt`、
`reminderSequence`（對應觸發當下的 `reminderCount`）、
`reminderChannel`（本輪只有 `IN_APP`，enum 保留 `EMAIL`/`LINE` 未來
擴充值但不啟用）、`recipient`（提醒對象，本輪系統內提醒無外部收件人，
欄位保留給未來擴充）、`status`（`SUCCESS`/`FAILED`）、
`errorMessage`（失敗原因，即使失敗也要留下紀錄，不可以默默跳過）。

**本輪只規劃系統內提醒**（首頁提醒卡、收款中心清單反映最新提醒狀態），
**不實作** Email、LINE 或其他外部通知——這些是明確排除在本輪範圍外的
未來擴充。

---

## 十二、權限與角色

**只有以下角色可以確認款項已繳回**（`ReconciliationBatch` 從
`DRAFT` 轉為 `CONFIRMED`）：`OWNER`、`SUPER_ADMIN`、經授權的
`FINANCE`。

**一般 `STAFF` 或代收人只能**：查看自己代收的項目、登記已代收（建立
`AgentCollectionItem`）、查看尚未繳回金額——**不能**自行把自己手上的
款項勾選成已繳回（`ReconciliationBatch` 確認動作必須由上述角色執行）。

**`Role` enum 本輪擴充**（沿用 V6.2 既有的 `Role` 骨架
`SUPER_ADMIN`/`STAFF`/`FINANCE_CLERK`，本輪擴充為）：

```prisma
enum Role {
  OWNER        // 決策者，系統必須永遠至少有一位，目前為 Stella
  SUPER_ADMIN  // 系統管理者
  FINANCE      // 財務人員（正式改名/擴充自舊 FINANCE_CLERK）
  STAFF        // 一般行政人員
  VIEWER       // 唯讀角色（本輪新增）
}
```

**「經授權的 FINANCE」**：不是所有 `FINANCE` 角色的使用者都自動擁有
確認對帳/鎖定報表的權限，本輪在 `User` 新增兩個布林欄位作為明確授權
開關：`canConfirmAgentReconciliation`／`canLockMonthlyReport`，預設
`false`，需要 `OWNER`/`SUPER_ADMIN` 另外開啟——避免「掛著財務職稱」
但實際上不該有對帳權限的帳號誤觸確認動作（是否要做成更完整的權限
授予機制，見第二十七節尚待確認事項）。

**確認人必須自動記錄目前登入者**，不得由畫面輸入框自由填寫；**不得
只在前端隱藏按鈕，後端 API 也必須驗證權限**（沿用
`src/lib/permissions.ts` 既有的 `canFinance()` 設計精神）。

---

## 十三、使用者帳號前置需求

正式開放代收對帳前，必須先完成：登入、Session、`OWNER`/
`SUPER_ADMIN`/`FINANCE`/`STAFF`/`VIEWER` 角色、`AuditLog`——這些是
本輪**只做資料模型預留、不實作正式登入機制**的部分（跟系統從 V1 起
就有的「財務模組權限架構預留、尚未真正開發」現況一致）。

**角色規則可以固定，但不得把某個人的姓名或帳號永久寫死在程式碼
中**——目前 `OWNER` 是 Stella，但這是一筆 `User` 資料列的內容，不是
程式碼常數。

**系統必須確保（應用層業務規則，本輪只記錄規則，不實作）**：

1. 永遠至少有一位 `OWNER`——任何會讓 `OWNER` 人數變成 0 的操作
   （降級、刪除帳號）必須被阻擋。
2. 一般管理員不可自行取得 `OWNER`——只有現任 `OWNER` 才能指定下一位
   `OWNER`。
3. `OWNER` 移交需要再次驗證（例如密碼/OTP 再次確認）——避免帳號被盜
   用或誤操作就轉移最高權限。
4. 不能偷偷把現任 `OWNER` 降級——`OWNER` 的角色變更必須是一個獨立、
   有明確操作記錄（`AuditLog`）的「移交」動作，不能透過一般「編輯
   使用者」表單順手改掉。

---

## 十四、首頁「代收待繳回」提醒卡

首頁新增「代收待繳回」卡片，資料來源是所有 `status` 為 `PENDING`／
`PARTIAL`／`DISPUTED` 的 `AgentCollectionItem`：

- **尚未繳回總筆數**、**尚未繳回總金額**（三種狀態合計）。
- **依代收人分組的筆數與金額**，範例呈現：

  ```
  林阿姨
  5 筆
  尚未繳回 16,800 元
  最久 12 天
  已提醒 4 次
  ```

- **最久未繳回天數**（`collectedOn`/`paidOn` 距今最久的天數）。
- **已提醒五次以上的筆數**（`reminderCount >= 5`）。
- **有爭議待確認筆數**（`status = DISPUTED`）。
- **【進入對帳】按鈕**，導向收款中心「代收對帳」頁籤。

**視覺規則**：已提醒五次以上但仍未繳回的項目，使用淡菊色或乾燥玫瑰色
標示，但不刺眼（沿用第十六節/`docs/COLLECTION_CENTER.md` 既有色彩
系統，鼠尾草綠=已繳回、乾燥玫瑰=逾期或爭議、淺湖水藍=一般資訊）。

---

## 十五、收款中心「代收對帳」頁籤

收款中心新增「代收對帳」頁籤，四個子頁籤：

1. **尚未繳回**：`status IN (PENDING, PARTIAL)` 的清單，可依代收人/
   活動/年度/代收日期/功德主/付款人/金額/提醒次數/繳回狀態查詢，逐筆
   勾選進入「本次對帳」。
2. **本次對帳**：目前 `status=DRAFT` 的 `ReconciliationBatch` 工作區
   （見第六、七節）。
3. **已繳回紀錄**：`status=CONFIRMED` 的批次與其明細，歷史查詢，保留
   完整提醒次數與對帳資料。
4. **有爭議待確認**：`status=DISPUTED` 的批次/項目，顯示差額與爭議
   原因，管理者可從這裡重新處理。

---

## 十六、低保真 Wireframe 說明

隨附 `v7_1_1_wireframe.html`（單一自足 HTML，多畫面切換），涵蓋本文件
相關的 3 個畫面：首頁「代收待繳回」提醒卡、代收對帳「尚未繳回」清單、
逐筆勾選＋確認對帳（含差額不符情境）畫面。色彩系統沿用
`docs/COLLECTION_CENTER.md` 第十三節既有規範：暖白背景、淡奶油黃主色、
淡菊色/乾燥玫瑰表示提醒與逾期、鼠尾草綠表示已繳回、淺湖水藍表示一般
資訊，不使用灰藍主色、不使用大紅大金、風格明亮不陰沉。

---

## 十七、ER Diagram

```
RegistrationGroup ──1:1── Receivable
      │                       │
      │                       ├──1───N Payment（既有，V7.0/V7.1；
      │                       │             ★本輪新增 collectionItemId／
      │                       │             reconciliationBatchId 欄位）
      │                       │
      │                       └──1───N AgentCollectionItem（★取代 V7.2 AgentRemittance）
      │                                    │  collectorUserId／collectorDisplayName／
      │                                    │  sponsorNameSnapshot／payerNameSnapshot／
      │                                    │  payerMemberId／payerHouseholdId／
      │                                    │  originalAmount／remittedAmount／status／
      │                                    │  reminderCount／nextReminderAt／
      │                                    │  reconciliationBatchId（暫存草稿批次）
      │                                    │
      │                                    ├──N:1（可選）── User（collectorUserId）
      │                                    ├──N:1（可選）── Member/Household（付款人）
      │                                    ├──N:1（暫存）── ReconciliationBatch（草稿階段）
      │                                    ├──1───N ReconciliationBatchItem（歷史對帳明細）
      │                                    ├──1───N Payment（確認繳回後產生的正式收款）
      │                                    └──1───N ReminderLog
      │
      └──1───N RegistrationItem（既有，不變）

ReconciliationBatch
      │  batchNumber／collectorDisplayName／remittedOn／
      │  selectedItemsCount／selectedItemsTotal／actualReceivedAmount／
      │  destinationAccountId／discrepancyAmount／discrepancyReason／
      │  status／idempotencyKey／confirmedById／confirmedAt
      │
      ├──1───N ReconciliationBatchItem ──N:1── AgentCollectionItem
      ├──N:1── FinancialAccount（destinationAccountId）
      └──1───N Payment（確認後產生）

User
      │
      ├──1───N AgentCollectionItem（collectorUserId，可選）
      └── role: Role（★擴充為 OWNER/SUPER_ADMIN/FINANCE/STAFF/VIEWER）
```

---

## 十八、代收款生命週期流程圖

```
信眾付款給代收人
        │
        ▼
   建立 AgentCollectionItem（status=PENDING）
        │
        ▼
   Receivable.paidAmount 更新（軌道 A），資金位置＝代收人保管中
        │
        ▼
   （代收人交回現場，可選）handedOverAt 記錄
        │
        ▼
   管理者勾選進入「本次對帳」（ReconciliationBatch status=DRAFT）
        │
        ▼
   確認本次已繳回 → 金額比對（見第二十節）
        │
        ├─ 相符 → ReconciliationBatch status=CONFIRMED
        │              │
        │              ▼
        │        建立正式 Payment（collectionItemId 關聯）
        │              │
        │              ▼
        │        建立 LedgerEntry，更新 FinancialAccount（軌道 B）
        │              │
        │              ▼
        │        AgentCollectionItem.remittedAmount 累加，
        │        status 依第八節規則重新計算（PARTIAL/REMITTED）
        │
        └─ 不符 → ReconciliationBatch/AgentCollectionItem status=DISPUTED
                       │
                       ▼
                  管理者後續處理（第二十一節）
```

---

## 十九、提醒流程圖

```
每週三／週五 19:30（排程觸發，Asia/Taipei）
        │
        ▼
   掃描 status IN (PENDING, PARTIAL, DISPUTED)
   且 nextReminderAt <= 現在 的 AgentCollectionItem
        │
        ▼
   逐筆：reminderCount += 1；lastRemindedAt = 現在
        │
        ▼
   建立 ReminderLog（reminderSequence = 新的 reminderCount，
   channel=IN_APP，status=SUCCESS 或 FAILED＋errorMessage）
        │
        ▼
   重新計算 nextReminderAt = 下一個週三或週五 19:30
        │
        ▼
   （首頁提醒卡／收款中心清單讀取最新欄位，畫面即時反映）
```

---

## 二十、繳回對帳流程圖

```
管理者選擇代收人 → 列出 PENDING/PARTIAL 項目
        │
        ▼
   逐筆勾選 → 建立/更新 ReconciliationBatch(status=DRAFT)
        │        （即時顯示：本次勾選筆數／總額／該代收人尚未繳回總額／
        │         確認後剩餘未繳回總額）
        ▼
   按【確認本次已繳回】→ 填寫實際收到金額／收入帳戶／繳回日期／備註
        │
        ▼
   Transaction 開始：
     1. 重新驗證每筆 AgentCollectionItem 狀態未被其他批次搶先處理
     2. 比對 selectedItemsTotal vs actualReceivedAmount
        │
        ├─ 相符 → 建立 Payment(s) → LedgerEntry → 更新 FinancialAccount
        │         → ReconciliationBatch/Item 狀態更新為 CONFIRMED
        │
        └─ 不符 → 進入差額處理（第二十一節），Transaction 内不建立
                  任何 Payment/LedgerEntry
        │
        ▼
   Transaction 提交（idempotencyKey 保證整個流程只成功執行一次）
```

---

## 二十一、差額與爭議處理流程圖

```
勾選合計 ≠ 實際收到金額
        │
        ▼
   顯示「本次勾選合計與實際收到金額不一致」
        │
        ├─ 選項 1：返回重新勾選 → 回到「本次對帳」重新調整勾選項目
        │
        ├─ 選項 2：標記為有爭議待確認
        │              │
        │              ▼
        │        ReconciliationBatch.status = DISPUTED
        │        對應 AgentCollectionItem.status = DISPUTED
        │              │
        │              ▼
        │        移入「有爭議待確認」子頁籤，提醒排程繼續（第十九節）
        │
        └─ 選項 3+4：記錄差額（discrepancyAmount）＋填寫差額原因
                       （discrepancyReason，必填）
                       │
                       ▼
                 管理者之後決定：
                 - 補充資料後重新確認 → 回到相符路徑
                 - 或維持 DISPUTED，等待進一步查核
```

---

## 二十二、建議 Prisma Schema

**本輪僅為建議提案，不套用到 `prisma/schema.prisma`，不建立
migration**：

```prisma
enum Role {
  OWNER
  SUPER_ADMIN
  FINANCE
  STAFF
  VIEWER
}

// User 新增（比照既有 User model 擴充）：
//   canConfirmAgentReconciliation Boolean @default(false)
//   canLockMonthlyReport          Boolean @default(false)

enum CollectionItemStatus {
  PENDING
  PARTIAL
  REMITTED
  DISPUTED
}

/// V7.1.1 新增：正式取代 V7.2 的 AgentRemittance。
model AgentCollectionItem {
  id String @id @default(cuid())

  registrationGroupId String
  registrationGroup   RegistrationGroup @relation(fields: [registrationGroupId], references: [id])
  receivableId        String
  receivable          Receivable        @relation(fields: [receivableId], references: [id])

  collectorUserId      String?
  collectorUser        User?   @relation("CollectorUser", fields: [collectorUserId], references: [id])
  collectorDisplayName String

  sponsorNameSnapshot String
  payerNameSnapshot   String
  payerMemberId       String?
  payerMember         Member?    @relation(fields: [payerMemberId], references: [id])
  payerHouseholdId    String?
  payerHousehold      Household? @relation(fields: [payerHouseholdId], references: [id])

  activityType ActivityType
  year         Int

  originalAmount Decimal       @db.Decimal(12, 2)
  paidOn         DateTime      @db.Date
  paymentMethod  PaymentMethod
  collectorNotes String?       @db.Text

  remittedAmount Decimal              @default(0) @db.Decimal(12, 2)
  status         CollectionItemStatus @default(PENDING)

  handedOverAt  DateTime?
  confirmedById String?
  confirmedAt   DateTime?

  destinationAccountId String?
  destinationAccount   FinancialAccount? @relation(fields: [destinationAccountId], references: [id])

  reminderCount  Int       @default(0)
  lastRemindedAt DateTime?
  nextReminderAt DateTime?

  disputeReason String? @db.Text

  reconciliationBatchId String? // 目前暫存所屬的草稿批次
  reconciliationBatch   ReconciliationBatch? @relation("DraftBatch", fields: [reconciliationBatchId], references: [id])

  batchItems   ReconciliationBatchItem[]
  payments     Payment[]
  reminderLogs ReminderLog[]

  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([status])
  @@index([nextReminderAt])
  @@index([collectorDisplayName])
  @@map("agent_collection_items")
}

enum ReconciliationBatchStatus {
  DRAFT
  CONFIRMED
  DISPUTED
  VOIDED
  ADJUSTED
}

model ReconciliationBatch {
  id                   String   @id @default(cuid())
  batchNumber          String   @unique
  collectorDisplayName String
  collectorUserId      String?

  remittedOn           DateTime @db.Date
  selectedItemsCount   Int
  selectedItemsTotal   Decimal  @db.Decimal(12, 2)

  actualReceivedAmount Decimal? @db.Decimal(12, 2)
  destinationAccountId String?
  destinationAccount   FinancialAccount? @relation(fields: [destinationAccountId], references: [id])

  discrepancyAmount Decimal? @db.Decimal(12, 2)
  discrepancyReason String?  @db.Text

  status         ReconciliationBatchStatus @default(DRAFT)
  idempotencyKey String                    @unique

  confirmedById String?
  confirmedAt   DateTime?
  voidedById    String?
  voidedAt      DateTime?
  voidReason    String?   @db.Text

  notes String? @db.Text

  draftItems AgentCollectionItem[] @relation("DraftBatch")
  items      ReconciliationBatchItem[]
  payments   Payment[]

  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("reconciliation_batches")
}

model ReconciliationBatchItem {
  id                    String              @id @default(cuid())
  reconciliationBatchId String
  reconciliationBatch   ReconciliationBatch @relation(fields: [reconciliationBatchId], references: [id])
  agentCollectionItemId String
  agentCollectionItem   AgentCollectionItem @relation(fields: [agentCollectionItemId], references: [id])

  amountAppliedThisBatch Decimal @db.Decimal(12, 2)

  createdAt DateTime @default(now())

  @@unique([reconciliationBatchId, agentCollectionItemId])
  @@map("reconciliation_batch_items")
}

enum ReminderChannel {
  IN_APP
  EMAIL // 保留，本輪不啟用
  LINE  // 保留，本輪不啟用
}

enum ReminderLogStatus {
  SUCCESS
  FAILED
}

model ReminderLog {
  id                    String   @id @default(cuid())
  agentCollectionItemId String
  agentCollectionItem   AgentCollectionItem @relation(fields: [agentCollectionItemId], references: [id])

  remindedAt       DateTime
  reminderSequence Int
  reminderChannel  ReminderChannel   @default(IN_APP)
  recipient        String?
  status           ReminderLogStatus @default(SUCCESS)
  errorMessage     String?           @db.Text

  createdAt DateTime @default(now())

  @@map("reminder_logs")
}

/// V7.1.1 新增：通用排程執行紀錄，本輪同時供「代收提醒排程」與
/// 「月底報表產生排程」（見 docs/MONTHLY_FINANCIAL_REPORT.md）共用。
enum ScheduledJobRunStatus {
  SUCCESS
  FAILED
  SKIPPED
}

model ScheduledJobRun {
  id            String   @id @default(cuid())
  jobName       String // 例如 "AGENT_COLLECTION_REMINDER" / "MONTHLY_FINANCIAL_REPORT_GENERATION"
  scheduledFor  DateTime
  startedAt     DateTime
  finishedAt    DateTime?
  status        ScheduledJobRunStatus
  resultSummary String? @db.Text
  errorMessage  String? @db.Text

  createdAt DateTime @default(now())

  @@index([jobName, scheduledFor])
  @@map("scheduled_job_runs")
}

// Payment 新增欄位（比照既有 Payment model 擴充，非重新定義）：
//   collectionItemId      String? （非 unique，同一筆代收款可能因分次繳回產生多筆 Payment）
//   reconciliationBatchId String?
```

---

## 二十三、排程方案

**提醒排程**（沿用 V7.2 時間規則，本輪新增執行紀錄）：每週三、週五
19:30（Asia/Taipei），建議使用 **Render Cron Job**（或等效可靠的後端
排程服務，例如另建一個獨立的排程 worker process），呼叫應用程式內部
的提醒掃描邏輯；每次執行都建立一筆 `ScheduledJobRun`
（`jobName="AGENT_COLLECTION_REMINDER"`），成功/失敗都要記錄，失敗時
不阻擋下一次排程，但需要能在首頁或系統管理畫面看到「上次提醒排程失敗」
的訊號（本輪只定案要留紀錄，實際告警呈現方式列入尚待確認事項）。**不
能只依賴使用者打開瀏覽器才計算提醒**——這是明確的技術要求，因此排程
必須是伺服器端主動觸發，不是「使用者進入某個畫面時順便算一下」。

---

## 二十四、哪些資料可以沿用／哪些要新增

**完全沿用**：`RegistrationGroup`/`Receivable`/`Payment`/
`LedgerEntry`/`FinancialAccount`/`Member`/`Household`/`User`（欄位
擴充，非重新設計）、既有 `ReceivableStatus` 7 值狀態機（V7.1，本輪
不變）。

**擴充既有模型**：`Role` enum（新增 `OWNER`/`VIEWER`，`FINANCE_CLERK`
正式改名 `FINANCE`）、`User`（新增 `canConfirmAgentReconciliation`/
`canLockMonthlyReport`）、`Payment`（新增
`collectionItemId`/`reconciliationBatchId`，均為 nullable）。

**全新模型**：`AgentCollectionItem`（取代 `AgentRemittance`）、
`ReconciliationBatch`、`ReconciliationBatchItem`、`ReminderLog`、
`ScheduledJobRun`、`CollectionItemStatus`/`ReconciliationBatchStatus`/
`ReminderChannel`/`ReminderLogStatus`/`ScheduledJobRunStatus` enum。

**不再繼續擴充的舊模型**：`AgentRemittance`（V7.2）——保留在
`prisma/schema.prisma` 提案文件中作為歷史脈絡，正式開發時建議直接
以 `AgentCollectionItem` 取代，不需要兩者並存。

---

## 二十五、Migration 計畫（本輪不執行）

僅記錄未來實際套用時的建議步驟，**本輪完全不執行**：

1. 擴充 `Role` enum（新增值不影響既有資料，`FINANCE_CLERK` 改名
   `FINANCE` 需要資料回填：既有 `FINANCE_CLERK` 使用者的 `role` 欄位
   更新為 `FINANCE`）。
2. `User` 新增兩個布林欄位（有預設值，安全）。
3. 新增五張資料表：`agent_collection_items`、
   `reconciliation_batches`、`reconciliation_batch_items`、
   `reminder_logs`、`scheduled_job_runs`。
4. `payments` 資料表新增 `collection_item_id`／
   `reconciliation_batch_id`（nullable，安全）。
5. 若正式決定以 `AgentCollectionItem` 取代 `AgentRemittance`：由於
   `AgentRemittance` 本輪只是規格提案、從未套用 migration，正式開發
   時直接建立 `AgentCollectionItem` 即可，不需要「先建表再遷移資料」
   的額外步驟。
6. 應用層需要為 `ReconciliationBatch.idempotencyKey` 與
   `@@unique([reconciliationBatchId, agentCollectionItemId])`
   設計對應的錯誤處理（違反唯一約束時，回傳「已處理過」而不是一般
   500 錯誤）。

---

## 二十六、開發順序

1. `Role`/`User` 欄位擴充（權限預留，優先做，風險低）。
2. `AgentCollectionItem` 模型與建立邏輯（登記代收款項）。
3. 首頁提醒卡、收款中心「尚未繳回」清單（讀取為主，風險低）。
4. `ReconciliationBatch`/`ReconciliationBatchItem`（勾選/本次對帳
   工作區）。
5. 確認對帳 Transaction 邏輯（含差額比對、idempotency，風險最高，
   建議完整測試涵蓋第九節列出的五種防重複情境）。
6. `Payment`/`LedgerEntry` 銜接（確認後正式入帳）。
7. `ReminderLog` 與提醒排程（`ScheduledJobRun` 共用模型，可以跟月底
   報表排程一起規劃技術選型）。
8. 有爭議待確認的處理流程（畫面與資料狀態轉換）。

---

## 二十七、風險與尚待確認事項

1. **「經授權的 FINANCE」授權機制是否需要更完整的設計？** 本規格暫定
   兩個布林開關（`canConfirmAgentReconciliation`/
   `canLockMonthlyReport`），如果未來授權情境變複雜（例如需要針對
   特定活動/特定金額範圍授權），可能需要改成獨立的權限授予表——本輪
   先用最簡單的方式滿足「不是所有 FINANCE 都自動有權限」這個要求。
2. **`OWNER` 唯一性/移交流程的技術實作方式**（例如是否需要
   OTP/簡訊驗證）本輪只定業務規則，沒有規劃技術細節，需要在正式
   設計登入機制時一併確認。
3. **排程失敗時的告警呈現方式**：本輪只定案要建立
   `ScheduledJobRun` 失敗紀錄，但「管理者怎麼知道排程失敗了」（首頁
   跳提示？系統管理畫面？）沒有具體設計，需要你確認期望的呈現方式。
4. **`ReconciliationBatch` 一個批次限定一位代收人**是本規格的假設
   （對應「選擇某位代收人後，列出所有尚未繳回款項」的操作流程），如果
   實務上需要跨代收人合併對帳（例如代收人請假、由別人一起送來），
   需要另外設計，本輪未涵蓋此情境。
5. **`AgentCollectionItem.destinationAccountId` 在部分繳回情境下的
   語意**：如果同一筆代收款分兩次繳回、兩次指定不同帳戶，這個欄位
   只反映「最近一次」，真正的歷史記錄在
   `ReconciliationBatchItem`／對應 `Payment.financialAccountId`——
   畫面呈現時需要清楚說明這個欄位只是輔助顯示，不是唯一真相來源。
6. 延續 V7.2 既有的尚待確認事項（`docs/AGENT_REMITTANCE.md` 第十六
   節），本輪已經解決其中「首頁彙總數字是否納入爭議狀態」（本輪明確
   納入 `PENDING`/`PARTIAL`/`DISPUTED` 三種），其餘項目維持待確認。

---

## 二十八、本輪確認：本次完全沒有做的事

- 沒有開發代收待繳回提醒卡、代收對帳頁籤的任何正式畫面或 API。
- 沒有修改 `prisma/schema.prisma`、沒有建立 migration、沒有變更正式
  資料庫。
- 沒有實作正式登入/Session 機制，只做角色與權限欄位的資料模型預留。
- 沒有實作 Render Cron Job 或任何排程服務的實際程式碼，只規劃排程
  時間與資料記錄方式。
- 沒有開發電子收據、PDF 正式輸出、Excel 正式匯出。
- 沒有串接任何外部 Email/LINE 通知。
- 沒有修改報名畫面既有的兩個按鈕。
- 沒有推翻既有 V7.0/V7.0.2/V7.0.3/V7.1 設計。
- 沒有部署 Render、沒有推送 GitHub、沒有執行
  `npm install`/`prisma generate`/`next build`。
- 沒有開始下一版。
