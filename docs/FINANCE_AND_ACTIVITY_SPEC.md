# 台北三玄宮行政與財務規格書（V6.3 定稿）

**狀態：規格與架構設計，尚未實作、尚未套用 migration、尚未變更正式資料庫。**

本文件把 V6.2、V6.3 已經確認的行政與財務規則，整理成正式規格，並檢查現有
Prisma Schema（`prisma/schema.prisma`）能沿用哪些部分、缺少哪些部分。文件中
標示「建議 Schema」的程式碼區塊，都只是**提案**，本輪不會寫進
`prisma/schema.prisma`、不會產生 migration、不會影響正式資料庫或既有資料。

**V6.3 更新重點**：新增「年度燈燈種限制」「犯太歲名單」「信眾提醒」「延用
去年報名」四項規則（見第十五節），並收斂普渡對外收款的隱藏規則（第五節，
從「隱藏冤親債主/無緣子女兩項」收斂為「四個類別全部不對外顯示」）。行政
操作類（非資料模型）的細節規則另外整理在新文件
`docs/ADMINISTRATION_RULES.md`，本文件維持專注在資料架構與 Schema 分析。

**V7.0 更新重點（重要）**：第十一節列出的「建議 Schema」在 V7.0
「Finance Core」已經正式收斂定案，**目前財務核心 Schema 的權威版本是
`docs/FINANCE_CORE_SCHEMA.md`**，本文件第十一節保留作為歷史脈絡與業務
規則對照，若兩份文件的 Schema 細節有出入，以 `FINANCE_CORE_SCHEMA.md`
為準。第十三節「風險與尚待確認事項」第 1 項已在 V7.0 解決，見該節標註。

**V6.4 更新重點**：第四節「一人代辦多人報名（報名群組）」新增
4.1 小節，釐清 `RegistrationGroup` 的「代辦人模式」（普渡專用，一人
跨多戶）跟 V6.4 新增的「家戶快速報名模式」（年度燈/祭改專用，同一戶
內按姓名勾選）是兩種不同的操作情境，但共用同一套
`RegistrationGroup`/`RegistrationItem`/`Receivable` 資料鏈。家戶快速
報名的完整操作流程與範例，見 `docs/ADMINISTRATION_RULES.md` 第十一節；
`RegistrationItem` 新增欄位（`sourceHouseholdId`/`sourceMemberId`/
`isTemporaryName`/`status`）見 `docs/FINANCE_CORE_SCHEMA.md`；架構決策
見 `docs/ADR.md` ADR-0011。

**V7.0.2 更新重點**：第一節「年度活動固定順序」新增「補庫」（`ANNUAL_
LANTERN`→`PURIFICATION`→`SOUTHERN_TOUR`→`TEMPLE_CELEBRATION`→
`UNIVERSAL_SALVATION`→`TREASURY_REPLENISHMENT`→`NORTHERN_TOUR`，共七項），
`ActivityType` enum 新增 `TREASURY_REPLENISHMENT` 值。**`ActivityYear`
本輪擴充成完整的「年度活動引擎」——活動名稱/顯示排序/是否啟用/是否開放
報名/報名起訖日/活動日期/農曆/國曆日期/神明指定日期標記，權威版本見新
文件 `docs/ACTIVITY_ENGINE.md`**，涵蓋首頁「目前主打活動」與「下一個
重要活動」的判斷邏輯。架構決策見 `docs/ADR.md` ADR-0012。

**V7.0.3 更新重點**：第三節「報名與收款必須分開」新增「報名當下立即
付款」的兩種完成路徑（先存為未繳／立即收款），`Payment` 新增
`financialAccountId`/`payerName` 欄位，狀態自動計算規則（部分繳款/
已繳清/溢收待處理）正式定案，權威 Schema 與流程圖見
`docs/FINANCE_CORE_SCHEMA.md` 第 4.5 節。架構決策見 `docs/ADR.md`
ADR-0013。

**V7.1 更新重點**：新文件 `docs/COLLECTION_CENTER.md` 正式定案
「收款中心」——七個活動共用的收款/查詢/對帳入口。第三節「報名與收款
分開」的兩按鈕規則正式擴充為跨活動通用版；第四節「一人代辦多人報名」
新增「全家燈整組計價」（`FamilyLampGroup`，見
`COLLECTION_CENTER.md` 第八節）跟個人逐人計價並存；第六節「南巡與
北巡規格」新增「以車次為主要財務統計單位、不提供逐人收據」的正式
規則。`Receivable.status`（`ReceivableStatus`）由 4 值擴充為 7 值，
`Payment` 大幅擴充欄位（詳見 `COLLECTION_CENTER.md` 第四節），新增
`QuickCollectionEntry`（快速收款）模型。架構決策見 `docs/ADR.md`
ADR-0014、ADR-0015。**本輪不推翻既有 Finance Core 與 Annual Activity
Engine 設計。**

**V7.2 更新重點**：新文件 `docs/AGENT_REMITTANCE.md` 正式定案「代收
待繳回提醒」——代收人已向功德主收款但尚未交回宮方這段期間的追蹤機制，
新增 `AgentRemittance` 模型與 `RemittanceStatus` enum，本身不建立
`LedgerEntry`、不更新銀行/現金餘額，只有確認繳回後才建立正式
`Payment`。首頁新增「代收待繳回」提醒卡，收款中心新增「代收對帳」
頁籤。架構決策見 `docs/ADR.md` ADR-0016。**本輪不推翻既有 Finance
Core、Annual Activity Engine、Collection Center 設計，也不修改報名
畫面既有的兩個按鈕。**

**V7.1.1 更新重點**：新文件 `docs/AGENT_COLLECTION_RECONCILIATION.md`
取代 V7.2 的 `docs/AGENT_REMITTANCE.md`，把代收待繳回追蹤機制升級為
**雙軌帳本**設計——`AgentCollectionItem`（4 種狀態，支援部分繳回）與
`ReconciliationBatch`/`ReconciliationBatchItem`（對帳批次，防止重複
入帳）；同一輪新文件 `docs/MONTHLY_FINANCIAL_REPORT.md` 正式定案
「月底自動財務報表」——每月 1 日凌晨自動產生草稿，經人工確認/鎖定，
新增 `MonthlyFinancialReport`（DRAFT/PENDING_RECONCILIATION/
CONFIRMED/LOCKED/VOID 五態）與 `PeriodAdjustment`（跨月調整）模型。
架構決策見 `docs/ADR.md` ADR-0017～ADR-0020。**本輪不推翻既有
Finance Core、Annual Activity Engine、Collection Center 設計，不
開發正式 UI/API，不套用 migration。**

---

## 目錄

1. 年度活動固定順序
2. 價格規則
3. 報名與收款分開
4. 一人代辦多人報名（報名群組）
5. 普渡規格
6. 南巡與北巡規格
7. 月流水與銀行餘額
8. 活動獨立損益
9. 權限與資料安全
10. 現有架構可沿用的部分
11. 建議新增/調整的資料表與 ER Diagram
12. 建議開發順序
13. 風險與尚待確認事項
14. 本輪確認：本次完全沒有做的事
15. 年度燈與犯太歲規格（V6.3 新增）

---

## 一、年度活動固定順序

系統中所有年度活動選單、規格文件與未來報表，固定依下列順序顯示：

1. 年度燈
2. 祭改
3. 南巡
4. 宮慶
5. 普渡
6. 補庫（V7.0.2 新增）
7. 北巡（三年一次，只有設定為北巡年度才顯示）

**現況**：目前 `ActivityType` enum（`prisma/schema.prisma`）只有
`ANNUAL_LANTERN / UNIVERSAL_SALVATION / TEMPLE_CELEBRATION / REPRINT` 四種，
**缺少「祭改」「南巡」「北巡」「補庫」四種**，且 enum 宣告順序不等於畫面
顯示順序（這個專案從 V2.0 起就是慣例：畫面順序另外用明確的排序陣列定義，
不依賴 enum 宣告順序，例如 `src/lib/ritual.ts` 的 `ENTRY_CATEGORY_ORDER`）。

