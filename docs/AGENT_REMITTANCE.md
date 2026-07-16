# 台北三玄宮 ERP — 代收待繳回提醒（Agent Remittance Reminder）規格定稿（V7.2）

**狀態：規格、資料模型、流程圖定案，尚未實作、尚未套用 migration、尚未
開發任何正式 UI/API、尚未執行 Build、尚未變更正式資料庫。**

> **⚠️ 本文件已被 V7.1.1 取代（superseded）**：本文件描述的
> `AgentRemittance` 模型與 3 種狀態機，在 V7.1.1
> 「代收待繳回對帳＋月底財務報表規格整合版」中，已經被更完整的
> **雙軌帳本設計**取代——新的權威模型是 `AgentCollectionItem`
> （4 種狀態、支援部分繳回、支援對帳批次 `ReconciliationBatch`），
> 新的權威文件是 `docs/AGENT_COLLECTION_RECONCILIATION.md`。本文件
> 保留作為 V7.2 階段的歷史脈絡與需求演進紀錄，**欄位與流程細節請一律
> 以 `docs/AGENT_COLLECTION_RECONCILIATION.md` 為準**，若兩份文件有
> 出入，以新文件為準。

本文件是「代收待繳回提醒」——追蹤代收人（例如代辦人、志工、外出收款的
信眾）已經向功德主收到款項、但**尚未把這筆現金/款項實際交到宮方手上**
這段期間的權威規格文件。這是收款中心底下的一個新頁籤（代收對帳），跟
`docs/COLLECTION_CENTER.md`（V7.1）互相銜接，**本輪不推翻**該文件已
定案的任何規則。

---

## 目錄

1. 目標與核心原則
2. 與既有收款流程的關係（代收 vs 快速收款 vs 立即收款）
3. 資料模型：`AgentRemittance`
4. 繳回狀態機（3 種狀態）與「本次對帳」工作區
5. 提醒規則與排程邏輯
6. 首頁「代收待繳回」提醒卡
7. 收款中心「代收對帳」頁籤（4 個子頁籤）
8. 每筆代收款項顯示欄位
9. 對帳流程圖
10. 提醒排程流程圖
11. ER Diagram（含新模型與既有關聯）
12. 建議 Prisma Schema（完整程式碼區塊）
13. 哪些資料可以沿用／哪些要新增
14. Migration 計畫（本輪不執行）
15. 開發順序
16. 風險與尚待確認事項
17. 本輪確認：本次完全沒有做的事

---

## 一、目標與核心原則

三玄宮實務上常見的情境是：代辦人（例如林美玲）已經跟王家、陳家、李家
收了年度燈的錢，但這筆現金還在林美玲手上，**還沒有拿到宮裡**。從信眾
的角度看，錢「已經繳了」；但從宮方財務的角度看，**這筆錢還沒有真正進
宮方的現金/銀行帳戶**，如果系統這時候就把它當作已收款、更新銀行餘額，
帳目會跟宮方實際能動用的現金金額不符。

**核心原則**：

1. **代收款項是一個獨立於 `Payment` 之外的「尚未繳回」追蹤層**，本身
   不建立 `LedgerEntry`、不更新 `FinancialAccount` 餘額——這是延伸
   `docs/FINANCE_AND_ACTIVITY_SPEC.md` 從第一輪就定案的核心原則「未
   實際收到的款項，不可增加現金或銀行餘額」，把「實際收到」精確定義
   為「宮方實際拿到這筆錢」，不是「代收人向信眾收了錢」。
2. **只有管理者確認代收人已經把錢交回來（繳回對帳），系統才會建立正式
   `Payment`**，這時候才走既有的「建立 Payment → 自動建立 LedgerEntry
   → 更新 FinancialAccount 餘額」流程（`docs/FINANCE_CORE_SCHEMA.md`
   第四節、`docs/COLLECTION_CENTER.md` 第十五節，本輪不變）。
3. **代收人跟功德主是兩個不同角色**，這正好對應
   `docs/COLLECTION_CENTER.md` 第五節已經定案的「功德主與付款人分開」
   規則——代收人在這裡扮演的就是「付款人」的角色（`Payment.
   payerNameSnapshot`），功德主仍然是報名/贊助這件事的人，本輪不需要
   為「代收人」另外發明一套新概念，直接沿用既有的付款人欄位設計。
