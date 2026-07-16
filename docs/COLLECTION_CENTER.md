# 台北三玄宮 ERP — Collection Center（收款中心）規格與流程定稿（V7.1）

**狀態：規格、資料模型、流程圖、低保真 Wireframe 定案，尚未實作、尚未
套用 migration、尚未開發任何正式 UI/API、尚未執行 Build、尚未變更正式
資料庫。**

本文件是「收款中心」——三玄宮**所有活動共用**的收款/查詢/對帳入口——的
權威規格文件。收款中心不是新的活動，而是一個橫跨年度燈、祭改、南巡、
北巡、宮慶、普渡、補庫七個活動的**共用操作層**，讓行政人員不需要記得
「這筆錢是哪個活動的」就能查到、收到、對到帳。

**本輪不得推翻既有 `docs/FINANCE_CORE_SCHEMA.md`（V7.0 財務核心九個
模型）與 `docs/ACTIVITY_ENGINE.md`（V7.0.2 年度活動引擎）。** 本文件是
在既有九個模型之上做「狀態擴充」與「新增兩個輔助模型」，不重新設計
`RegistrationGroup`/`RegistrationItem`/`Receivable`/`FinancialAccount`/
`LedgerEntry`/`ActivitySummary` 的核心結構。

**V7.2 更新重點**：新文件 `docs/AGENT_REMITTANCE.md` 正式定案「代收
待繳回提醒」——收款中心新增「代收對帳」頁籤，追蹤代收人已向功德主收款
但尚未交回宮方這段期間的狀態，新增 `AgentRemittance` 模型與
`RemittanceStatus` enum。**本模型本身不建立 `LedgerEntry`、不更新
`FinancialAccount` 餘額，只有確認繳回後才會建立正式 `Payment`**，
延伸本文件第五節「功德主與付款人分開」的既有設計（代收人＝付款人角色）。
完整規則見 `docs/AGENT_REMITTANCE.md`，架構決策見 `docs/ADR.md`
ADR-0016。

**V7.1.1 更新重點**：`docs/AGENT_REMITTANCE.md`（V7.2）已被
`docs/AGENT_COLLECTION_RECONCILIATION.md`（V7.1.1）取代——「代收
對帳」頁籤的權威模型改為 `AgentCollectionItem`（4 種狀態：信眾尚未
付款／信眾已付款但款項在代收人手上／代收人已繳回三玄宮／三玄宮已
完成核對與正式入帳）與 `ReconciliationBatch`（對帳批次，支援部分
繳回、防止重複對帳），採用**雙軌帳本**設計（`Receivable.paidAmount`
與 `FinancialAccount.balance` 分開更新，只有對帳批次確認後餘額才會
異動）。同一輪新增月底自動財務報表，權威文件是
`docs/MONTHLY_FINANCIAL_REPORT.md`，兩份新文件都不推翻本文件第五、
六、十一、十二節的既有設計，只是在「代收對帳」頁籤與月底結算流程上
做進一步擴充。架構決策見 `docs/ADR.md` ADR-0017～ADR-0020。

---

## 目錄

1. 目標與核心原則
2. 報名完成時的兩個按鈕（跨活動通用版）
3. 付款狀態：7 種狀態與判定規則
4. `Payment` 完整欄位定案
5. 功德主（贊助人）與付款人分開
6. 收款中心搜尋規格
7. 一人代辦一大群人（多人小計顯示）
8. 年度燈／祭改：個人計價 vs 全家燈計價（`FamilyLampGroup` 新模型）
9. 普渡收款（收款中心情境下的規則重申）
10. 南巡與北巡：以車次為主要財務單位
11. 流水帳與帳戶規則（重申 + 收款中心情境）
12. 快速收款（`QuickCollectionEntry` 新模型）
13. 低保真 Wireframe 說明
14. ER Diagram（完整版，含新模型）
15. 收款資料流程圖
16. 報名當下立即付款流程圖（跨活動通用版）
17. 部分付款與退款流程圖
18. 多人代辦計價流程圖
19. 南北巡車次統計流程圖
20. 建議 Prisma Schema（完整程式碼區塊）
21. 哪些資料可以沿用／哪些要新增
22. Migration 計畫（本輪不執行）
23. 開發順序
24. 風險與尚待確認事項
25. 本輪確認：本次完全沒有做的事

---

## 一、目標與核心原則

收款中心要解決的是行政人員每天實際會問的問題，不是財務理論問題：

- 「王小姐報名的燈，繳了沒？」
- 「林美玲代辦的那一批普渡，一共多少錢？收了多少？」
- 「南巡第 3 車，錢對不對得起來？」
- 「信眾臨櫃直接拿錢出來，但報名資料還沒建好，要怎麼先把錢收下來？」

**核心原則（全部繼承自 V7.0／V6.4／V7.0.3，本輪不推翻）**：

1. 報名與收款永遠分開建立資料（`RegistrationGroup`/`RegistrationItem`
   跟 `Receivable` 是一組，`Payment` 是另一組），但**允許在同一次操作
   裡完成兩者**（見第二節）。
2. `Receivable` 永遠不直接動銀行/現金餘額，只有 `Payment` 才能動
   （ADR-0008，本輪不變）。
3. 一筆 `Payment` 只會產生一筆 `LedgerEntry`，資料庫層級用
   `@@unique([paymentId])` 保證（ADR-0003/ADR-0013，本輪不變，且
   延伸到快速收款情境，見第十二節）。
4. 收款中心是**查詢與操作介面層**，底下資料仍然按活動分別存放在
   `RegistrationGroup`/`RegistrationItem`，收款中心不會把七個活動的
   報名資料「搬」到一張新的大表——它只是一個橫向查詢/彙總的窗口。

---

## 二、報名完成時的兩個按鈕（跨活動通用版）

`docs/ADMINISTRATION_RULES.md` 第十一節（V7.0.3）已經定案【先存為
未繳】／【立即收款】兩個按鈕。本輪**重申並明確這是七個活動共用的
規則，不是只給年度燈用**：不論是年度燈個人報名、全家燈整組報名
（第八節）、普渡代辦人多戶報名、南北巡車次報名，只要走到「計價完成」
這一步，都必須看到同一組按鈕、同一組必填欄位（實收金額/付款方式/
現金或銀行帳戶/付款人/收款日期/備註）。

唯一的差異只在「計價完成」這一步怎麼算小計（見第七、八、十節），
按鈕跟收款欄位的規格完全相同，統一收斂在本文件，
`docs/ADMINISTRATION_RULES.md` 第十一節保留作為最初定案的行政規則
描述，兩份文件互相參照，不重複定義兩套規則。

---

## 三、付款狀態：7 種狀態與判定規則