**建議**：
- `ActivityType` enum 新增四個值：`PURIFICATION`（祭改）、`SOUTHERN_TOUR`
  （南巡）、`NORTHERN_TOUR`（北巡）、`TREASURY_REPLENISHMENT`（補庫，
  V7.0.2 新增）。這是**純新增 enum 值**，不影響既有的四個值、不影響既有
  資料。
- 沿用既有慣例，另外在程式碼（例如 `src/lib/activity.ts`，本次不新增，
  只先在規格書中定案）定義固定排序常數：
  ```ts
  export const ACTIVITY_TYPE_ORDER = [
    "ANNUAL_LANTERN",           // 1. 年度燈
    "PURIFICATION",             // 2. 祭改
    "SOUTHERN_TOUR",            // 3. 南巡
    "TEMPLE_CELEBRATION",       // 4. 宮慶
    "UNIVERSAL_SALVATION",      // 5. 普渡
    "TREASURY_REPLENISHMENT",   // 6. 補庫（V7.0.2 新增）
    "NORTHERN_TOUR",            // 7. 北巡（三年一次，需搭配 ActivityYear.isActive 判斷是否顯示）
  ] as const;
  ```
- 「北巡是否為北巡年度」需要一個地方保存設定——這正是下面「建議新增資料表」
  的 `ActivityYear.isHeld`/`isActive` 欄位要解決的問題（見十一節）。

**V7.0.2 更新重點**：`ActivityYear` 本輪（V7.0.2）大幅擴充成完整的「年度
活動引擎」——活動名稱、顯示排序、是否啟用、是否開放報名、報名起訖日、
活動日期、農曆/國曆日期、神明指定日期標記，全部收斂到新文件
`docs/ACTIVITY_ENGINE.md`，該文件是這些引擎欄位的權威版本；本節（第一節）
維持只記錄「固定顯示順序」這項業務規則，`sortOrder` 欄位的預設值即依本節
順序帶入，詳見 `docs/ACTIVITY_ENGINE.md` 第三節。

---

## 二、價格規則

1. 每一個活動、每一個收費項目都必須由管理者手動設定價格——**不可寫死在程式碼**。
2. 價格必須依年度保存（114 年跟 115 年的年度燈單價可以不一樣，且都要留存）。
3. 可以複製前一年價格，再由管理者修改（不是每年重新輸入）。
4. 報名成立時，必須把當時使用的實際單價保存成快照。
5. 之後修改「年度標準價格」，不得影響既有報名紀錄（快照已經寫死，不會跟著變動）。
6. 單筆報名仍可手動調整實際價格，但要保留：原始標準價、實際收費價、調整原因。

**現況**：目前 Schema 完全沒有「價格」相關的欄位或資料表。普渡的贊普金額
（`UniversalSalvationDetail.sponsorAmount` 等）是唯一跟金額有關的既有欄位，
但那是「金額直接輸入」，不是「單價 × 數量」的定價機制，也沒有年度標準價格
可複製、沒有快照概念。

**建議**：新增 `ActivityYear`（年度活動設定）與 `ActivityPriceItem`
（年度標準價格項目）兩張表，並在報名明細（`RegistrationItem`，見四、十一節）
同時保存 `standardUnitPrice`（快照的標準價）、`actualUnitPrice`（實際收費價）、
`priceAdjustedReason`（調整原因，實際價 ≠ 標準價時建議前端要求必填）。
「複製前一年價格」是一個**資料操作/API 行為**（把上一年度的 `ActivityPriceItem`
整批複製成新年度的新資料列，供管理者再修改），不需要額外的資料表，用法
比照現有 `copy-from-previous-year`（普渡複製去年資料）的既有模式即可沿用。

---

## 三、報名與收款必須分開

報名不等於入帳。流程固定為：

```
報名 → 產生應收金額 → 收到款項 → 建立收款紀錄 → 實際入流水帳 → 更新現金或銀行餘額
```

付款狀態至少包含：**未繳 / 部分繳款 / 已繳清 / 退款或溢收待處理**。

畫面與未來報表必須分開顯示：**應收總額 / 已收總額 / 未收總額 / 退款金額**。

**未實際收到的款項，不可增加現金或銀行餘額。**

**現況**：目前系統完全沒有「報名」「應收」「收款」「銀行帳戶」的資料模型。
既有的 `FinanceRecord`（財務流水帳，V1 架構預留、尚未開發任何畫面/API）
概念上最接近「收款/支出的一筆分錄」，但目前**沒有「這筆錢屬於現金還是哪個
銀行帳戶」的欄位**，也沒有跟任何報名資料掛勾的機制。

**建議**（詳見十一節完整定義）：
- `RegistrationGroup`（報名群組）＋`RegistrationItem`（報名明細）：「報名」
  這一步，只會產生應收金額，**不會**觸碰任何現金/銀行餘額。
- `Payment`（收款紀錄）：代表「真的收到一筆錢」這個事實，記錄付款方式、
  對應哪個報名群組、是否為退款。
- **關鍵設計決策**：每一筆 `Payment` 建立時，系統自動、且只會產生**一筆**
  對應的 `FinanceRecord`（流水帳分錄，見七、八節），透過資料庫層級的
  `@@unique` 約束保證「一筆收款只入帳一次」，不會重複計算，也不會有畫面
  各自手動分別登打「活動帳」「總帳」「銀行餘額」三次的風險。
- `FinanceRecord` 需要新增 `financialAccountId`（這筆錢進了哪個現金/銀行
  帳戶）欄位——這是目前完全缺少的部分。
- 付款狀態（`PaymentStatus`：`UNPAID` 未繳／`PARTIAL` 部分繳款／`PAID`
  已繳清／`REFUND_PENDING` 退款或溢收待處理）保存在 `RegistrationGroup`
  上，由每次新增/作廢 `Payment` 後重新計算更新（應收 - 已收±退款）。

**V7.0.3 更新重點**：本節「報名不等於入帳」的流程，正式定案支援「報名
畫面當下」的兩種完成方式——「先存為未繳」（只建立應收）跟「立即收款」
（同一步再建立收款紀錄），且收款當下就要指定現金/銀行帳戶、記錄付款人，
狀態依實收金額 vs 應收金額自動判定（部分繳款/已繳清/溢收待處理，**溢收
不可自行吞掉差額**）。完整資料流程與 Schema 欄位見
`docs/FINANCE_CORE_SCHEMA.md` 第 4.5 節（該文件是本節業務規則的權威
Schema 版本，本節上方「現況/建議」的 `PaymentStatus`/`FinanceRecord`
用詞為 V6.2 時期的舊稱，正式欄位以 `FINANCE_CORE_SCHEMA.md` 的
`ReceivableStatus`/`Payment`/`LedgerEntry` 為準）。架構決策見
`docs/ADR.md` ADR-0013。

**V7.1 更新重點**：「先存為未繳」／「立即收款」正式定案為**七個活動
共用**的通用規則（不是年度燈專屬），`ReceivableStatus` 正式擴充為
7 個狀態值（未繳/部分繳款/已繳清/溢收待處理/退款待處理/已退款/
已作廢），並新增「快速收款」（`QuickCollectionEntry`）情境，支援
資料尚未備齊就先收款入帳、之後再連結回正式報名。完整規則見
`docs/COLLECTION_CENTER.md` 第二、三、十二節。架構決策見
`docs/ADR.md` ADR-0014。

---

## 四、一人代辦多人報名（報名群組）

一位代辦人／功德主可以替「同戶家人／其他家戶／親戚／朋友」一起報名。

報名群組至少包含：代辦人／功德主、活動年度、活動類型、多筆報名明細
（各自單價/數量/小計）、群組應收總額、群組已收金額、群組未收金額。

**每筆報名明細仍必須連回真正的家戶或成員，不可全部塞進代辦人的家戶。**