4. **提醒只會越提醒越積極，不會自己停止或自動視為完成**——這是本輪
   最重要的行政保護規則：只有管理者親自勾選＋確認對帳，提醒才會停止，
   系統不能因為時間到了、或提醒次數夠多了，就自己判斷這筆錢「應該」
   已經繳回。

---

## 二、與既有收款流程的關係（代收 vs 快速收款 vs 立即收款）

收款中心目前有三種「錢還沒有正式變成 `Payment`」的情境，容易混淆，
本節明確區分：

| 情境 | 誰手上有現金 | 資料狀態 | 何時建立正式 `Payment` |
|---|---|---|---|
| 【立即收款】（V7.0.3） | **宮方當場已經拿到** | 報名完成的同一步就建立 `Payment` | 當下立即建立 |
| 快速收款 `QuickCollectionEntry`（V7.1 第十二節） | **宮方當場已經拿到**，只是報名資料還沒備齊 | 立即建立 `Payment`（`receivableId` 暫時為 null） | 當下立即建立（之後只是補齊 `receivableId` 關聯） |
| **代收待繳回 `AgentRemittance`（本輪新增）** | **代收人手上，宮方還沒拿到** | 只建立 `AgentRemittance` 追蹤紀錄，**不建立 `Payment`** | **等管理者確認代收人已經把錢交回來** |

**關鍵差異就是「宮方現在手上到底有沒有這筆現金」**：前兩種情境宮方
當場就實際拿到錢，只是報名資料完整度不同；代收待繳回情境宮方**還沒
拿到**，所以不能比照快速收款立刻建立 `Payment`，否則帳上金額會超過
宮方實際能動用的現金。

**本輪不修改報名畫面既有的【先存為未繳】／【立即收款】兩個按鈕**——
登記「這筆報名有代收人正在幫忙收款」是**管理者在收款中心對一筆既有
的 `Receivable`（狀態未繳或部分繳款）額外做的動作**，不是報名當下的
第三個按鈕。這樣可以不用改動 V7.0.3/V7.1 已經定案的報名流程，把代收
追蹤純粹當作收款中心裡「這筆應收，錢目前的實際去向」的補充資訊。

---

## 三、資料模型：`AgentRemittance`

一筆 `AgentRemittance` 代表「某位代收人，針對某一筆報名（某個
`RegistrationGroup`/`Receivable`），已經向功德主收了一筆錢，但還沒
交回宮方」這個事實：

- **必須連回既有的 `RegistrationGroup`/`Receivable`**——因為畫面上要
  顯示功德主、活動、金額，這些資訊本來就已經存在於既有報名資料裡，
  不像快速收款需要處理「連報名資料都還沒建立」的情境。
- **代收人**：`collectorNameSnapshot`（快照文字，比照
  `Payment.payerNameSnapshot` 的既有設計，防止之後修改姓名資料影響
  歷史紀錄），可選填 `collectorMemberId`/`collectorHouseholdId` 關聯
  已知資料。
- 一筆 `Receivable` 底下可以有多筆 `AgentRemittance`（例如代收人分
  兩次向不同家人收款，或是同一筆應收先後委託不同代收人），彼此獨立
  追蹤與提醒。

---

## 四、繳回狀態機（3 種狀態）與「本次對帳」工作區

```prisma
enum RemittanceStatus {
  PENDING   // 尚未繳回
  DISPUTED  // 有爭議待確認
  REMITTED  // 已繳回
}
```

**狀態轉換**：

```
PENDING ──管理者勾選「已繳回」，對帳金額相符──▶ REMITTED
PENDING ──管理者勾選「已繳回」，但對帳金額不符或有疑義──▶ DISPUTED
DISPUTED ──管理者釐清後確認金額相符──▶ REMITTED
DISPUTED ──管理者釐清後確認就是原本代收金額有誤，更正後仍相符──▶ REMITTED
```