V7.0/V7.0.3 定案的 `ReceivableStatus` 只有 4 個值
（`UNPAID`/`PARTIAL`/`PAID`/`REFUND_PENDING`），V7.1 正式擴充為
7 個值，把原本籠統的 `REFUND_PENDING` 拆細，並新增「作廢」概念：

| 狀態值 | 中文 | 意義 |
|---|---|---|
| `UNPAID` | 未繳 | 尚未收到任何款項 |
| `PARTIAL` | 部分繳款 | 已收金額 < 應收金額 |
| `PAID` | 已繳清 | 已收金額 = 應收金額 |
| `OVERPAID_PENDING` | 溢收待處理 | 已收金額 > 應收金額，尚未決定如何處理多收的差額 |
| `REFUND_PENDING` | 退款待處理 | 已決定要退款（不論原因是溢收或報名取消），退款動作尚未執行 |
| `REFUNDED` | 已退款 | 退款款項已經實際付出，並已建立對應的退款 `Payment` |
| `VOIDED` | 已作廢 | 這筆報名/應收整筆作廢（例如重複建立、資料輸入錯誤），不是退款 |

**狀態自動判定規則（沿用 V7.0.3 的計算邏輯，本輪擴充溢收/退款/作廢的
後續流程）**：

- 實收 < 應收 → `PARTIAL`。
- 實收 = 應收 → `PAID`。
- 實收 > 應收 → `OVERPAID_PENDING`（**系統不可以自己吞掉差額**，V7.0.3
  的規則不變，只是把「溢收待處理」獨立成一個更精確的狀態，跟「退款
  待處理」分開，因為溢收不一定要退錢，也可能請信眾多贊助或補登一筆
  項目）。

**允許的狀態轉換（狀態機，供第十六、十七節流程圖使用）**：

```
UNPAID ──收到部分款項──▶ PARTIAL ──收到剩餘款項──▶ PAID
UNPAID/PARTIAL ──單次收款金額使總額超過應收──▶ OVERPAID_PENDING
PAID ──之後又補收一筆（誤收）──▶ OVERPAID_PENDING
OVERPAID_PENDING ──管理者決定退還差額──▶ REFUND_PENDING
OVERPAID_PENDING ──管理者決定補登項目吸收差額（例如信眾多贊助）──▶ PAID
REFUND_PENDING ──退款款項實際付出（建立 isRefund=true 的 Payment）──▶ REFUNDED
UNPAID ──資料輸入錯誤／重複建立，尚未收過任何款項──▶ VOIDED
REFUNDED ──退款完成後整筆確認不需要／作廢──▶ VOIDED
```

**明確禁止的轉換**：`PAID`／`PARTIAL`／`OVERPAID_PENDING` 不可以直接
跳到 `VOIDED`——已經收過的錢一定要先走退款流程（`REFUND_PENDING` →
`REFUNDED`）才能作廢，避免帳上出現「作廢了，但錢還在戶頭裡沒人知道
要退」的漏洞。這一點在第二十四節列為需要在正式開發時用應用邏輯（或
資料庫 trigger）強制檢查的規則。

**`Payment` 需要獨立的 `PaymentStatus`**：因為一筆 `Receivable` 可能
對應多筆 `Payment`（分次繳款、或退款時的沖銷款），`ReceivableStatus`
描述的是整筆應收的彙總狀態，無法標示「這一筆特定收款記錄本身是否被
作廢或已被退款沖銷」。因此新增：

```prisma
enum PaymentStatus {
  ACTIVE   // 正常有效
  VOIDED   // 這筆收款記錄本身輸入錯誤，作廢（不是退款，例如金額打錯字直接整筆刪除意義上的作廢）
  REFUNDED // 這筆收款已經有對應的退款 Payment 沖銷
}
```

`Payment.status` 預設 `ACTIVE`，作廢/退款時的變更沿用
`LedgerEntry` 既有的 `voidedById`/`voidedAt`/`voidReason` 模式
（見第四節）。

---

## 四、`Payment` 完整欄位定案

V7.0.3 的 `Payment` 只有 `financialAccountId`/`payerName` 兩個新增
欄位，V7.1 依你的需求正式擴充為完整版本：

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | String | 主鍵 |
| `paymentDate` | DateTime（Date） | 收款日期（正式改名，V7.0.3 稱 `paidOn`，語意相同，這裡統一成需求文字使用的 `paymentDate`） |
| `amount` | Decimal(12,2) | 實收金額 |
| `paymentMethod` | `PaymentMethod` enum | 付款方式，見下方 |
| `financialAccountId` | String（必填） | 收款帳戶，V7.0.3 已定案 |
| `payerNameSnapshot` | String? | 付款人姓名快照，**正式改名自 V7.0.3 的 `payerName`**（改名原因見第五節） |
| `payerMemberId` | String?（nullable 關聯 `Member`） | 如果付款人是系統裡已知的成員，記錄關聯；未知/臨時輸入則為 null |
| `payerHouseholdId` | String?（nullable 關聯 `Household`） | 如果付款人所屬家戶已知，記錄關聯；未知則為 null |
| `registrationGroupId` | String（冗餘存放） | 直接冗餘存放所屬報名群組，避免每次查詢都要多一層 `Receivable` join（沿用 V6.4 `RegistrationItem.activityType`/`year` 冗餘存放的先例） |
| `receivableId` | String?（**V7.1 改為 nullable**） | 所屬應收；快速收款情境下可能暫時為 null，見第十二節 |
| `quickCollectionEntryId` | String?（nullable，`@@unique`） | 如果這筆 `Payment` 源自快速收款，指向對應的 `QuickCollectionEntry`，見第十二節 |
| `isRefund` | Boolean | 沿用 V7.0，是否為退款動作 |
| `notes` | String? | 備註 |
| `status` | `PaymentStatus` enum | 見第三節，預設 `ACTIVE` |
| `voidedById` / `voidedAt` / `voidReason` | 選填 | 作廢/退款沖銷時的追蹤欄位，比照 `LedgerEntry` 既有模式 |
| `createdById` | String（關聯 `User`） | 建立者，比照 `LedgerEntry` 既有的 `createdById` |
| `createdAt` | DateTime | 建立時間 |

**資料完整性規則（第二十四節列為正式開發需要強制檢查的不變量）**：

- `receivableId` 與 `quickCollectionEntryId` **兩者必須恰好有一個非
  null**（正常收款走 `receivableId`；快速收款尚未連結時走
  `quickCollectionEntryId`；快速收款連結完成後 `receivableId` 補上，
  但 `quickCollectionEntryId` 保留作為追溯來源，兩者屆時會同時非
  null，屬於例外允許的情況——規則精確描述見第十二節）。