畫面上要能直接顯示「她這一整坨總共多少錢」（群組彙總金額）。**本次只整理
規格，不做 UI。**

**現況**：完全沒有對應的資料模型。現有的 `RitualRecord` 是「一戶一年一種
祭典類型」的架構，天生就是**以家戶為單位**，沒有「一個代辦人跨多戶」的
概念，這是一個結構性的缺口，需要新的、獨立於家戶的 `RegistrationGroup`
概念才能解決。

**建議**：
- `RegistrationGroup.agentDisplayName`：代辦人／功德主姓名（自由輸入文字，
  因為代辦人不一定是系統裡的既有家戶/成員，可能是外部親友）。
- `RegistrationGroup.agentHouseholdId` / `agentMemberId`：**可選**欄位，
  如果代辦人剛好是系統裡已存在的家戶聯絡人，可以額外關聯回去（方便之後
  查詢「這戶人平常都會幫誰代辦」），但不是必填。
- `RegistrationItem.householdId` / `memberId`：**每一筆明細**都要求連回
  真正的家戶／成員（可為空是例外，例如普渡的冤親債主/無緣子女本來就不是
  真實成員，見五節），落實「不可全部塞進代辦人的家戶」的規則。
- 群組應收/已收/未收金額：建議做成 `RegistrationGroup` 上的**彙總欄位**
  （`receivableTotal` / `receivedTotal` / `unreceivedTotal` / `refundTotal`），
  由後端在每次明細或收款異動時重新計算寫入，畫面只需要讀這幾個欄位，不用
  每次都重新加總全部明細——這也是十三節「尚待確認事項」第一項要請你確認的
  設計選擇（是否要額外做一張獨立的 `Receivable` 表，見下方）。

### 4.1 兩種操作情境：代辦人模式 vs. 家戶快速報名模式（V6.4 新增）

`RegistrationGroup` 目前對應到**兩種不同的行政操作情境**，本節釐清兩者
的差異，避免混用：

1. **代辦人模式（普渡專用）**：一位代辦人／功德主，替**不同家戶**（可能
   互不相關）一次報名，`RegistrationGroup.agentDisplayName` 是代辦人
   本人的名字，底下的 `RegistrationItem` 各自連回**不同的**
   `householdId`/`memberId`。這是本節（第四節）原本描述的情境。
2. **家戶快速報名模式（V6.4 新增，年度燈/祭改專用）**：管理者搜尋
   **同一戶**任一成員姓名，系統叫出整戶名單，管理者用勾選框決定「這戶
   哪些人今年要報名」，底下的 `RegistrationItem` 全部連回**同一個**
   `householdId`（各自不同的 `memberId`，或臨時姓名）。這種情境不存在
   「代辦人」這個角色——快速報名的操作者是行政人員，不是某位信眾。

**為什麼兩者仍然共用同一套 `RegistrationGroup`/`RegistrationItem`/
`Receivable` 資料鏈**：即使家戶快速報名沒有「代辦人」的概念，財務上
仍然需要一個容器來承接「這一戶今年這個活動的應收/已收/未收總額」，讓
V7.0 已經定案的 `Receivable`/`Payment`/`LedgerEntry` 收款流程可以對所有
活動類型一致運作，不需要為家戶快速報名另外設計一套平行的財務容器。因此
家戶快速報名會**自動建立一個輕量的 `RegistrationGroup`**（每個
「家戶＋活動類型＋年度」一組），`agentDisplayName` 預設帶入戶長姓名或
「○○○一家」字樣，僅供顯示與追蹤用途，不代表真的有一位對外的代辦人。
完整判斷邏輯與流程圖見 `docs/ADMINISTRATION_RULES.md` 第十一節；架構
決策見 `docs/ADR.md` ADR-0011。

**本節同樣只更新規格說明，不影響 Schema、不新增資料表，本輪不套用任何
migration。**

### 4.2 全家燈整組計價（V7.1 新增，僅為指標，權威內容見 COLLECTION_CENTER.md）

年度燈/祭改除了本節既有的「逐人計價」（每個名字一筆 `RegistrationItem`，
單價 × 1）之外，V7.1 新增「全家燈」概念——整組固定價格、不因報名人數
而乘倍、可跨家戶合報一組。新增 `FamilyLampGroup`/`FamilyLampMember`
兩個模型，只負責記錄名單，不影響既有 `Receivable`/`Payment` 財務計算
邏輯（一組全家燈仍然只對應**一筆** `RegistrationItem`）。完整規則、
Schema、流程圖見 `docs/COLLECTION_CENTER.md` 第八節。

---

## 五、普渡規格

普渡項目固定順序：

1. 歷代祖先
2. 個人乙位正魂
3. 冤親債主
4. 無緣子女
5. 贊普
6. 白米

規則：
1. 前四項（歷代祖先/個人乙位正魂/冤親債主/無緣子女）都屬於報名明細。
2. 贊普金額不預設，報名時手動輸入。
3. 白米金額不預設，報名時手動輸入。
4. 普渡內部必須保留完整祭祀內容。
5. 對外收款或未來收據，**只顯示：功德主姓名**（V6.3 更新，見下方「V6.3
   規則收斂」）。
6. 對外收款畫面與收據**不得**直接顯示：冤親債主、無緣子女、歷代祖先、
   個人乙位正魂（V6.3 更新：**四個類別全部不對外顯示**，不是只隱藏
   冤親債主/無緣子女兩項，見下方）。祭祀內容只保留在系統內部。
7. 不特別顯示「陽上」，統一使用「功德主」。
8. 普渡報名群組可以包含不同家戶與不同祭祀對象。

> **V6.3 規則收斂**：V6.2 原本的規則是「只隱藏冤親債主/無緣子女，歷代祖先/
> 個人乙位正魂可以對外顯示」；V6.3 明確收斂為「**四個類別全部不對外
> 顯示**，對外收款/收據只留功德主姓名（+合計金額，收款/收據本來就需要
> 金額才有意義，規格原文「只顯示功德主姓名」是強調不逐項列出祭祀內容，
> 不是連合計金額都不顯示）」。這一版以 V6.3 為準。

**現況（這是本輪最重要的相容性確認）**：普渡的「內部祭祀內容」
（`RitualRecord` → `UniversalSalvationDetail` → `UniversalSalvationEntry`，
四個類別歷代祖先/個人乙位正魂/冤親債主/無緣子女）從 V2.0 起就已經完整存在，
**這部分完全不需要新增或調整，繼續當作普渡的「內部祭祀內容」正式主檔**——
剛好完美對應規則 4「普渡內部必須保留完整祭祀內容」。

但現有架構**完全沒有金額/報名/收款的概念**（`UniversalSalvationEntry` 只有
`displayName`/`yangshangName`/`notes`，沒有任何金額欄位；贊普雖然有獨立的
`sponsorAmount` 等欄位，但那是「金額直接輸入」而不是規格要求的「報名明細＋
應收/已收」架構）。

**建議（關鍵設計決策，需要你確認，見十三節）**：普渡的「內部祭祀內容」跟
「對外收款」拆成兩層，**不重複輸入資料**：
- 內部祭祀內容維持現狀：管理者一樣在既有的普渡登記畫面新增歷代祖先/個人
  乙位正魂/冤親債主/無緣子女，寫入既有的 `UniversalSalvationEntry`
  （**完全不變**）。
- 對外收款那一層，`RegistrationGroup` 額外關聯回同一筆 `RitualRecord`
  （新增 `RegistrationGroup.ritualRecordId` 可選欄位），`RegistrationItem`
  依「類別」自動產生（例如「歷代祖先」一筆項目，數量 = 這筆普渡登記裡
  歷代祖先的筆數，單價來自當年度 `ActivityPriceItem`），管理者不需要為
  每一位祖先/正魂重複輸入一次金額——**這是本輪認為最合理的做法，但屬於
  設計提案，尚未跟你確認，見十三節第 2 項**。