**明確禁止**：`PENDING`/`DISPUTED` 不會因為時間經過或提醒次數累積而
自動變成 `REMITTED`——這是本節與第一節都反覆強調的規則，唯一觸發狀態
轉換的動作是管理者在畫面上執行「確認對帳」。

**「本次對帳」是工作區，不是第 4 種狀態**：收款中心「代收對帳」頁籤
底下的「本次對帳」，是管理者從「尚未繳回」清單裡**勾選**這次要處理的
項目後，暫時集中呈現、逐筆輸入實際繳回金額/日期/備註、準備送出確認
的工作畫面。勾選/取消勾選只是畫面上的暫時選取狀態，在按下「確認對帳」
之前，這些項目的 `RemittanceStatus` 仍然是 `PENDING`，並不會因為
被勾選進「本次對帳」而停止提醒或改變狀態——避免管理者勾選後如果沒有
真的按下確認，卻誤以為這筆錢已經處理掉。

---

## 五、提醒規則與排程邏輯

**排程時間**：每週三、週五晚上 7:30，系統掃描所有 `status` 為
`PENDING` 或 `DISPUTED` 的 `AgentRemittance`：

1. `reminderCount` 加 1。
2. `lastReminderAt` 設為本次提醒的時間。
3. `nextReminderAt` 重新計算為「下一個週三或週五晚上 7:30」（從本次
   提醒時間往後找，不含本次）。

**至少提醒五次，五次後若仍未確認，繼續提醒**：這不是「提醒 5 次就
停止」，而是反過來確保提醒機制至少能持續 5 輪、之後也不會自己停下來
——只要 `status` 還是 `PENDING`/`DISPUTED`，每週三/五晚上 7:30 就會
一直產生下一次提醒，沒有上限。

**建立時機**：一筆新建立的 `AgentRemittance`，`reminderCount` 從 0
開始，`nextReminderAt` 在建立當下就先計算好（下一個週三或週五晚上
7:30），確保新登記的代收款項也會被下一輪排程掃描到，不需要等到「已經
逾期」才開始提醒。

**停止時機**：`status` 轉為 `REMITTED` 的那一刻，`nextReminderAt`
清空（設為 null），排程掃描時自然跳過，不需要額外的「暫停提醒」開關。

---

## 六、首頁「代收待繳回」提醒卡

首頁新增一張提醒卡片，資料來源是所有 `status` 為 `PENDING` 或
`DISPUTED` 的 `AgentRemittance`（**本輪設計決策：兩種狀態都算進
「尚未繳回」的彙總數字，因為兩者都還沒有完成繳回確認**，見第十六節
尚待確認事項第 1 項）：

- **尚未繳回總筆數**：符合上述條件的 `AgentRemittance` 筆數。
- **尚未繳回總金額**：這些筆數的 `amount` 加總。
- **依代收人分組的筆數與金額**：依 `collectorNameSnapshot`（或
  `collectorMemberId` 已知時優先用其正式姓名）分組，各自顯示筆數與
  金額加總，方便管理者知道「要去找哪位代收人」。
- **最久未繳回天數**：這些項目裡，`collectedOn` 距離今天最久的天數。
- **進入對帳按鈕**：導向收款中心「代收對帳」頁籤，預設開啟「尚未
  繳回」子頁籤。

---

## 七、收款中心「代收對帳」頁籤（4 個子頁籤）

收款中心新增「代收對帳」頁籤，底下 4 個子頁籤：

1. **尚未繳回**：`status = PENDING` 的清單，依「代收日期」由舊到新
   排序（最久未繳回的排最前面），每筆可勾選加入「本次對帳」。
2. **本次對帳**：目前勾選、準備處理的項目工作區（見第四節），逐筆
   輸入實際繳回金額/繳回日期/備註，執行「確認對帳」。
3. **已繳回紀錄**：`status = REMITTED` 的歷史清單，保留完整的
   `reminderCount`/`lastReminderAt`/`remittedAmount`/`remittedAt`/
   `confirmedById` 等對帳資料，供之後查核。