- `payerNameSnapshot` 一旦寫入就是歷史快照，**之後修改
  `Member`/`Household` 的姓名，不會回頭更動已建立的 `Payment` 紀錄**
  （見第五節）。

付款方式 `PaymentMethod` 擴充為：

```prisma
enum PaymentMethod {
  CASH             // 現金
  BANK_TRANSFER    // 匯款（銀行臨櫃／跨行匯款)
  ACCOUNT_TRANSFER // 轉帳（網路銀行/ATM 轉帳)
  LINE_PAY         // 保留欄位：本輪只保留 enum 值，行政系統畫面預設不開放選擇，
                   // 需要之後管理者另外啟用才會出現在付款方式選單，本輪不開發
                   // 啟用開關的 UI
  OTHER            // 其他
}
```

---

## 五、功德主（贊助人）與付款人分開

三玄宮的實務情境是：**功德主（報名/贊助這件事的人，名字會被記錄、被
唱名、可能上功德榜）不一定是實際掏錢付款的人**。例如林媽媽幫過世的
先生報名年度燈當功德主，但錢是林媽媽的女兒臨櫃代繳的；或是某位信眾
一次幫好幾位親友報名，親友各自的名字才是功德主，但錢統一由代辦人
一次繳清。

**規則定案**：

1. **功德主**：`RegistrationItem.displayName`（或全家燈情境下
   `FamilyLampMember.displayName`，見第八節）——這是報名要對外顯示、
   要被唱名/列入功德榜的名字，V6.4 已定案，本輪不變。
2. **付款人**：`Payment.payerNameSnapshot`（可為 `payerMemberId`/
   `payerHouseholdId` 連回系統既有資料，也可以只是自由輸入的文字）——
   這是「這筆錢實際上是誰拿出來的」，V7.0.3 已定案為選填欄位，本輪
   正式規則是：**付款人欄位可以留白，留白時系統預設視為「與功德主
   同一人」**，畫面上收款完成後顯示付款人時，若欄位為空就直接顯示
   功德主/報名代辦人姓名，不需要行政人員多打一次重複的名字。
3. **正式改名 `payerName` → `payerNameSnapshot` 的原因**：「Snapshot
   （快照）」明確表達這欄位記錄的是**收款當下的姓名文字**，不是即時
   連回 `Member`/`Household` 動態顯示的姓名。這是因為：**日後如果
   信眾更新了自己在系統裡的正式姓名（例如更正錯字、或家戶資料整併），
   已經發生過的歷史收款紀錄上的付款人姓名不應該跟著變動**——收據、
   對帳紀錄要能反映「收款當下真實記錄的樣子」，不能因為之後改名而
   讓歷史交易紀錄的顯示內容跟著改變。`payerMemberId`/
   `payerHouseholdId` 只是「這筆快照對應到系統裡哪一筆資料」的參照
   連結，用於之後查詢/統計，**不用於顯示付款人姓名**——顯示一律用
   `payerNameSnapshot`。

**V7.2 新增情境**：「代收人」（例如代辦人幫忙先收了款項、還沒交回
宮方）正是這裡的「付款人」角色的一種延伸應用——差別在於代收情境下
錢還沒有真正到宮方手上，所以不會直接建立 `Payment`，而是先建立
`AgentRemittance` 追蹤紀錄，等管理者確認繳回後，才用代收人的姓名
建立正式 `Payment.payerNameSnapshot`。完整規則見
`docs/AGENT_REMITTANCE.md`。

---

## 六、收款中心搜尋規格

收款中心首頁提供單一搜尋框 + 篩選條件，查詢範圍橫跨全部七個活動：

**可搜尋欄位**：姓名（功德主/報名人）、家戶、贊助人、付款人、電話、
地址、活動別、年度、狀態（第三節 7 種狀態任選）。

**搜尋結果每筆列出**：

- 贊助人（功德主）
- 付款人（若與贊助人不同才額外顯示，相同時只顯示一次並標註「同贊助人」）
- 活動別
- 年度
- 應收金額
- 已收金額
- 未收金額（= 應收 − 已收 + 已退款，沿用 `Receivable.unreceivedAmount`
  既有算法）
- 狀態（7 種狀態，以第十三節的色彩系統顯示狀態標籤）
- 最後收款日期
- 備註

點擊任一筆結果，可以展開該筆報名的完整明細（見第七節多人代辦情境）
或直接進入【立即收款】/【補收款】操作畫面。

搜尋邏輯上等於是對 `RegistrationGroup` + `Receivable` + `Payment`
三張表做關聯查詢，**不需要新增一張「搜尋索引表」**，效能問題（例如
姓名要能模糊比對）留待正式開發 API 時再決定是否需要額外索引，本輪
只定規格。

---

## 七、一人代辦一大群人（多人小計顯示）

V6.2/普渡既有的「代辦人模式」讓一位代辦人底下可以有很多個
`RegistrationItem`（不同家戶、不同人名）。行政人員常見的問題是
「她幫忙報的這一整批，全部加起來多少錢？」——收款中心必須清楚回答：

**`RegistrationGroup` 展開畫面必須顯示**：

- 這個代辦群組總共幾筆明細（`RegistrationItem` 筆數）
- 每一筆明細：姓名、單價、數量、小計
- 群組總計：應收總額、已收總額、未收總額（直接對應
  `Receivable.totalAmount`/`paidAmount`/`unreceivedAmount`，V7.0 已
  定案的欄位，本輪不新增計算邏輯，只定案「一定要在畫面上完整列出
  每一筆明細＋總計」這個顯示規則）

這個顯示規則同時適用於：普渡代辦人多戶報名、全家燈整組報名（第八
節）、南北巡車次報名（第十節，此時「明細」是車次/房間/海報認捐，
不是逐人名單）。

---

## 八、年度燈／祭改：個人計價 vs 全家燈計價（`FamilyLampGroup` 新模型）

年度燈（光明燈/太歲燈）與祭改目前是**逐人計價**：每個名字一筆
`RegistrationItem`，單價 × 1 = 小計，多個人就是多筆明細加總。這個
邏輯繼續沿用，不變。

**新概念「全家燈」**：信眾希望**整戶（甚至跨戶的多位親屬）合報一組
燈，用一個固定的整組價格，不因為報名人數多寡而乘倍**——例如「全家燈
一組 3,000 元，不論家裡報 3 個人還是 8 個人都是這個價錢」。這跟逐人
計價是不同的計價邏輯，需要新模型，而不是硬把 `RegistrationItem` 的
`quantity`/`actualUnitPrice` 拿來湊：