- 贊普、白米因為「金額不預設，報名時手動輸入」，建議各自對應一筆
  `RegistrationItem`（`chargeItemKey = "SPONSOR"` / `"RICE"`），單價欄位
  容許為空（`ActivityPriceItem` 本來就不用預先幫這兩項設定標準價），由
  管理者在報名當下直接輸入實際金額。
- 「對外收款或收據只顯示功德主姓名 + 合計金額，四個類別（歷代祖先/個人
  乙位正魂/冤親債主/無緣子女）全部不對外顯示」（V6.3 收斂為四類別全部
  隱藏，見上方「V6.3 規則收斂」）：因為收款/收據畫面（未來功能，本輪不
  開發）只會讀取 `RegistrationGroup` 的彙總欄位與 `Payment`，**架構上
  天生就不會碰到** `UniversalSalvationEntry` 的明細內容，不需要額外的
  「隱藏規則」，只要收據產生邏輯**永遠不要**去 join 內部祭祀內容即可——
  這個架構決策從 V6.2 就已經定案，V6.3 只是收斂了對外規則的文字描述，
  對資料模型本身沒有任何影響。
- 「不特別顯示陽上，統一用功德主」：純顯示層的文字，`RegistrationGroup.
  agentDisplayName` 在普渡情境下，畫面標籤顯示為「功德主」，不需要額外
  欄位，跟既有 `UniversalSalvationDetail.yangshangName`（普渡登記內部仍然
  保留「陽上姓名」欄位，那是內部祭祀內容的一部分）是兩件事，不衝突。

---

## 六、南巡與北巡規格

南巡與北巡**不做個人收據**，也**不以每位信眾作為主要財務統計單位**。
財務統計以「車次」為主。

收款項目分為：海報贊助、車上收費、雙人房加價。

車上收費規則：
1. 車次預設顯示：1、3、5、6、7、8、9 車。
2. 2 車、4 車預設留空，但管理者未來可以新增或啟用。
3. 每一車必須可以填：每人單價、人數、小計＝每人單價 × 人數。
4. 系統自動計算：每車小計、全部車資總計。
5. 雙人房加價獨立統計：每間加價、間數、小計＝每間加價 × 間數。
6. 海報贊助金額手動輸入。
7. 南北巡不要求逐人登錄收款，也不產生個人收據。
8. 如未來保留人員名單，只供車隊與座位管理，不作為主要財務統計依據。

**現況**：完全沒有對應架構——這是全新的財務單位（以「車次」而非「人」或
「戶」為主），跟系統其他地方的資料模型都不一樣。

**建議（關鍵設計決策，需要你確認，見十三節）**：不建立第三套獨立的財務
管線，而是讓 `TourVehicle`／`TourRoomCharge` 產生的小計，**寫入同一套
`RegistrationGroup` / `RegistrationItem` 財務容器**，理由是：南巡/北巡
一樣需要「應收/已收/未收」（見七、八節的「活動獨立損益」要求所有活動一致），
如果另外做一套平行的應收/收款邏輯，等於同樣的規則要維護兩次，容易不一致。
具體設計：
- 一趟「115 年南巡」對應**一個** `RegistrationGroup`（`agentDisplayName`
  可以填「南巡團」這類固定文字，或留空，因為南巡不是某一位代辦人幫別人
  報名的概念）。
- `TourVehicle`：車次專屬的**設定/編輯**表——車號（1/2/3/.../9）、
  `isEnabled`（2、4 車預設 `false`，其餘預設 `true`，管理者可自行切換）、
  每人單價、人數、小計（單價 × 人數，程式計算不手動輸入）。
- `TourRoomCharge`：雙人房加價的設定/編輯表——每間加價、間數、小計。
- 這兩張表各自的小計，**在「確認/儲存」時**同步成 `RegistrationItem`
  列（例如「1 車車資」「雙人房加價」各一筆明細），讓 `RegistrationGroup`
  的應收總額計算方式跟其他活動完全一致，不需要另外寫一套「南北巡專用」
  的應收計算邏輯。
- 海報贊助因為是單純手動輸入金額、不分車次，建議直接當作一筆
  `RegistrationItem`（`chargeItemKey = "POSTER_SPONSOR"`），不需要獨立資料表。
- 人員名單（如果未來需要）：規格明確說「只供車隊與座位管理，不作為主要
  財務統計依據」，這暗示如果之後要做，會是一張跟 `TourVehicle` 關聯的
  「座位表」，**跟財務金額無關**，本輪不需要現在就設計，列入「尚待確認/
  未來規劃」。

**V7.1 更新重點**：收款中心正式定案「南北巡以車次為主要財務統計單位、
不提供逐人收據」為明確規則（不只是本節原本的設計傾向，而是收款中心
呈現層必須遵守的規定），完整收款彙總畫面規則見
`docs/COLLECTION_CENTER.md` 第十節，架構決策見 `docs/ADR.md`
ADR-0015。

---

## 七、月流水與銀行餘額

財務中心未來必須包含：每月流水收入、每月流水支出、現金餘額、各銀行帳戶
餘額、期初餘額、本期收入、本期支出、目前帳面餘額。

**銀行帳戶餘額只能由實際收款與實際支出更新，不能由報名應收更新。**

每筆實際收款必須標示：日期、金額、付款方式、現金或銀行帳戶、所屬活動、
報名群組或來源、備註。

**現況**：目前 `FinanceRecord` 已經有 `type`(INCOME/EXPENSE)、`amount`、
`occurredOn`、`description`、`status`(DRAFT/CONFIRMED/VOID)——**這部分完全
可以沿用**，是 V1 就已經做好的架構預留。**缺少的是**：(a) 沒有「現金／
銀行帳戶」的概念（不知道這筆錢進了哪個口袋）；(b) 沒有「付款方式」欄位；
(c) 沒有連回報名群組/活動類型的欄位；(d) 沒有「期初餘額」的概念。

**建議**：
- 新增 `FinancialAccount`（現金／銀行帳戶）：帳戶名稱、類型（現金／銀行）、
  期初餘額、期初餘額日期，`currentBalance`（目前帳面餘額，denormalized、
  只由「已確認」的 `FinanceRecord` 異動更新，VOID 時要正確地把餘額加/減
  回去）。
- 擴充既有 `FinanceRecord`：新增 `financialAccountId`（必填，現金或哪個
  銀行帳戶）、`paymentMethod`（付款方式：現金／轉帳／其他）、`activityType`
  （可選，這筆錢屬於哪個活動，null 表示一般雜項收支）、`registrationGroupId`
  （可選，來自哪個報名群組）、`paymentId`（可選，如果是由 `Payment` 自動
  產生，記錄來源，並用 `@@unique` 保證一筆 `Payment` 只產生一筆
  `FinanceRecord`）。
- 「每月流水收入/支出」「本期收入/支出」「目前帳面餘額」都是**查詢/彙總**，
  不需要額外的資料表——用 `FinanceRecord` 依 `financialAccountId` +
  `occurredOn` 月份 + `type` 分組加總即可；「目前帳面餘額」＝期初餘額 +
  該帳戶所有已確認 `FinanceRecord` 的收入總和 - 支出總和。
- 「銀行帳戶餘額只能由實際收款/支出更新」：架構上天生滿足，因為
  `FinancialAccount.currentBalance` 只會被 `FinanceRecord`（已確認的實際
  收支分錄）異動，`RegistrationGroup` 的應收金額完全是另一張表，兩者之間
  沒有任何會自動觸發餘額異動的關聯。

---

## 八、活動獨立損益

以下活動未來必須各自獨立顯示：年度燈、祭改、南巡、宮慶、普渡、北巡。

每一項至少顯示：應收、已收、未收、支出、結餘。

**同一筆實際收款同時要進入活動帳、總帳、現金或指定銀行帳戶，但只能建立一次
收款紀錄，不可重複計算。**

**現況**：完全沒有對應架構，但延續七節的設計，這裡不需要新概念，只是把
六、七節已經建議的欄位組合起來查詢：