4. **有爭議待確認**：`status = DISPUTED` 的清單，顯示 `disputeReason`
   （對帳時記錄的爭議說明），管理者可以從這裡重新編輯/確認，解決後
   轉為 `REMITTED`。

---

## 八、每筆代收款項顯示欄位

依你的需求，每筆代收款項至少顯示：

| 欄位 | 對應資料 |
|---|---|
| 代收人 | `collectorNameSnapshot` |
| 功德主 | 來自關聯的 `RegistrationGroup`/`RegistrationItem`（沿用既有欄位，不重複儲存） |
| 活動 | 來自關聯的 `Receivable`/`ActivityYear`（沿用既有欄位） |
| 金額 | `amount` |
| 代收日期 | `collectedOn` |
| 已提醒次數 | `reminderCount` |
| 上次提醒日期 | `lastReminderAt` |
| 下一次提醒日期 | `nextReminderAt` |
| 繳回狀態 | `status`（尚未繳回/有爭議待確認/已繳回，對應第四節色彩系統延伸使用 `docs/COLLECTION_CENTER.md` 第十三節既有的灰粉玫瑰色=待處理、鼠尾草綠=完成） |
| 備註 | `notes` |

---

## 九、對帳流程圖

```
管理者在「尚未繳回」勾選這次確定要處理的項目
        │
        ▼
   項目出現在「本次對帳」工作區（RemittanceStatus 仍為 PENDING，未變動）
        │
        ▼
   逐筆輸入：實際繳回金額 / 繳回日期 / 備註
        │
        ├─ 金額相符（或管理者確認接受差異）
        │        │
        │        ▼
        │   status → REMITTED，remittedAmount/remittedAt/confirmedById 寫入
        │        │
        │        ▼
        │   建立正式 Payment（payerNameSnapshot = 代收人，關聯回原本的 Receivable）
        │        │
        │        ▼
        │   自動建立 LedgerEntry，更新 FinancialAccount 餘額
        │        │
        │        ▼
        │   nextReminderAt 清空，移入「已繳回紀錄」
        │
        └─ 金額不符或有疑義
                 │
                 ▼
            status → DISPUTED，disputeReason 記錄爭議說明
                 │
                 ▼
            移入「有爭議待確認」，提醒排程繼續（見第五節）
                 │
                 ▼
            管理者之後釐清 → 回到本次對帳流程重新確認
```

---

## 十、提醒排程流程圖

```
每週三／週五 19:30（系統排程）
        │
        ▼
   掃描 status IN (PENDING, DISPUTED) 且 nextReminderAt <= 現在 的 AgentRemittance
        │
        ▼
   逐筆：reminderCount += 1；lastReminderAt = 現在
        │
        ▼
   重新計算 nextReminderAt = 下一個週三或週五 19:30
        │
        ▼
   （提醒呈現方式：本輪只定案首頁提醒卡與收款中心清單會反映最新的
   reminderCount/lastReminderAt/nextReminderAt，是否需要額外的推播/
   Email/簡訊通知，見第十六節尚待確認事項）
```

---

## 十一、ER Diagram（含新模型與既有關聯）

```
RegistrationGroup ──1:1── Receivable
      │                       │
      │                       ├──1───N Payment（既有，V7.0/V7.1）
      │                       │
      │                       └──1───N AgentRemittance（★V7.2 新增）
      │                                    │  collectorNameSnapshot/
      │                                    │  collectorMemberId/collectorHouseholdId/
      │                                    │  amount/collectedOn/
      │                                    │  reminderCount/lastReminderAt/nextReminderAt/
      │                                    │  status（RemittanceStatus）/
      │                                    │  remittedAmount/remittedAt/confirmedById/
      │                                    │  disputeReason/linkedPaymentId
      │                                    │
      │                                    ├──N:1（可選）── Member（collectorMemberId）
      │                                    ├──N:1（可選）── Household（collectorHouseholdId）
      │                                    └──0/1:1（確認繳回後）── Payment（linkedPaymentId）
      │
      └──1───N RegistrationItem（既有，不變）
```

（`AgentRemittance` 完全不直接連到 `FinancialAccount`/`LedgerEntry`，
架構上保證代收追蹤本身不會影響現金/銀行餘額，只有它衍生出來的
`Payment` 才會，符合第一節核心原則。）