```prisma
/// V7.1 新增：全家燈/全家祭改整組計價的名單容器。
/// 本模型本身完全不參與財務計算——它只負責記錄「這一組整組計價的
/// 燈裡面，包含哪些名字」，供列印/對外顯示/查詢使用。
/// 真正的財務金額仍然只有一筆 RegistrationItem（見下方說明），
/// 不會因為這個模型的存在而讓 Receivable/Payment 的計算邏輯複雜化。
model FamilyLampGroup {
  id                  String            @id @default(cuid())
  registrationGroupId String
  registrationGroup   RegistrationGroup @relation(fields: [registrationGroupId], references: [id], onDelete: Cascade)

  /// 主要掛靠家戶（通常是發起報名的那一戶），可為 null（例如代辦人
  /// 幫沒有建檔的親友發起，尚未有正式 Household 資料）
  primaryHouseholdId String?
  primaryHousehold   Household? @relation(fields: [primaryHouseholdId], references: [id])

  year         Int
  activityType ActivityType // 限定 LANTERN 或 ZODIAC，應用層驗證
  lampType     String       // 例如「全家燈」「全家太歲燈」，對應 ActivityPrice.itemKey
  flatUnitPrice Decimal     @db.Decimal(12, 2) // 整組固定價格，不隨人數變動

  notes String? @db.Text

  members FamilyLampMember[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([registrationGroupId])
  @@index([year, activityType])
  @@map("family_lamp_groups")
}

/// V7.1 新增：全家燈名單裡的單一姓名，可以跨家戶（例如把已出嫁的女兒
/// 也算進娘家的全家燈名單）。
model FamilyLampMember {
  id                String          @id @default(cuid())
  familyLampGroupId String
  familyLampGroup   FamilyLampGroup @relation(fields: [familyLampGroupId], references: [id], onDelete: Cascade)

  /// 姓名可以連回已知的 Member，也可以是臨時輸入的名字
  /// （比照 V6.4 RegistrationItem.isTemporaryName 的精神）
  memberId       String?
  member         Member? @relation(fields: [memberId], references: [id])
  householdId    String? // 這個名字所屬的家戶（可能跟 primaryHousehold 不同）
  household      Household? @relation(fields: [householdId], references: [id])
  displayName    String  // 顯示/列印用的姓名，臨時姓名時尤其必要
  isTemporaryName Boolean @default(false)

  sortOrder Int @default(0)

  createdAt DateTime @default(now())

  @@index([familyLampGroupId])
  @@map("family_lamp_members")
}
```

**財務計算方式（重點：不改變既有 `RegistrationItem`/`Receivable`
邏輯）**：一組全家燈只產生**一筆** `RegistrationItem`
（`chargeItemKey = "FAMILY_LAMP"` 或對應的 `itemKey`，`quantity = 1`，
`actualUnitPrice = subtotal = FamilyLampGroup.flatUnitPrice`），並在
`RegistrationItem` 新增一個 nullable 欄位 `familyLampGroupId` 指向
這組 `FamilyLampGroup`，讓「這筆明細背後有完整名單」可以被查到。
`Receivable`/`Payment`/`LedgerEntry` 完全不需要知道全家燈這個概念的
存在——對它們來說，這就是普通的一筆 `RegistrationItem` 小計。

**收款中心顯示規則**：搜尋結果/展開畫面看到全家燈這筆明細時，額外
顯示「查看名單（N 位）」，點開才展開 `FamilyLampMember` 清單，預設
搜尋結果列表不用把每個名字都列出來（避免全家燈的一筆資料在列表上
看起來比逐人計價的燈占用更多畫面）。

---

## 九、普渡收款（收款中心情境下的規則重申）

普渡的內部祭祀四類別（歷代祖先／個人乙位正魂／冤親債主／無緣子女）
與贊普／白米的收款規則，**V6.3 ADR-0007、V6.4 已經定案，本輪不重新
設計**，只在收款中心的情境下重申：

- 對外收款畫面（含收款中心的搜尋結果、收據）**只顯示贊助人姓名 +
  普渡總額**，隱藏全部四個內部類別名稱，這條規則對收款中心一體適用，
  不會因為是在收款中心查詢就破例顯示內部類別。
- **贊普**：`ActivityPrice` 提供參考價（目前約 800 元／份），但行政
  人員可以在報名時調整實際金額（沿用 `RegistrationItem.actualUnitPrice`
  可以不等於 `standardUnitPrice` 的既有機制，`priceAdjustedReason`
  記錄調整原因，V7.0 已定案，本輪不變）。
- **白米**：全部手動輸入金額（沒有固定參考價），一樣走
  `RegistrationItem`，`standardUnitPrice` 可為 null。

---

## 十、南巡與北巡：以車次為主要財務單位

沿用 V6.2/V7.0 既有設計（`TourVehicle`/`TourRoomCharge`），本輪**不
重新設計**，收款中心的呈現規則正式定案（對應第十九節流程圖、
`docs/ADR.md` ADR-0015）：

- 預設顯示車次 1、3、5、6、7、8、9；車次 2、4 預設隱藏，管理者可以
  另外啟用（沿用既有規則，本輪不變）。
- 每個車次：單價 × 報名人數 = 小計；雙人房加價另計一筆；海報認捐是
  手動輸入金額（不是單價 × 數量算出來的）。
- 全部小計自動加總成這個車次/這次南巡（或北巡）的應收總額。
- **收款中心只呈現「以車次為單位」的財務彙總，不提供逐人收據**——
  這是本輪明確定案、寫入 ADR-0015 的規則：南北巡的錢是跟著車次/
  房間走的，不是跟著單一報名人走的，行政人員查詢時看到的是「第 3 車
  應收多少、收了多少」，不是「王小姐這趟南巡繳了多少」（王小姐的
  明細仍然存在於 `RegistrationItem`，只是收款中心的**呈現層**不把它
  當作可以單獨收款/退款的財務單位）。

---

## 十一、流水帳與帳戶規則（重申 + 收款中心情境）

沿用 V7.0 已定案規則，本輪不新增計算邏輯，只重申三條在收款中心情境
下特別容易被誤用的規則：

1. **只有 `Payment` 才能建立 `LedgerEntry`**——收款中心任何「查詢/
   搜尋/展開明細」的操作都不涉及建立流水，只有實際按下【立即收款】/
   【補收款】/【退款】才會建立。
2. **`LedgerEntry` 必填欄位**：`type`（收入/支出）、`amount`、
   `occurredOn`、`financialAccountId`、`paymentId`（`@@unique`，
   V7.0 已定案），收款中心新增的快速收款情境（第十二節）**同樣要滿足
   這個必填規則，不允許例外**。
3. **`FinancialAccount` 必須能顯示**：期初餘額、本期收入、本期支出、
   目前餘額——這四個數字全部由 `LedgerEntry` 自動彙總計算，
   `Receivable` 的任何狀態變化（包含本輪新增的 `OVERPAID_PENDING`/
   `REFUND_PENDING`/`VOIDED`）**都不得直接影響這四個數字**，唯一
   能影響的是實際建立/作廢 `LedgerEntry`。