- **應收/已收/未收**：來自 `RegistrationGroup`（依 `activityType` + `year`
  分組加總 `receivableTotal` / `receivedTotal` / `unreceivedTotal`）。
- **支出**：來自 `FinanceRecord`（`type = EXPENSE`，依 `activityType` +
  月份/年度分組加總）。
- **結餘** ＝ 已收 - 支出（活動層級的結餘，不等於銀行帳戶餘額——同一筆錢
  可能同時計入活動結餘跟銀行帳戶餘額，這是正常的，兩者是不同維度的統計，
  不是重複計算）。
- **「只能建立一次收款紀錄」**：透過 `FinanceRecord.paymentId` 加
  `@@unique([paymentId])` 的資料庫層級約束保證，而不是靠畫面/API 邏輯
  自律——這是這個專案一貫的作法（比照 V5.1 年度隔離用
  `@@unique([householdId, year, activityType])` 保護，而不是只靠網址
  參數自律）。
- **「同一筆收款同時進入活動帳、總帳、現金/銀行帳戶」**：因為
  `FinanceRecord` 這一筆資料，天生就同時具備 `activityType`（活動帳的
  篩選依據）、`financialAccountId`（現金/銀行帳戶餘額的篩選依據），而
  「總帳」就是「不篩選、全部 `FinanceRecord`」——**同一筆資料被三種不同
  的查詢角度讀取，而不是分別寫入三張表**，架構上直接保證不會重複計算。

---

## 九、權限與資料安全

1. 財務資料預設只有 `SUPER_ADMIN` 可以查看與修改。
2. 其他登入者預設看不到財務選單。
3. 不可只在前端隱藏，後端 API 也必須驗證權限。
4. 財務資料不可永久刪除，只能作廢。
5. 所有新增、修改、作廢都必須保留 Audit Log。
6. 本次只確認規格與架構，不實作登入與權限 UI。

**現況：這部分幾乎完全不需要新增，是這個專案從很早期就已經做好的架構
預留，這是本次規格檢查裡「最不需要擔心」的一塊**：
- `Role` enum（`SUPER_ADMIN`/`STAFF`/`FINANCE_CLERK`）、`User` model 早就
  存在。
- `src/lib/permissions.ts` 的 `canFinance()` / `canSeeFinanceMenu()`
  權限矩陣早就定義好，且檔案內的註解本來就明確要求「每一支財務 API route
  第一步就要呼叫 `canFinance()`，不能只在前端把按鈕藏起來」——**跟本輪
  規則 2、3 完全一致，不需要修改**。
- `FinanceRecordStatus`（`DRAFT`/`CONFIRMED`/`VOID`）早就是「只能作廢、
  不能刪除」的設計——跟規則 4 完全一致。
- `AuditLog` model（`entityType`/`entityId`/`action`/`beforeData`/
  `afterData`/`reason`，`entityType` 是通用字串設計）早就是通用格式，
  **可以直接沿用在所有新增的資料表上**（`RegistrationGroup`、
  `Payment`、`FinanceRecord`、`ActivityPriceItem` 之後有異動時，都寫
  `entityType = "RegistrationGroup"` 之類的字串即可），不需要為每張新表
  各自做一張稽核表。

**唯一需要提醒的缺口**：現在系統**完全沒有登入/session 機制**
（`permissions.ts` 的 `getCurrentUser()` 目前是尚未實作的預留函式），
所以「查看與修改」的權限檢查現階段**還無法真正生效**——這是規則 6 已經
明確排除在本輪之外的部分（「本次只確認規格與架構，不實作登入與權限 UI」），
但要提醒你：**財務相關功能（報名/收款/流水帳）正式開發時，登入機制必須
先做，否則 `canFinance()` 這一層形同虛設**——這點列入十二節「建議開發
順序」。

---

## 十、現有架構可沿用的部分（總表）

| 現有架構 | 沿用方式 |
|---|---|
| `Household` / `Member` | `RegistrationItem` 直接關聯回真正的家戶/成員，不需要修改 |
| `RitualRecord` + `UniversalSalvationDetail` + `UniversalSalvationEntry` | 普渡「內部祭祀內容」完全不變，繼續當正式主檔；`RegistrationGroup` 額外關聯回同一筆 `RitualRecord`（新增一個可選欄位） |
| `@@unique([householdId, year, activityType])` 年度隔離模式 | 沿用同樣的設計哲學，`ActivityYear` 用 `@@unique([year, activityType])`（溫別是這裡沒有 householdId，是宮廟層級而非家戶層級） |
| `FinanceRecord` / `FinanceRecordStatus` / `FinanceRecordType` | 沿用當作「流水帳分錄／LedgerEntry」，只需新增幾個欄位（`financialAccountId`/`paymentMethod`/`activityType`/`registrationGroupId`/`paymentId`），不需要另建一張平行的分錄表 |
| `Role` / `User` / `permissions.ts` | 完全沿用，不需要修改 |
| `AuditLog`（通用 entityType/entityId 設計） | 完全沿用，新資料表的異動記錄直接寫進同一張表 |
| `ActivityType` enum | 沿用，只需新增三個值（祭改/南巡/北巡） |
| 「複製前一年資料」的既有模式（普渡 copy-from-previous-year） | 「複製前一年價格」比照同樣的 API 設計模式 |
| 畫面顯示順序另外用明確排序陣列定義（不依賴 enum 宣告順序）的既有慣例 | 沿用同樣的作法定義 `ACTIVITY_TYPE_ORDER` |

---

## 十一、建議新增/調整的資料表與 ER Diagram

### ER Diagram（文字版，包含既有 + 建議新增，建議新增的用「★」標示）

```
Household 1───N Member
    │
    ├──1───N RitualRecord（既有，普渡/年度燈/宮慶內部主檔，不變）
    │             │
    │             └──1:1── UniversalSalvationDetail ──1:N── UniversalSalvationEntry
    │
    └──1───N★ RegistrationItem（新，報名明細，連回真正家戶/成員）


★ActivityYear（宮廟層級，不綁家戶；@@unique([year, activityType])）
    │
    ├──1───N★ ActivityPriceItem（年度標準價格項目，管理者手動設定）
    │
    └──1───N★ RegistrationGroup（報名群組；可選 ritualRecordId 關聯回普渡內部主檔）
                  │
                  ├──1───N★ RegistrationItem（報名明細：household/member + 標準價快照 + 實際價 + 調整原因 + 數量 + 小計）
                  │             │
                  │             └── (可選) worshipRecordId / 直接文字，供冤親債主等非真實成員項目使用
                  │
                  └──1───N★ Payment（收款紀錄：金額/日期/付款方式/是否退款）
                                │
                                └──1:1★ FinanceRecord（既有表擴充：financialAccountId/paymentMethod/activityType/registrationGroupId/paymentId，一筆 Payment 只產生一筆 FinanceRecord）
                                              │
                                              └──N:1★ FinancialAccount（現金/銀行帳戶，期初餘額 + currentBalance）

★TourVehicle（車次設定：車號/是否啟用/單價/人數/小計，115年南巡→寫回對應的 RegistrationItem）
★TourRoomCharge（雙人房加價設定：每間加價/間數/小計，同樣寫回對應的 RegistrationItem）

★TaiSuiYearZodiac（V6.3 新增：年度 + 生肖清單，@@unique([year, zodiac])，
                    獨立表、透過 year 邏輯對照，不與其他表建外鍵關聯，見第十五節）

AuditLog（既有，通用 entityType/entityId，涵蓋以上所有新表的異動記錄）
User / Role / permissions.ts（既有，不變）
```

### 各資料表用途一覽