---

## 十二、建議 Prisma Schema（完整程式碼區塊）

**本輪僅為建議提案，不套用到 `prisma/schema.prisma`，不建立
migration**：

```prisma
enum RemittanceStatus {
  PENDING   // 尚未繳回
  DISPUTED  // 有爭議待確認
  REMITTED  // 已繳回
}

/// V7.2 新增：代收待繳回追蹤。代收人已經向功德主收到款項，但宮方尚未
/// 實際拿到這筆現金/款項期間的追蹤紀錄。本模型本身不建立 LedgerEntry、
/// 不更新 FinancialAccount 餘額——只有確認繳回（status=REMITTED）後
/// 建立的 linkedPaymentId 才會真正影響帳務。
model AgentRemittance {
  id String @id @default(cuid())

  registrationGroupId String
  registrationGroup   RegistrationGroup @relation(fields: [registrationGroupId], references: [id])
  receivableId        String
  receivable          Receivable        @relation(fields: [receivableId], references: [id])

  collectorNameSnapshot String
  collectorMemberId     String?
  collectorMember       Member?    @relation(fields: [collectorMemberId], references: [id])
  collectorHouseholdId  String?
  collectorHousehold    Household? @relation(fields: [collectorHouseholdId], references: [id])

  amount      Decimal  @db.Decimal(12, 2) // 代收金額（代收人向功德主收到的金額）
  collectedOn DateTime @db.Date           // 代收日期

  reminderCount   Int       @default(0)
  lastReminderAt  DateTime?
  nextReminderAt  DateTime?

  status RemittanceStatus @default(PENDING)

  remittedAmount Decimal?  @db.Decimal(12, 2) // 對帳確認時實際繳回的金額
  remittedAt     DateTime?
  confirmedById  String?
  disputeReason  String?   @db.Text

  linkedPaymentId String?  @unique
  linkedPayment   Payment? @relation(fields: [linkedPaymentId], references: [id])

  notes String? @db.Text

  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([status])
  @@index([nextReminderAt])
  @@index([registrationGroupId])
  @@index([receivableId])
  @@map("agent_remittances")
}
```

（`RegistrationGroup`/`Receivable`/`Payment`/`Member`/`Household` 均
沿用既有模型，只需新增反向關聯欄位，不需要變更既有欄位定義。）

---

## 十三、哪些資料可以沿用／哪些要新增

**完全沿用，本輪不變**：`RegistrationGroup`/`Receivable`/`Payment`/
`LedgerEntry`/`FinancialAccount`/`Member`/`Household`，以及
`docs/COLLECTION_CENTER.md` 已定案的功德主與付款人分開規則
（`payerNameSnapshot` 概念直接沿用在 `collectorNameSnapshot` 上）。

**全新模型**：`AgentRemittance`、`RemittanceStatus` enum。

**既有模型新增反向關聯**（非欄位變更，只是加一行 `AgentRemittance[]`
讓 Prisma 產生反向查詢）：`RegistrationGroup`、`Receivable`、
`Payment`、`Member`、`Household`。

---

## 十四、Migration 計畫（本輪不執行）

僅記錄未來實際套用時的建議步驟，**本輪完全不執行**：

1. 新增 enum `RemittanceStatus`。
2. 新增資料表 `agent_remittances`，含所有第十二節列出的欄位與索引。
3. 既有模型（`RegistrationGroup`/`Receivable`/`Payment`/`Member`/
   `Household`）新增反向關聯，不需要異動既有欄位或既有資料。
4. 應用層新增排程：每週三、週五 19:30 觸發提醒掃描（技術實作時需要
   決定用什麼機制執行——例如 cron job、Render 排程服務，或應用程式
   內建的排程套件，本輪不決定技術選型，只定案「什麼時候該掃描、掃描
   後該更新哪些欄位」的規則）。

---

## 十五、開發順序

1. `AgentRemittance` 模型與 `RemittanceStatus` enum。
2. 「登記代收款項」的操作入口（在既有 `Receivable` 詳細畫面新增
   動作，不是報名畫面的新按鈕）。