---

## 十二、快速收款（`QuickCollectionEntry` 新模型）

**情境**：信眾臨櫃直接拿錢出來，但當下報名資料還沒建好（可能還在
排隊、資料需要跟其他家人核對、或行政人員忙不過來先收錢再說）。系統
必須支援「先把錢收下來、入帳」，之後再回頭把這筆錢跟正式報名資料
兜起來。

**核心限制（你的明確要求）**：不可以因為資料不完整就形成一筆查無
來源、追不回去的孤立流水帳（`LedgerEntry`）。

**設計**：

```prisma
enum QuickCollectionStatus {
  PENDING_LINK // 已收款，尚未連結到正式報名
  LINKED       // 已連結到正式 RegistrationGroup/Receivable
  VOIDED       // 這筆快速收款作廢（例如收錯、信眾臨時不報名了，需搭配退款流程）
}

/// V7.1 新增：快速收款的暫存/可追溯來源。
/// 快速收款當下就會建立一筆真正的 Payment（錢確實入帳、確實產生
/// LedgerEntry），只是這筆 Payment 暫時沒有 receivableId，改用
/// quickCollectionEntryId 追溯來源，避免「先收錢、後補資料」這件事
/// 破壞「一筆 Payment 對應一筆 LedgerEntry」或憑空生出流水帳的規則。
model QuickCollectionEntry {
  id                     String                @id @default(cuid())
  receivedAmount         Decimal               @db.Decimal(12, 2)
  paymentMethod          PaymentMethod
  financialAccountId     String
  financialAccount       FinancialAccount      @relation(fields: [financialAccountId], references: [id])
  payerNameSnapshot       String               // 收錢當下記錄的付款人姓名（可能連正式姓名都還沒問清楚，先記大概）
  roughDescription       String?  @db.Text      // 概略描述，例如「說要報年度燈，資料還沒給」
  status                 QuickCollectionStatus @default(PENDING_LINK)

  linkedRegistrationGroupId String?
  linkedRegistrationGroup   RegistrationGroup? @relation(fields: [linkedRegistrationGroupId], references: [id])
  linkedAt                  DateTime?

  payment Payment? // 1:1，收款當下建立的那一筆 Payment

  createdById String
  createdAt   DateTime @default(now())

  @@index([status])
  @@map("quick_collection_entries")
}
```

**流程規則（見第十五節流程圖）**：

1. 快速收款當下，系統建立一筆 `QuickCollectionEntry`
   （`status = PENDING_LINK`）**與**一筆 `Payment`
   （`receivableId = null`、`quickCollectionEntryId` 指向這筆
   `QuickCollectionEntry`），並依照正常規則建立對應的
   `LedgerEntry`、更新 `FinancialAccount` 餘額——**錢當天就正確入
   帳，不用等資料補齊**。
2. 之後行政人員補齊正式報名資料、建立正式的
   `RegistrationGroup`/`RegistrationItem`/`Receivable` 後，執行
   「連結」動作：把該筆 `Payment.receivableId` 補上（指向新建立的
   `Receivable`），`QuickCollectionEntry.status` 改為 `LINKED`，
   `linkedRegistrationGroupId`/`linkedAt` 填入。**`LedgerEntry` 完全
   不動**——它從一開始就是正確、完整、可追溯的一筆紀錄，連結動作只是
   幫 `Payment` 補上原本缺的關聯，不是重新記帳。
3. `Receivable.status` 在連結完成後，依照第三節規則自動判定
   （這筆補齊資料當下已經有一筆 `Payment`，等於是「報名 + 已經收過
   一筆款項」的情境，狀態計算邏輯與一般收款完全相同）。
4. 若快速收款最後確認是誤收（信眾臨時不報名、或收錯金額），走退款
   流程（`Payment` 建立對應的 `isRefund=true` 沖銷紀錄，
   `QuickCollectionEntry.status` 改為 `VOIDED`），**不會直接刪除
   原始 `Payment`/`LedgerEntry`**，維持「帳一旦入了就只能用沖銷/退款
   更正，不能直接刪除」的既有原則（比照 `LedgerEntry` 既有的
   voidedById/voidedAt/voidReason 作廢機制，不是真的從資料庫刪除
   資料列）。

**資料完整性不變量（正式寫入第二十四節，供正式開發時強制檢查）**：
`Payment.receivableId` 與 `Payment.quickCollectionEntryId` 至少要有
一個非 null；已連結（`LINKED`）的快速收款，兩者會同時非 null（保留
`quickCollectionEntryId` 作為「這筆錢原本是快速收款」的歷史紀錄，
不因為連結完成就清空）。

---

## 十三、低保真 Wireframe 說明

已建立單一自足 HTML 檔案 `collection_center_wireframe.html`（隨附
ZIP 內，亦另外單獨交付），包含 8 個畫面的低保真線框稿：

1. 收款中心首頁（搜尋框 + 快速篩選 + 待處理提醒卡片）
2. 搜尋結果／未繳清單畫面
3. 報名完成計價後的兩按鈕畫面（【先存為未繳】／【立即收款】）
4. 部分付款／補收款畫面
5. 一人代辦多人：群組明細與總計畫面
6. 普渡對外收款畫面（只顯示贊助人 + 總額）
7. 南巡／北巡車次財務彙總畫面
8. 快速收款輸入畫面

**色彩系統（依你的明確指定）**：

| 用途 | 色彩 | 說明 |
|---|---|---|
| 背景 | 暖白 | 大面積底色，不是純白 |
| 主色 | 淡奶油黃 | 主要按鈕/強調區塊 |
| 輔色 1 | 淡杏色 | 次要強調 |
| 輔色 2 | 淡菊黃 | 分類標籤 |
| 完成狀態 | 鼠尾草綠 | `PAID`/`REFUNDED` 等完成類狀態標籤 |
| 提示/資訊狀態 | 淡湖水藍 | `PARTIAL`/一般提示訊息 |
| 未繳/提醒狀態 | 灰粉玫瑰色 | `UNPAID`/`OVERPAID_PENDING`/`REFUND_PENDING` 等待處理類狀態標籤 |

整體風格明亮、乾淨、低飽和，**不使用大面積純黑/純白、不使用高飽和
紅色或金色**，不做成傳統宮廟/傳統 ERP 常見的深色莊嚴風格，延續專案
一貫的 Apple 風格／日系簡約／莫蘭迪色系方向。這份 Wireframe 是**畫面
結構與資訊層級的示意**，不是最終視覺稿，正式 UI 開發時仍會依照
`docs/FINANCE_AND_ACTIVITY_SPEC.md`/Claude Project 指示的設計原則
細修。