| 資料表 | 狀態 | 用途 |
|---|---|---|
| `ActivityYear` | ★新增 | 宮廟層級（非家戶層級）的「某年度、某活動是否舉辦」設定，主要解決北巡三年一次的顯示邏輯，也是價格與報名的年度容器 |
| `ActivityPriceItem` | ★新增 | 某年度、某活動的標準收費項目與單價，管理者手動設定，可從前一年複製 |
| `RegistrationGroup` | ★新增 | 報名群組主檔：代辦人/功德主、年度、活動類型、彙總應收/已收/未收/退款、付款狀態 |
| `RegistrationItem` | ★新增 | 報名明細：連回真正家戶/成員、收費項目、標準價快照、實際價、調整原因、數量、小計 |
| `Payment` | ★新增 | 收款事件：金額、日期、付款方式、是否為退款，一筆可能對應一次分期繳款 |
| `FinancialAccount` | ★新增 | 現金／銀行帳戶：期初餘額、目前帳面餘額 |
| `FinanceRecord` | 既有＋擴充 | 流水帳分錄／總帳，新增現金銀行帳戶、付款方式、活動歸屬、報名群組/收款來源欄位 |
| `TourVehicle` | ★新增 | 南巡/北巡車次設定：車號、是否啟用、每人單價、人數、小計 |
| `TourRoomCharge` | ★新增 | 南巡/北巡雙人房加價設定：每間加價、間數、小計 |
| `ActivityType`（enum） | 既有＋擴充 | 新增祭改/南巡/北巡三個值 |
| `RitualRecord`／`UniversalSalvationDetail`／`UniversalSalvationEntry` | 既有，不變 | 普渡內部完整祭祀內容，繼續當正式主檔 |
| `AuditLog` | 既有，不變 | 涵蓋以上所有新表的稽核記錄 |
| `TaiSuiYearZodiac`（V6.3 新增） | ★新增 | 某年度犯太歲的生肖清單，管理者可自由新增/刪除，供信眾提醒與「延用去年報名」的太歲燈提示判斷使用，詳見第十五節 |

### 建議 Schema（提案，本輪不套用，僅供討論與之後 migration 參考）

```prisma
/// ★建議新增：某年度、某活動是否舉辦（宮廟層級，非家戶層級）
model ActivityYear {
  id           String       @id @default(cuid())
  year         Int // 民國年
  activityType ActivityType
  isHeld       Boolean      @default(true) // 北巡預設 false，其餘預設 true
  notes        String?      @db.Text

  priceItems         ActivityPriceItem[]
  registrationGroups RegistrationGroup[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([year, activityType])
  @@map("activity_years")
}

/// ★建議新增：年度標準收費項目（管理者手動設定，可複製前一年再修改）
model ActivityPriceItem {
  id             String       @id @default(cuid())
  activityYearId String
  activityYear   ActivityYear @relation(fields: [activityYearId], references: [id], onDelete: Cascade)

  itemKey   String // 例如 "ANCESTOR_LINE" / "SPONSOR" / "BUS_SEAT" / "DOUBLE_ROOM" / "POSTER_SPONSOR"
  itemLabel String // 顯示名稱，管理者可自訂
  unitPrice Decimal? @db.Decimal(12, 2) // 可為空：贊普/白米/海報贊助這類「金額不預設」的項目
  sortOrder Int      @default(0)
  isActive  Boolean  @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([activityYearId, itemKey])
  @@map("activity_price_items")
}

/// ★建議新增：報名群組（一位代辦人／功德主可以替多戶、多人一起報名）
model RegistrationGroup {
  id             String       @id @default(cuid())
  activityYearId String
  activityYear   ActivityYear @relation(fields: [activityYearId], references: [id])

  ritualRecordId String? // 可選：普渡時關聯回既有的 RitualRecord（內部祭祀內容主檔）

  agentDisplayName String // 代辦人／功德主姓名（自由輸入，不一定是既有家戶/成員）
  agentHouseholdId String? // 可選：代辦人剛好是既有家戶聯絡人時關聯
  agentMemberId    String? // 可選：代辦人剛好是既有成員時關聯

  receivableTotal  Decimal       @default(0) @db.Decimal(12, 2) // 彙總：應收
  receivedTotal    Decimal       @default(0) @db.Decimal(12, 2) // 彙總：已收
  unreceivedTotal  Decimal       @default(0) @db.Decimal(12, 2) // 彙總：未收
  refundTotal      Decimal       @default(0) @db.Decimal(12, 2) // 彙總：退款
  paymentStatus    PaymentStatus @default(UNPAID)

  notes String? @db.Text

  items    RegistrationItem[]
  payments Payment[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([activityYearId])
  @@map("registration_groups")
}

enum PaymentStatus {
  UNPAID          // 未繳
  PARTIAL         // 部分繳款
  PAID            // 已繳清
  REFUND_PENDING  // 退款/溢收待處理
}

/// ★建議新增：報名明細（每一筆都要連回真正的家戶/成員）
model RegistrationItem {
  id                  String            @id @default(cuid())
  registrationGroupId String
  registrationGroup   RegistrationGroup @relation(fields: [registrationGroupId], references: [id], onDelete: Cascade)

  householdId String? // 大多數情況必填；冤親債主/無緣子女等非真實成員項目可為空
  memberId    String?

  chargeItemKey   String // 對應 ActivityPriceItem.itemKey
  displayName     String // 這筆明細顯示名稱（例如某成員姓名，或「歷代祖先 x3」）

  standardUnitPrice Decimal? @db.Decimal(12, 2) // 報名當下的標準價快照
  actualUnitPrice   Decimal  @db.Decimal(12, 2) // 實際收費單價
  quantity          Int      @default(1)
  subtotal          Decimal  @db.Decimal(12, 2) // = actualUnitPrice * quantity

  priceAdjustedReason String? @db.Text // 實際價 ≠ 標準價時的調整原因

  notes String? @db.Text

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([registrationGroupId])
  @@map("registration_items")
}

/// ★建議新增：收款事件
model Payment {
  id                  String            @id @default(cuid())
  registrationGroupId String
  registrationGroup   RegistrationGroup @relation(fields: [registrationGroupId], references: [id])

  amount        Decimal       @db.Decimal(12, 2)
  paidOn        DateTime      @db.Date
  paymentMethod PaymentMethod
  isRefund      Boolean       @default(false)
  notes         String?       @db.Text

  financeRecord FinanceRecord? // 1:1，一筆 Payment 只產生一筆 FinanceRecord

  createdAt DateTime @default(now())

  @@map("payments")
}

enum PaymentMethod {
  CASH
  BANK_TRANSFER
  OTHER
}

/// ★建議新增：現金／銀行帳戶
model FinancialAccount {
  id                String   @id @default(cuid())
  name              String // 例如「現金」「第一銀行 OOXX」
  type              String // "CASH" | "BANK"
  openingBalance    Decimal  @default(0) @db.Decimal(12, 2)
  openingBalanceOn  DateTime @db.Date
  currentBalance    Decimal  @default(0) @db.Decimal(12, 2) // denormalized，只由已確認的 FinanceRecord 異動更新

  financeRecords FinanceRecord[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("financial_accounts")
}

/// 既有 FinanceRecord 建議擴充的欄位（示意，不是完整 model 定義）
model FinanceRecord {
  // ...既有欄位不變（type/category/amount/occurredOn/description/status/
  //     createdById/voidedById/voidedAt/voidReason/createdAt/updatedAt）

  financialAccountId String
  financialAccount   FinancialAccount @relation(fields: [financialAccountId], references: [id])

  paymentMethod PaymentMethod?

  activityType        ActivityType? // 這筆錢屬於哪個活動；null = 一般雜項收支
  registrationGroupId String? // 可選：來自哪個報名群組

  paymentId String?  @unique // 可選：由哪一筆 Payment 產生；@unique 保證一筆 Payment 只入帳一次
  payment   Payment? @relation(fields: [paymentId], references: [id])
}

/// ★建議新增：南巡/北巡車次設定
model TourVehicle {
  id             String @id @default(cuid())
  activityYearId String

  vehicleNumber Int // 1,2,3,4,5,6,7,8,9
  isEnabled     Boolean @default(true) // 2、4 車預設 false，其餘預設 true
  perPersonPrice Decimal? @db.Decimal(12, 2)
  headcount      Int      @default(0)
  subtotal       Decimal  @default(0) @db.Decimal(12, 2) // = perPersonPrice * headcount

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([activityYearId, vehicleNumber])
  @@map("tour_vehicles")
}

/// ★建議新增：南巡/北巡雙人房加價設定
model TourRoomCharge {
  id             String @id @default(cuid())
  activityYearId String

  perRoomPrice Decimal? @db.Decimal(12, 2)
  roomCount    Int      @default(0)
  subtotal     Decimal  @default(0) @db.Decimal(12, 2) // = perRoomPrice * roomCount

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([activityYearId])
  @@map("tour_room_charges")
}
```