3. 收款中心「代收對帳」頁籤（尚未繳回／本次對帳／已繳回紀錄／有爭議
   待確認 四個子頁籤）。
4. 確認對帳 → 建立正式 `Payment` 的邏輯（沿用既有建立 `Payment` 的
   邏輯，不另外寫一套）。
5. 首頁「代收待繳回」提醒卡（讀取彙總數字，風險最低，可以跟第 3 項
   平行開發）。
6. 提醒排程（週三/週五 19:30 掃描更新 `reminderCount`/
   `lastReminderAt`/`nextReminderAt`）——建議放在開發順序最後，因為
   需要先有前面幾項的資料才能真正測試排程邏輯。

---

## 十六、風險與尚待確認事項

1. **首頁「尚未繳回總筆數/總金額」是否應該包含 `DISPUTED` 狀態？**
   本規格預設「包含」（兩者都還沒有完成繳回確認），如果你希望首頁
   數字只反映單純逾期未繳回、把有爭議的另外獨立呈現，需要告知後
   調整彙總邏輯。
2. **提醒目前只在系統畫面（首頁提醒卡、收款中心清單）呈現
   `reminderCount`/`lastReminderAt`/`nextReminderAt`，本輪沒有規劃
   推播通知、簡訊、Email 或 LINE 提醒**——如果宮方希望提醒真的主動
   通知到管理者（而不是管理者自己要打開系統才看得到），需要另外
   規劃通知管道，這是明確排除在本輪範圍外的部分。
3. **「已提醒 5 次以上」是否需要在畫面上有額外的視覺升級（例如變成
   更醒目的警示色、或標記需要主管關注）？** 本規格只定案 5 次是
   「提醒機制至少要撐得住的下限」，沒有規劃 5 次後的特別視覺處理，
   如果宮方需要，屬於後續版本可以加的細節。
4. **`AgentRemittance` 是否允許「代收人」跟「功德主」是同一個人？**
   例如功德主自己委託家人代收再自己送來，或功德主本人分批繳交——
   本規格沒有限制 `collectorNameSnapshot` 一定要跟功德主不同，兩者
   相同時系統一樣正常運作，只是實務上比較少見這種情境。
5. **一筆 `Receivable` 同時有多筆 `AgentRemittance` 時，「應收/已收/
   未收」金額怎麼呈現？** 本規格目前設計是「未確認繳回的代收金額」
   不影響 `Receivable.paidAmount`（因為還沒有對應的 `Payment`），
   畫面上可能需要額外提示「其中 NT$ X 已由代收人收取、尚未繳回」，
   避免管理者誤以為這筆應收完全沒有任何動靜——這是一個畫面呈現上的
   細節，本輪只定資料模型，具體呈現方式待你在後續版本確認。
6. **登記代收款項的操作權限**：跟第十一節「風險」章節（V7.1）尚未
   解決的「哪些操作需要主管層級權限」問題一樣，代收登記/確認對帳/
   標記爭議這幾個動作，是否所有行政人員都能操作，還是需要更高權限，
   本輪不決定，待你在整體權限規劃時一併確認。

---

## 十七、本輪確認：本次完全沒有做的事

- 沒有開發「代收待繳回」提醒卡、代收對帳頁籤的任何畫面或 API。
- 沒有修改 `prisma/schema.prisma`、沒有建立 migration、沒有變更正式
  資料庫。
- 沒有修改報名畫面既有的【先存為未繳】／【立即收款】兩個按鈕，也沒有
  新增報名時的第三個按鈕。
- 沒有推翻 `docs/COLLECTION_CENTER.md`（V7.1）、
  `docs/FINANCE_CORE_SCHEMA.md`（V7.0）既有定案的規則與模型。
- 沒有規劃或開發任何推播/簡訊/Email 通知機制，只定案系統內部的
  `reminderCount`/`lastReminderAt`/`nextReminderAt` 資料欄位。
- 沒有部署 Render、沒有推送 GitHub、沒有執行
  `npm install`/`prisma generate`/`next build`。
- 沒有開始下一輪（V7.3 或其他未來版本）的任何工作。