---

## 十四、ER Diagram（完整版，含新模型）

```
RegistrationGroup ──1:1── Receivable
      │                       │  totalAmount/paidAmount/refundAmount/
      │                       │  unreceivedAmount/status（7 值，見三節）
      │                       │
      │                       └──1───N Payment
      │                                  │  paymentDate/amount/paymentMethod/
      │                                  │  financialAccountId/payerNameSnapshot/
      │                                  │  payerMemberId/payerHouseholdId/
      │                                  │  registrationGroupId（冗餘）/
      │                                  │  receivableId（★V7.1 改為 nullable）/
      │                                  │  quickCollectionEntryId（★V7.1 新增）/
      │                                  │  status（PaymentStatus，見三節）
      │                                  │
      │                                  ├──N:1── FinancialAccount
      │                                  ├──N:1（可選）── Member（payerMemberId）
      │                                  ├──N:1（可選）── Household（payerHouseholdId）
      │                                  ├──1:1（可選）── QuickCollectionEntry（★V7.1 新增）
      │                                  └──1:1── LedgerEntry（永遠成立，不因快速收款而破例）
      │
      ├──1───N RegistrationItem
      │            │  ★V7.1 新增 nullable familyLampGroupId
      │            └──N:1（可選）── FamilyLampGroup（★V7.1 新增）
      │                                   │
      │                                   └──1───N FamilyLampMember（★V7.1 新增）
      │                                                │
      │                                                ├──N:1（可選）── Member
      │                                                └──N:1（可選）── Household
      │
      └──N:1── ActivityYear（V7.0.2 年度活動引擎，不變）

QuickCollectionEntry（★V7.1 新增，獨立於 RegistrationGroup 之外，
   直到連結完成前不屬於任何報名）
      │
      ├──N:1── FinancialAccount
      ├──0/1:1── Payment（收款當下立即建立）
      └──0/1:N:1（連結後）── RegistrationGroup（linkedRegistrationGroupId）
```

（`Household`／`Member`／`ActivityPrice`／`ActivitySummary` 等既有
關聯沿用 `docs/FINANCE_CORE_SCHEMA.md` 第二節既有 ER Diagram，此處
只標示 V7.1 新增/變更的部分，避免重複整份既有圖。）

---

## 十五、收款資料流程圖

```
行政人員在收款中心操作
        │
        ├─(A) 已有正式報名，補收款/立即收款
        │        │
        │        ▼
        │   查到 RegistrationGroup → Receivable
        │        │
        │        ▼
        │   建立 Payment（receivableId 指向該 Receivable）
        │        │
        │        ▼
        │   自動建立 LedgerEntry，更新 FinancialAccount 餘額
        │        │
        │        ▼
        │   依第三節規則重新計算 Receivable.status
        │
        └─(B) 尚無正式報名，快速收款
                 │
                 ▼
            建立 QuickCollectionEntry（status=PENDING_LINK）
                 │
                 ▼
            建立 Payment（receivableId=null，quickCollectionEntryId 指向上面那筆）
                 │
                 ▼
            自動建立 LedgerEntry，更新 FinancialAccount 餘額
                 │
                 ▼
            （之後）行政人員補齊正式報名資料
                 │
                 ▼
            建立 RegistrationGroup/RegistrationItem/Receivable
                 │
                 ▼
            執行「連結」：Payment.receivableId 補上，
            QuickCollectionEntry.status → LINKED
                 │
                 ▼
            依第三節規則計算 Receivable.status（此時已有一筆 Payment）
```

---

## 十六、報名當下立即付款流程圖（跨活動通用版）

```
報名畫面完成計價（不論年度燈個人/全家燈/普渡代辦/南北巡車次）
        │
        ▼
   顯示【先存為未繳】／【立即收款】
        │
        ├─【先存為未繳】
        │        │
        │        ▼
        │   建立 RegistrationGroup → RegistrationItem(s) → Receivable
        │   （status = UNPAID，不建立 Payment）
        │
        └─【立即收款】
                 │
                 ▼
            建立 RegistrationGroup → RegistrationItem(s) → Receivable
                 │
                 ▼
            同一步：填寫實收金額/付款方式/收款帳戶/付款人/收款日期/備註
                 │
                 ▼
            建立 Payment（receivableId 指向剛建立的 Receivable）
                 │
                 ▼
            自動建立 LedgerEntry，更新 FinancialAccount 餘額
                 │
                 ▼
            依第三節規則計算 Receivable.status
            （實收<應收→PARTIAL；=→PAID；>→OVERPAID_PENDING）
```

（此圖是 V7.0.3 4.5 節流程圖的跨活動通用化版本，底層邏輯完全相同，
只是本輪明確這是七個活動共用的同一套流程，不是年度燈專屬。）

---

## 十七、部分付款與退款流程圖

```
Receivable（狀態 UNPAID 或 PARTIAL）
        │
        ▼
   行政人員在收款中心補收一筆款項
        │
        ▼
   建立新的 Payment（receivableId 指向同一個 Receivable）
        │
        ▼
   累加 Receivable.paidAmount，重新比較 vs totalAmount
        │
        ├─ 仍 < totalAmount → PARTIAL（維持或從 UNPAID 轉入）
        ├─ = totalAmount → PAID
        └─ > totalAmount → OVERPAID_PENDING
                 │
                 ├─ 管理者決定退還差額
                 │        │
                 │        ▼
                 │   Receivable.status → REFUND_PENDING
                 │        │
                 │        ▼
                 │   建立退款 Payment（isRefund=true，金額為負或標記退款方向，
                 │   實作時定案；同步建立 LedgerEntry 沖銷、更新帳戶餘額；
                 │   原收款 Payment.status → REFUNDED）
                 │        │
                 │        ▼
                 │   Receivable.status → REFUNDED
                 │
                 └─ 管理者決定用補登項目吸收差額（例如信眾同意多贊助）
                          │
                          ▼
                     新增/調整 RegistrationItem，Receivable.totalAmount 隨之提高
                          │
                          ▼
                     Receivable.status → PAID
```

---

## 十八、多人代辦計價流程圖

```
代辦人建立 RegistrationGroup（agentDisplayName = 代辦人姓名）
        │
        ▼
   逐筆加入 RegistrationItem（可跨不同 Household/Member，
   或 isTemporaryName=true 的臨時姓名）
        │
        ▼
   每筆 RegistrationItem：actualUnitPrice × quantity = subtotal
        │
        ▼
   全部 RegistrationItem.subtotal 加總 → Receivable.totalAmount
        │
        ▼
   收款中心「群組展開」畫面：
   逐筆顯示（姓名/單價/數量/小計）+ 群組總計（應收/已收/未收）
```