**再次強調：以上全部是提案，本輪不會寫進 `prisma/schema.prisma`，不會產生
migration，不會影響正式資料庫或既有任何一筆資料。**

---

## 十二、建議開發順序

按照這個專案一貫「一次只做一個模組、做完先測試」的方式，建議下一階段（V6.3
之後，等你確認規格與開放進行）依照下列順序拆解，**每一個都可以獨立完成、
獨立測試，不需要一次做完全部**：

1. **`ActivityYear` + `ActivityPriceItem`**（資料模型 + 極簡管理畫面）：
   最基礎，其他一切都要依附年度與價格才能繼續，且風險最低（純新增，不碰
   任何既有資料）。
2. **`FinancialAccount`**（現金/銀行帳戶管理，含期初餘額）：獨立、不依賴
   報名功能，可以提前做。
3. **`RegistrationGroup` + `RegistrationItem`（不含普渡/南北巡特化邏輯，
   先做最通用的版本）**：驗證「報名產生應收、不影響餘額」的核心邏輯。
4. **`Payment` + `FinanceRecord` 擴充**：驗證「收款 → 產生唯一一筆流水帳
   → 更新帳戶餘額」的核心邏輯，這是財務資料正確性最關鍵的一步，建議上線
   前做最多測試。
5. **登入/session 機制**（如果還沒做）：財務資料的權限檢查（`canFinance()`）
   要真正生效，必須先有這一塊，建議排在正式對外開放財務功能之前。
6. **普渡收款特化**（`RegistrationGroup.ritualRecordId` 關聯、四類自動
   產生報名明細）：在通用報名機制穩定之後再做，風險較低。
7. **南巡/北巡（`TourVehicle`/`TourRoomCharge`）**：財務模型最特殊的一塊，
   建議放在通用報名機制驗證過後再做。
8. **年度燈/祭改/宮慶的收款 UI**：規則跟通用報名機制相同，理論上不需要
   額外的資料模型，只是各自的登記畫面。
9. **月流水/銀行餘額報表、活動獨立損益報表**：等前面的資料都能正確產生，
   這裡純粹是查詢/彙總畫面，風險最低，適合放最後。

---

## 十三、風險與尚待確認事項

以下是本輪規格設計時判斷「有不只一種合理做法」的地方，**建議實際開發前
先跟你確認**，避免走錯方向要重做：

1. ~~**`Receivable`（應收）是否需要獨立資料表？**~~ **已解決（V7.0）**：
   V7.0「Finance Core」需求明確把 `Receivable` 列為財務核心九個模型
   之一，已定案為獨立資料表（與 `RegistrationGroup` 一對一），不再是
   彙總欄位。完整定義見 `docs/FINANCE_CORE_SCHEMA.md` 第三節，決策記錄
   見 `docs/ADR.md` ADR-0008。
2. **普渡報名明細的數量是否要跟內部祭祀內容自動同步？** 本規格建議「歷代
   祖先」這類報名明細的數量，直接讀取當下 `UniversalSalvationEntry` 的
   筆數（自動同步，管理者不用維護兩份數字），但如果實務上「報名的份數」
   跟「登記的祖先筆數」不一定完全一致（例如某些祖先不收費、或有免費名額），
   則需要改成手動輸入數量——**這點請確認實際行政流程**。
3. **南巡/北巡的 `TourVehicle`/`TourRoomCharge` 是否要即時同步成
   `RegistrationItem`，還是等「確認」按鈕才產生？** 本規格傾向後者（設定
   階段先在 `TourVehicle` 調整車次/單價/人數，管理者按下「確認本次車資」
   才寫入 `RegistrationItem`，避免調整過程中應收金額一直跳動）——**這點
   請確認是否符合預期的操作體驗**。
4. **代辦人（`agentDisplayName`）如果本身就是既有家戶聯絡人，要不要同時
   當作一筆 `RegistrationItem`？** 例如某人幫自己家人跟朋友一起報名，
   她自己是不是也要出現在報名明細裡——**這點屬於實務認定問題，建議由你
   決定**。
5. **`ActivityType` enum 新增三個值，是否有更精確的中文代稱？** 本規格暫定
   `PURIFICATION`（祭改）、`SOUTHERN_TOUR`（南巡）、`NORTHERN_TOUR`
   （北巡），純粹是程式內部代稱，不影響畫面顯示文字（畫面一律用中文
   label），但如果你有慣用的英文/拼音代稱，可以在正式開發時再統一調整，
   這是 enum 值本身、非資料，改起來成本很低。
6. **是否要在本輪之外，提前規劃登入/session 機制的時程？** 財務模組要
   正式對外開放，`canFinance()` 權限檢查必須要有真正的登入機制才會生效，
   建議在十二節的開發順序中提前規劃，但確切時程要看你的優先順序。
7. **（V6.3 新增）「延用去年報名」的複製邏輯，要不要做成一個獨立的批次
   API？** 這個動作一次涉及三個不同的活動類型（年度燈裡的光明燈項目、
   祭改整個活動、普渡整個活動），現有「複製前一年資料」的既有模式
   （普渡的 `copy-from-previous-year`）是針對單一活動類型設計的；V6.3
   需要的是「同時複製多個活動類型、且同一個活動裡只複製其中一個收費
   項目（光明燈，不含太歲燈）」——建議正式開發時做成一支新的、跨活動
   類型的批次複製 API，而不是把三個既有的單一活動複製 API 疊加呼叫三次
   （疊加呼叫在應收金額彙總與交易一致性上比較容易出錯）——**這點請確認
   是否符合預期，細節見第十五節**。
8. **（V6.3 新增）犯太歲名單要不要允許同一年度重複輸入同一個生肖？**
   本規格建議用 `@@unique([year, zodiac])` 資料庫層級約束禁止重複，
   管理者如果不小心重複新增同一個生肖會直接被擋下來——**這是預設的資料
   完整性保護，不影響「必須可以修改」的要求（新增/刪除一樣自由，只是
   同一個生肖同一年不能有兩筆重複資料）**。
9. **（V6.4 新增）家戶快速報名是否要denormalize `activityType`/`year`
   直接放在 `RegistrationItem` 上？** 這兩個欄位技術上可以透過
   `registrationGroupId → RegistrationGroup → ActivityYear` 關聯查到，
   但你在 V6.4 需求裡明確列出這兩個欄位要直接放在 `RegistrationItem`
   上（方便「查某一年某活動的所有姓名明細」不用多層 join）。本規格採納
   你的欄位需求，直接冗餘存放，但這代表**新增/修改時要靠應用邏輯保證
   `RegistrationItem.year`/`activityType` 跟它所屬 `RegistrationGroup`
   一致**，不是資料庫層級自動保證——**這點請確認是否可接受，或是否要
   改成純關聯查詢（不冗餘存欄位）**。詳見 `docs/FINANCE_CORE_SCHEMA.md`
   與 `docs/ADR.md` ADR-0011。