（全家燈情境的差異只在其中一筆或多筆 `RegistrationItem` 是
`familyLampGroupId` 非 null 的整組固定價格項目，其餘流程完全相同，
見第八節。）

---

## 十九、南北巡車次統計流程圖

```
南巡/北巡報名建立 RegistrationGroup（每一梯次一組，或依既有設計調整）
        │
        ▼
   依車次分別建立 RegistrationItem：
   - 車次單價 × 報名人數 = 小計
   - 雙人房加價 → 另一筆 RegistrationItem
   - 海報認捐 → 手動輸入金額的一筆 RegistrationItem
        │
        ▼
   全部小計加總 → Receivable.totalAmount
        │
        ▼
   收款中心「車次財務彙總」畫面：
   以車次（1,3,5,6,7,8,9 預設顯示，2,4 需管理者啟用）為單位分組顯示，
   每個車次：應收/已收/未收小計
   （不提供逐人收據，只有車次層級的彙總畫面，見第十節）
```

---

## 二十、建議 Prisma Schema（完整程式碼區塊）

以下整合本文件第三～十二節所有新增/擴充的 Prisma 定義，**本輪僅為
建議提案，不套用到 `prisma/schema.prisma`，不建立 migration**：

```prisma
// ============================================================
// V7.1 收款中心 — 狀態擴充
// ============================================================

enum ReceivableStatus {
  UNPAID            // 未繳
  PARTIAL           // 部分繳款
  PAID              // 已繳清
  OVERPAID_PENDING  // 溢收待處理
  REFUND_PENDING    // 退款待處理
  REFUNDED          // 已退款
  VOIDED            // 已作廢
}

enum PaymentStatus {
  ACTIVE
  VOIDED
  REFUNDED
}

enum PaymentMethod {
  CASH
  BANK_TRANSFER
  ACCOUNT_TRANSFER
  LINE_PAY // 保留，本輪不在 UI 預設啟用
  OTHER
}

// ============================================================
// V7.1 收款中心 — Payment 擴充版
// ============================================================

model Payment {
  id          String   @id @default(cuid())
  paymentDate DateTime @db.Date
  amount      Decimal  @db.Decimal(12, 2)

  paymentMethod      PaymentMethod
  financialAccountId String
  financialAccount   FinancialAccount @relation(fields: [financialAccountId], references: [id])

  payerNameSnapshot String
  payerMemberId     String?
  payerMember       Member?    @relation(fields: [payerMemberId], references: [id])
  payerHouseholdId  String?
  payerHousehold    Household? @relation(fields: [payerHouseholdId], references: [id])

  registrationGroupId String // 冗餘存放，比照 RegistrationItem.activityType/year 的先例
  registrationGroup   RegistrationGroup @relation(fields: [registrationGroupId], references: [id])

  receivableId String? // ★V7.1：改為 nullable，支援快速收款情境
  receivable   Receivable? @relation(fields: [receivableId], references: [id])

  quickCollectionEntryId String? @unique // ★V7.1 新增
  quickCollectionEntry   QuickCollectionEntry? @relation(fields: [quickCollectionEntryId], references: [id])

  isRefund Boolean @default(false)
  status   PaymentStatus @default(ACTIVE)

  voidedById String?
  voidedAt   DateTime?
  voidReason String? @db.Text

  notes String? @db.Text

  ledgerEntry LedgerEntry?

  createdById String
  createdAt   DateTime @default(now())

  @@index([financialAccountId])
  @@index([registrationGroupId])
  @@index([receivableId])
  @@map("payments")
}

// ============================================================
// V7.1 新增 — 全家燈整組計價
// ============================================================

model FamilyLampGroup {
  id                  String            @id @default(cuid())
  registrationGroupId String
  registrationGroup   RegistrationGroup @relation(fields: [registrationGroupId], references: [id], onDelete: Cascade)

  primaryHouseholdId String?
  primaryHousehold   Household? @relation(fields: [primaryHouseholdId], references: [id])

  year          Int
  activityType  ActivityType
  lampType      String
  flatUnitPrice Decimal @db.Decimal(12, 2)

  notes String? @db.Text

  members FamilyLampMember[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([registrationGroupId])
  @@index([year, activityType])
  @@map("family_lamp_groups")
}

model FamilyLampMember {
  id                String          @id @default(cuid())
  familyLampGroupId String
  familyLampGroup   FamilyLampGroup @relation(fields: [familyLampGroupId], references: [id], onDelete: Cascade)

  memberId        String?
  member          Member? @relation(fields: [memberId], references: [id])
  householdId     String?
  household       Household? @relation(fields: [householdId], references: [id])
  displayName     String
  isTemporaryName Boolean @default(false)

  sortOrder Int @default(0)

  createdAt DateTime @default(now())

  @@index([familyLampGroupId])
  @@map("family_lamp_members")
}

// ============================================================
// V7.1 新增 — 快速收款
// ============================================================

enum QuickCollectionStatus {
  PENDING_LINK
  LINKED
  VOIDED
}

model QuickCollectionEntry {
  id                 String                @id @default(cuid())
  receivedAmount     Decimal               @db.Decimal(12, 2)
  paymentMethod      PaymentMethod
  financialAccountId String
  financialAccount   FinancialAccount      @relation(fields: [financialAccountId], references: [id])
  payerNameSnapshot  String
  roughDescription   String?               @db.Text
  status             QuickCollectionStatus @default(PENDING_LINK)

  linkedRegistrationGroupId String?
  linkedRegistrationGroup   RegistrationGroup? @relation(fields: [linkedRegistrationGroupId], references: [id])
  linkedAt                  DateTime?

  payment Payment?

  createdById String
  createdAt   DateTime @default(now())

  @@index([status])
  @@map("quick_collection_entries")
}

// ============================================================
// RegistrationItem — 新增 nullable 欄位（沿用既有 model，僅增列欄位）
// ============================================================
// model RegistrationItem { ... 既有欄位不變 ...
//   familyLampGroupId String?
//   familyLampGroup   FamilyLampGroup? @relation(fields: [familyLampGroupId], references: [id])
// }
```

---

## 二十一、哪些資料可以沿用／哪些要新增

**完全沿用，本輪不變**：`ActivityYear`/`ActivityPrice`/
`RegistrationGroup`/`RegistrationItem`（僅新增一個 nullable 欄位）/
`FinancialAccount`/`LedgerEntry`/`ActivitySummary`/`TourVehicle`/
`TourRoomCharge`/`TaiSuiYearZodiac`。

**擴充既有模型**：
- `Receivable.status`：`ReceivableStatus` 由 4 值擴充為 7 值。
- `Payment`：新增 `registrationGroupId`/`quickCollectionEntryId`/
  `status`/`voidedById`/`voidedAt`/`voidReason`/`createdById`，
  `payerName` 正式改名 `payerNameSnapshot`，新增
  `payerMemberId`/`payerHouseholdId`，`receivableId` 改為 nullable，
  `paidOn` 正式改名 `paymentDate`。
- `PaymentMethod`：新增 `ACCOUNT_TRANSFER`/`LINE_PAY`（保留）。
- `RegistrationItem`：新增 nullable `familyLampGroupId`。

**全新模型**：`FamilyLampGroup`、`FamilyLampMember`、
`QuickCollectionEntry`、`PaymentStatus` enum、
`QuickCollectionStatus` enum。

---

## 二十二、Migration 計畫（本輪不執行）

僅記錄未來實際套用時的建議步驟，**本輪完全不執行**：

1. 新增 enum：`PaymentStatus`、`QuickCollectionStatus`；擴充
   `ReceivableStatus`、`PaymentMethod` 的值。
2. 新增資料表：`family_lamp_groups`、`family_lamp_members`、
   `quick_collection_entries`。
3. `payments` 資料表變更：新增欄位（`registration_group_id`／
   `payer_member_id`／`payer_household_id`／
   `quick_collection_entry_id`／`status`／`voided_by_id`／
   `voided_at`／`void_reason`／`created_by_id`），欄位改名
   （`payer_name`→`payer_name_snapshot`，`paid_on`→`payment_date`），
   `receivable_id` 由 NOT NULL 改為 nullable（**這一步在既有資料庫
   有既存資料時需要特別注意：改成 nullable 本身安全，但需要先確認
   沒有任何應用邏輯假設這個欄位一定非 null**）。
4. `registration_items` 資料表新增欄位：`family_lamp_group_id`
   （nullable）。
5. 既有資料回填：所有既有 `payments` 資料列的
   `registration_group_id` 需要從關聯的 `receivable.registrationGroupId`
   回填（因為是新增的冗餘欄位），`payer_name_snapshot` 直接複製既有
   `payer_name` 的值，`payment_date` 直接複製既有 `paid_on` 的值。
6. 應用層新增資料完整性檢查：`payments.receivable_id` 與
   `payments.quick_collection_entry_id` 至少一個非 null（建議：資料庫
   `CHECK` 約束或應用層 transaction 內驗證，兩者擇一，正式開發時
   決定）。

---

## 二十三、開發順序

建議順序（供未來正式進入實作階段參考，本輪不開發）：

1. `ReceivableStatus`/`PaymentStatus`/`PaymentMethod` 等 enum 擴充。
2. `Payment` 欄位擴充與改名（含資料回填腳本）。
3. 收款中心搜尋 API（讀取為主，風險最低，可以最早開始）。
4. 報名完成兩按鈕的跨活動通用 API（立即收款/先存未繳）。
5. `FamilyLampGroup`/`FamilyLampMember`（年度燈/祭改模組需要用到）。
6. `QuickCollectionEntry`（獨立情境，可以跟其他項目平行開發）。
7. 部分付款/溢收/退款/作廢的狀態機（風險最高，建議最後做，且需要
   完整測試涵蓋第三節列出的每一種狀態轉換）。
8. 南北巡車次財務彙總畫面（沿用既有 `TourVehicle` 資料，只是新增
   彙總呈現層）。

---

## 二十四、風險與尚待確認事項

1. **`Payment.receivableId` 改為 nullable 的資料庫層級風險**：需要
   確認既有程式碼（未來實作時）沒有任何地方假設這個欄位一定非
   null，建議在正式開發前先盤點所有讀取 `Payment.receivableId` 的
   程式碼位置。
2. **溢收差額的「補登項目吸收」路徑（第十七節）需要你確認是否要
   開放**：目前規格提供兩條路徑（退款 或 補登項目吸收差額），如果
   宮方希望溢收一律走退款、不接受「多贊助」這種吸收方式，需要告知
   後拿掉其中一條路徑，簡化狀態機。
3. **`OVERPAID_PENDING` 與 `REFUND_PENDING` 的權限問題尚未定義**：
   誰有權限把 `OVERPAID_PENDING` 轉成 `REFUND_PENDING`？是否所有
   行政人員都可以操作，還是需要主管層級確認？本輪只定資料狀態，
   權限規則需要你在後續版本補充（`docs/FINANCE_AND_ACTIVITY_SPEC.md`
   第九節「權限與資料安全」屆時可能需要擴充）。
4. **`VOIDED` 狀態的資料保留政策**：作廢的報名/收款紀錄是否需要在
   畫面上預設隱藏（避免搜尋結果雜訊過多），還是需要一個「顯示已作廢」
   的篩選開關？本輪 Wireframe 假設預設隱藏、可切換顯示，需要你確認。
5. **`FamilyLampGroup` 的價格是否可以隨人數有階梯式調整**（例如
   4 人以下一個價、5 人以上加價）：本輪規格假設全家燈是**完全固定**
   的單一價格，不隨人數變動，如果宮方實務上有階梯定價需求，需要
   另外討論擴充 `flatUnitPrice` 為分級規則。
6. **Line Pay 的實際啟用時程**：本輪只保留 enum 值，沒有規劃啟用
   所需的金流串接/對帳規格，這是明確排除在本輪範圍外的未來工作，
   列在這裡提醒，不代表下一輪會自動開始做。
7. 延續 V7.0.2/V7.0.3 既有的尚待確認事項（`docs/FINANCE_AND_ACTIVITY_SPEC.md`
   第十三節、`docs/ACTIVITY_ENGINE.md` 對應章節），本輪沒有新的資訊
   可以回答，維持原樣待你確認。

---

## 二十五、本輪確認：本次完全沒有做的事

- 沒有開發收款中心的任何畫面或 API（只有低保真 Wireframe 線框稿，
  不是可運作的畫面）。
- 沒有修改 `prisma/schema.prisma`、沒有建立 migration、沒有變更
  正式資料庫（僅新增/更新本文件與其他既有文件，見下方文件清單）。
- 沒有開發正式財務 UI、流水帳 UI、銀行帳戶 UI、財務報表 UI。
- 沒有開發年度燈/祭改/普渡收款/南巡北巡/宮慶任何一個活動的正式
  收款畫面。
- 沒有推翻 `docs/FINANCE_CORE_SCHEMA.md`（V7.0）與
  `docs/ACTIVITY_ENGINE.md`（V7.0.2）既有定案的九個財務核心模型與
  年度活動引擎設計，本輪只做狀態擴充與新增輔助模型。
- 沒有部署 Render、沒有推送 GitHub、沒有執行
  `npm install`/`prisma generate`/`next build`。
- 沒有開始 V7.2。