10. **（V6.4 新增）家戶快速報名是否一定要自動建立
    `RegistrationGroup`？** 本規格傾向「是」（見 4.1 節），讓所有活動
    類型共用同一套財務容器；另一個可能做法是讓 `RegistrationItem` 可以
    不透過 `RegistrationGroup` 獨立存在（`registrationGroupId` 改為可
    空白），但這樣會讓 `Receivable`（目前與 `RegistrationGroup` 一對一）
    失去掛載的地方，財務流程會需要另外設計——**本規格建議維持「自動建立
    輕量群組」的做法，但這是一個判斷而非你明確指定的規則，仍待你確認**。
11. **（V7.1 新增）收款中心相關的尚待確認事項**，包含溢收差額的處理
    路徑、`OVERPAID_PENDING`/`REFUND_PENDING` 的操作權限、已作廢資料的
    預設顯示/隱藏、全家燈是否需要階梯定價——為避免跟
    `docs/COLLECTION_CENTER.md` 第二十四節重複列出，完整內容請直接
    參閱該節，不在此重複。

---

## 十四、本輪確認：本次完全沒有做的事（依你的要求）

- 沒有開發正式財務中心 UI、流水帳畫面。
- 沒有開發年度燈、祭改、南巡/北巡報名畫面、宮慶、普渡收款畫面。
- 沒有開發登入與權限 UI。
- 沒有開發正式收據。
- 沒有新增牌位模板。
- 沒有套用任何 migration，沒有修改正式資料庫，`prisma/schema.prisma`
  本輪**完全沒有變動**（本文件裡的「建議 Schema」只是提案文字，不是
  實際程式碼變更）。
- **（V6.3 新增確認）**沒有開發犯太歲名單管理畫面、信眾提醒畫面、
  「延用去年報名」按鈕與流程，這幾項本輪都只停留在規格文件層級。
- 沒有開始下一個模組的功能開發。

---

## 十五、年度燈與犯太歲規格（V6.3 新增）

### 15.1 年度燈燈種限制

三玄宮的年度燈**只有兩種**：光明燈、太歲燈。**不得預設其他燈種。**

**架構影響**：`ActivityYear`（activityType = `ANNUAL_LANTERN`）底下的
`ActivityPriceItem`，`itemKey` 目錄**限定只能是** `GUANG_MING_LANTERN`
（光明燈）與 `TAI_SUI_LANTERN`（太歲燈）兩種，不像其他活動（例如南巡的
海報贊助/車資/雙人房）itemKey 是開放式、管理者可自由新增——這是行政規則
層級的限制，不需要資料庫欄位強制（`ActivityPriceItem.itemKey` 本身還是
自由字串），而是**畫面/API 邏輯層級**要限制年度燈只能選這兩個固定項目，
不開放「新增自訂燈種」的入口（跟其他活動的「管理者可自由新增收費項目」
明確不同，屬於年度燈專屬的限制，見 `docs/ADMINISTRATION_RULES.md`）。

### 15.2 犯太歲名單（年度、生肖清單，可修改）

每一年度，管理者可以設定當年度犯太歲的生肖（例如 115 年：馬、鼠、雞、
兔）。**不可寫死在程式，必須可以修改。**

**現況**：完全沒有對應資料。系統目前有生肖換算邏輯
（`src/lib/lunar.ts` 的 `getZodiacOptions()` 等，V5.0 建立），但沒有任何
「今年犯太歲的生肖清單」概念。

**建議新增資料表**（提案，本輪不套用）：

```prisma
/// ★建議新增（V6.3）：某年度犯太歲的生肖清單，管理者可自由新增/刪除
model TaiSuiYearZodiac {
  id     String @id @default(cuid())
  year   Int    // 民國年，例如 115
  zodiac String // 生肖，例如「馬」（沿用 src/lib/lunar.ts 既有的生肖字串，
                // 不另外定義新的 enum，維持跟 V5.0 生肖換算邏輯一致）

  createdAt DateTime @default(now())

  @@unique([year, zodiac])
  @@map("tai_sui_year_zodiacs")
}
```

- 用 `@@unique([year, zodiac])` 防止同一年度重複新增同一個生肖，其餘完全
  自由（管理者可以新增任意數量的生肖、可以刪除、可以跨年度各自設定不同
  清單）——完全符合「不可寫死、必須可以修改」的要求。
- `zodiac` 用字串（不用新 enum），沿用 V5.0 `getZodiacOptions()` 已經在
  用的十二生肖字串，確保跟既有生日/生肖換算邏輯的顯示文字一致，不會兩套
  生肖名稱互相對不上。

### 15.3 信眾提醒（本輪僅記錄邏輯，不開發 UI）

搜尋信眾後，系統自動判斷生肖（沿用既有 `lib/lunar.ts` 邏輯）；如果這個
生肖出現在**今年度**的 `TaiSuiYearZodiac` 清單裡，畫面用黃色提醒
「⚠ 本年度犯太歲，建議確認是否安奉太歲燈」；如果不在清單裡，不顯示任何
提醒。

**架構影響**：這是**純查詢/判斷邏輯**，不需要新的資料表——`(當年度,
該信眾的生肖)` 是否存在於 `TaiSuiYearZodiac` 即可判斷，一個簡單的
`WHERE year = ? AND zodiac = ?` 查詢即可，不需要在 `Member` 或
`Household` 上加任何欄位。**本輪不開發這個提醒的畫面**，等你確認規格後
才會實作。

### 15.4 延用去年報名（正式行政流程，本輪僅記錄流程，不開發 UI）

新增正式行政流程，按鈕名稱固定為「**延用去年報名**」（不是「跟去年一
樣」）。按下後，預設帶入：光明燈 ☑、祭改 ☑、普渡 ☑；**不自動帶入太歲燈**。
如果今年是這位信眾生肖的犯太歲年度，系統另外提醒「是否新增太歲燈」。

**架構影響（需要跟你確認，見十三節第 7 項）**：這個動作橫跨三個不同的
`ActivityType`（年度燈／祭改／普渡），且年度燈裡只複製「光明燈」這一個
`itemKey`、不複製「太歲燈」——現有「複製前一年資料」的既有模式（普渡的
`copy-from-previous-year`）是針對**單一活動類型**設計的，不能直接套用。
本規格建議正式開發時，另外做一支**跨活動類型的批次複製 API**（一次呼叫
同時建立/複製年度燈-光明燈、祭改、普渡三個 `RegistrationGroup`，每一個
各自沿用該活動類型既有的複製規則），而不是在前端疊加呼叫三次既有的單一
複製 API——原因是疊加呼叫三次，中間任何一步失敗會造成「複製了一半」的
不一致狀態，一支批次 API 可以包在同一個資料庫交易（transaction）裡，
要嘛三個都成功、要嘛都不動，行政人員不會看到「複製到一半」的錯誤資料。

**「是否新增太歲燈」的另外提醒**：屬於 UI 互動邏輯（判斷條件同 15.3：
今年度 `TaiSuiYearZodiac` 是否包含這位信眾的生肖），不需要額外資料表，
是「延用去年報名」流程裡在光明燈/祭改/普渡都複製完成之後，**再另外跳出
的一個獨立詢問**，即使信眾拒絕，也不影響前面三項已經複製成功的報名。

### 15.5 本節與現有 ER Diagram / 建議 Schema 的關係

`TaiSuiYearZodiac` 是本輪唯一新增的資料表建議，獨立於第十一節已經提出的
`ActivityYear`/`ActivityPriceItem`/`RegistrationGroup` 等表之外，彼此的
關聯只有邏輯上的（透過 `year` 欄位對照），**不需要外鍵關聯**——因為
`TaiSuiYearZodiac` 是宮廟層級「今年誰犯太歲」的事實清單，不屬於任何一筆
`ActivityYear`/`RegistrationGroup` 資料的子資料。第十一節的 ER Diagram
更新如下（僅新增這一張表，其餘完全不變）：

```
★TaiSuiYearZodiac（年度 + 生肖清單，@@unique([year, zodiac])，
                    獨立於 ActivityYear，透過 year 欄位邏輯對照）
```

**本節同樣是提案，本輪不會寫進 `prisma/schema.prisma`、不會產生
migration、不會影響正式資料庫。**
