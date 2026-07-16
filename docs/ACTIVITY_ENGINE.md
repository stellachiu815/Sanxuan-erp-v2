# 台北三玄宮 ERP — Annual Activity Engine（年度活動引擎）規格（V7.0.2）

**狀態：資料模型與行政規格設計，尚未實作、尚未套用 migration、尚未開發
任何 UI/API、尚未部署 Render、尚未變更正式資料庫。**

本文件是繼 `docs/FINANCE_CORE_SCHEMA.md`（V7.0，九個財務核心模型）之後，
針對「年度活動本身如何被建立、設定、排序、開放報名、決定日期」的引擎層
規格。核心目的：**七種年度活動（年度燈/祭改/南巡/宮慶/普渡/補庫/北巡）
的名稱、排序、啟用狀態、報名期間、日期，全部由管理者在資料裡設定，不
寫死在程式碼裡**——包含首頁「目前主打哪個活動」「下一個活動是什麼、
還有幾天」，都要能在不修改任何程式的前提下，單純因為管理者改了資料
就自動反應。

---

## 目錄

1. 設計目標與核心原則
2. `ActivityYear` 擴充欄位總覽
3. 三玄宮預設活動與預設排序
4. 各活動的日期規則
5. 首頁「目前主打活動」切換邏輯
6. 首頁「下一個重要活動」邏輯
7. 神明指定日期（`isDivineAssignedDate`）
8. 活動價格沿用 `ActivityPrice`（不重新設計）
9. 管理者可調整項目（未來 UI/API 需求，本輪不開發）
10. ER Diagram
11. `ActivityYear` 關聯圖
12. 活動生命週期流程圖
13. 建議 Prisma Schema（提案，本輪不套用）
14. 建議開發順序
15. 尚待確認事項
16. 本輪確認：本次完全沒有做的事

---

## 一、設計目標與核心原則

1. **七種活動皆為資料，不是程式碼分支**：年度燈、祭改、南巡、宮慶、
   普渡、補庫、北巡，全部是 `ActivityYear` 資料表裡的資料列，差別只在
   `activityType` 欄位值不同。新增第八種活動（假設未來需要）只需要
   新增一個 `ActivityType` enum 值＋建立對應的 `ActivityYear` 資料，
   不需要改寫首頁邏輯或排序邏輯。
2. **管理者完全控制**：活動名稱、顯示排序、是否啟用、是否開放報名、
   報名起訖日、活動日期、農曆/國曆日期、備註，全部是可由管理者修改的
   資料欄位，沒有一項是寫死在程式碼裡的常數。
3. **首頁不依賴「現在是幾月」做判斷**：首頁邏輯完全依據
   `ActivityYear` 目前的狀態（`isActive`/`isRegistrationOpen`/
   `activityDate` 等）決定要顯示什麼，不會出現「程式寫死 7 月就顯示
   普渡」這種邏輯，因為活動的實際受理起訖與確切日期本來就要由管理者
   逐年設定。
4. **沿用既有財務核心**：本輪只擴充 `ActivityYear` 本身的引擎欄位，
   `ActivityYear` 跟 `ActivityPrice`/`RegistrationGroup`/
   `ActivitySummary` 的既有關聯（V7.0 定案）完全不變，見第八節。

---

## 二、`ActivityYear` 擴充欄位總覽

`ActivityYear`（`docs/FINANCE_CORE_SCHEMA.md` 第三節已定義的模型）本輪
擴充下列欄位，完整 Schema 見第十三節：

| 欄位 | 型別 | 說明 |
|---|---|---|
| `activityName` | `String`（必填） | 活動名稱，預設帶入標準名稱（例如「年度燈」），管理者可修改（例如某年度想改稱「光明燈報名」） |
| `sortOrder` | `Int` | 顯示排序，預設依第三節的固定排序帶入，管理者可修改 |
| `isActive` | `Boolean`（預設 `true`，北巡預設 `false`） | 是否啟用——這一年度是否真的舉辦這個活動 |
| `isRegistrationOpen` | `Boolean`（預設 `false`） | 是否開放報名，獨立於 `isActive`：活動今年有舉辦，但報名期間還沒到之前，`isActive = true` 但 `isRegistrationOpen = false` |
| `registrationStartDate` | `DateTime?` | 報名開始日 |
| `registrationEndDate` | `DateTime?` | 報名截止日 |
| `activityDate` | `DateTime?` | 活動日期（最終定案的正式日期，用於首頁倒數計算），未定案前為空 |
| `lunarDate` | `String?` | 農曆日期文字（例如「六月初六」「七月十八」），可空 |
| `solarDate` | `DateTime?` | 國曆日期，可空 |
| `isDivineAssignedDate` | `Boolean`（預設 `false`） | 南巡/北巡專用：日期是否已由神明指定確認，見第七節 |
| `notes` | `String?` | 備註 |

**`activityDate`/`lunarDate`/`solarDate` 三者的關係（尚待確認事項第 1
項）**：三者都是你明確要求的獨立欄位，本規格的用法是：`activityDate`
是首頁倒數計算實際讀取的欄位（唯一的「權威日期」）；`lunarDate`/
`solarDate` 是輔助顯示用的農曆/國曆文字或日期，對於固定農曆日期的活動
（宮慶/普渡/補庫），`lunarDate` 是固定文字、`solarDate` 是系統依當年
換算出來的結果、`activityDate` 直接等於 `solarDate`；對於北巡這種
以國曆為準的活動，`lunarDate` 可能永遠是空的。這代表 `activityDate`
與 `solarDate` 在多數情況下會是同一個值，存在欄位冗餘，是本輪為了
滿足你明確列出的三個獨立欄位所做的設計，細節列入第十五節尚待確認。

---

## 三、三玄宮預設活動與預設排序

`ActivityYear` 建立新年度時，預設建立七筆資料（種子資料/預設模板，
**不是寫死在程式邏輯裡**，是建立新年度時複製寫入資料庫的初始值，之後
每一筆都可以被管理者個別修改）：

| `sortOrder` | `activityType` | `activityName`（預設） |
|---|---|---|
| 1 | `ANNUAL_LANTERN` | 年度燈 |
| 2 | `PURIFICATION` | 祭改 |
| 3 | `SOUTHERN_TOUR` | 南巡 |
| 4 | `TEMPLE_CELEBRATION` | 宮慶 |
| 5 | `UNIVERSAL_SALVATION` | 普渡 |
| 6 | `TREASURY_REPLENISHMENT` | 補庫 |
| 7 | `NORTHERN_TOUR` | 北巡 |

**`ActivityType` enum 本輪新增一個值**：`TREASURY_REPLENISHMENT`
（補庫）。V7.0 已有的 `ANNUAL_LANTERN`/`PURIFICATION`/`SOUTHERN_TOUR`/
`TEMPLE_CELEBRATION`/`UNIVERSAL_SALVATION`/`NORTHERN_TOUR`/`REPRINT`
七個值不變，本輪只新增「補庫」這一個值。

**與 `docs/FINANCE_AND_ACTIVITY_SPEC.md` 第一節「年度活動固定順序」的
關係**：原本的固定順序是「年度燈→祭改→南巡→宮慶→普渡→北巡」六項，
本輪在「普渡」與「北巡」之間插入「補庫」，變成七項，**不影響原本六項
的相對順序**，該文件本輪已同步更新（見文件內對照）。

**北巡預設 `isActive = false`**：北巡約三年一次，不是每年都舉辦，
所以預設不啟用；哪一年要辦北巡，由管理者當年度手動把該年度北巡的
`ActivityYear.isActive` 改成 `true`。

---

## 四、各活動的日期規則

| 活動 | 日期性質 | 本輪規格 |
|---|---|---|
| 年度燈 | 沒有單一「活動日期」，是一段受理期間 | 通常於農曆年前約一個半月開始受理，`registrationStartDate` 由管理者逐年設定；`activityDate`/`lunarDate`/`solarDate` 通常維持空白（沒有單一活動日的概念，重點在報名期間） |
| 祭改 | 同上，是一段受理期間 | 通常與年度燈同期，`registrationStartDate` 由管理者設定，`activityDate` 通常維持空白 |
| 南巡 | 有明確活動日期，但日期由神明指定、逐年不同 | 約農曆五月，但**正式日期不得寫死**；管理者在神明指定後手動輸入 `lunarDate`/`activityDate`，並將 `isDivineAssignedDate` 改為 `true`（見第七節） |
| 宮慶 | 固定農曆日期 | 農曆六月初六，`lunarDate` 固定文字「六月初六」，`solarDate`/`activityDate` 由管理者每年依換算結果填入（可用既有 `src/lib/lunar.ts` 換算，本輪不開發換算 UI） |
| 普渡 | 固定農曆日期 | 農曆七月十八，`lunarDate` 固定文字「七月十八」，`solarDate`/`activityDate` 同上邏輯 |
| 補庫 | 固定農曆日期 | 農曆十月十五，`lunarDate` 固定文字「十月十五」，`solarDate`/`activityDate` 同上邏輯 |
| 北巡 | 約三年一次，日期由神明指定，但基準是國曆而非農曆 | 通常於國曆耶誕節前後，**正式日期不得寫死**；管理者在神明指定後手動輸入 `solarDate`/`activityDate`，`lunarDate` 通常維持空白，並將 `isDivineAssignedDate` 改為 `true` |

**共同原則**：不管哪一種活動，**日期永遠是資料庫欄位值，不是程式碼裡
的常數**。「固定農曆日期」（宮慶/普渡/補庫）指的是這三個活動每年的
農曆日期本身固定不變，但對應的國曆日期每年不同，且仍然需要管理者
（或未來的年度建立流程）逐年把換算結果寫入 `ActivityYear`，系統不會
自動假設「這個活動永遠是某月某日」。

---

## 五、首頁「目前主打活動」切換邏輯

**目標**：首頁不依照「現在是國曆幾月」判斷要顯示什麼活動，而是完全
依據 `ActivityYear` 的狀態自動決定。

**判斷規則（提案）**：

1. 撈出**今年度**（可延伸到明年度處理跨年邊界）所有 `isActive = true`
   的 `ActivityYear`。
2. 在這些啟用的活動中，找出**目前正在「受理中」或「即將舉行」的活動**：
   - 若某活動的 `registrationStartDate <= 今天 <= (activityDate 或
     registrationEndDate，取較晚者)`，代表這個活動「正在進行中」，是
     目前的主打活動。
   - 若同時有多個活動符合（例如年度燈與祭改本來就常常同期受理），
     依 `sortOrder` 由小到大排序，`sortOrder` 最小的當作「主要」顯示
     （例如年度燈優先於祭改），但**兩者都算「目前啟用」**，首頁畫面
     要不要同時顯示兩者、或只顯示一個主要+其餘列在旁邊，屬於之後
     UI 設計的決定，本輪只定義資料判斷邏輯。
3. 若没有任何活動的受理區間包含今天，則「目前主打活動」退回第六節
   「下一個重要活動」的邏輯（顯示最接近的下一個活動，附註「即將開始」
   或「等待管理者設定」）。

**範例對照你給的情境**：若「宮慶」的 `registrationStartDate` 已過、
`activityDate`（換算後的國曆日期）還沒到，畫面主打宮慶；等宮慶
`activityDate` 過了，且「普渡」的 `registrationStartDate` 已到，畫面
自動切換成主打普渡——**這整個切換不需要修改任何程式碼**，因為兩個
活動的日期本來就是各自 `ActivityYear` 資料列裡的欄位值，系統只是
用同一套查詢邏輯，依「今天」跟這些欄位比較而已。

---

## 六、首頁「下一個重要活動」邏輯

**目標**：首頁固定顯示一個「下一個重要活動」小工具，顯示活動名稱、
倒數天數、日期（或「等待管理者設定」）。

**判斷規則（提案）**：

1. 把七種活動依 `sortOrder` 視為一個**循環的年度序列**（北巡走完接回
   年度燈，形成環狀順序）。
2. 從「今天」開始，在這個循環序列裡往後找，找到序列中第一個
   `isActive = true` 且「尚未發生」的活動：
   - 「尚未發生」的判斷：若 `activityDate` 有值，看 `activityDate` 是
     否 `>= 今天`；若 `activityDate` 為空（例如南巡/北巡尚未經神明
     指定，或年度燈/祭改這種沒有單一活動日的活動），則用
     `registrationEndDate`（若有）或直接視為「本年度此活動尚未結束」
     來判斷是否已經跳過。
   - 若序列走完一輪（跨過北巡）都沒找到，代表今年度活動都已結束，
     改查**明年度**的 `ActivityYear`，從 `sortOrder` 最小的開始找。
3. 找到的活動：
   - 若 `activityDate` 有值 → 顯示活動名稱、`activityDate` 與今天的
     天數差（倒數天數）、`lunarDate`（若有）。
   - 若 `activityDate` 為空 → 顯示活動名稱＋「**等待管理者設定**」，
     不顯示倒數天數（因為沒有日期可以倒數）。

**範例對照你給的情境**：「下一個活動：普渡，距離：38天，日期：農曆
七月十八」——即找到序列中普渡是下一個尚未發生、且已有 `activityDate`
的活動，直接算天數差；如果換成南巡還沒被神明指定日期，则顯示「下一個
活動：南巡，等待管理者設定」。

---

## 七、神明指定日期（`isDivineAssignedDate`）

南巡、北巡的正式日期都不是行政單位自己決定，而是要等宮廟神明指定，
因此新增 `isDivineAssignedDate` 布林欄位（其他活動類型此欄位固定為
`false`，因為它們的日期不是「神明指定」性質）：

- `isDivineAssignedDate = false`（預設）：首頁顯示「**等待神明指定
  日期**」，即使管理者已經預先填了 `lunarDate`/`activityDate` 的草稿
  值，只要這個欄位還是 `false`，首頁一律視為尚未確認。
- `isDivineAssignedDate = true`：代表神明已指定、管理者已經正式輸入
  日期，首頁顯示「**日期已確認**」，並且第六節的倒數計算才會採用
  `activityDate` 顯示天數。

**與 `activityDate` 是否為空的差異**：`activityDate` 為空代表「連草稿
日期都還沒有」；`isDivineAssignedDate = false` 但 `activityDate` 有值
代表「行政人員已經預先抓一個可能的日期方便準備，但還沒有正式定案」，
這個區分讓行政人員可以提前準備（例如先抓農曆五月中的某個週末排車），
但首頁不會誤導信眾以為日期已經確定。

---

## 八、活動價格沿用 `ActivityPrice`（不重新設計）

`ActivityPrice`（V7.0 已定案，見 `docs/FINANCE_CORE_SCHEMA.md` 第三節）
完全沿用，**本輪不新增欄位、不修改設計**。`ActivityPrice` 本來就是
`activityYearId` 底下的年度標準價格項目，`ActivityYear` 本輪的擴充
（名稱/排序/啟用/報名期間/日期）跟價格是兩件互相獨立的事——同一個
`ActivityYear` 資料列，同時擁有「這個活動今年何時受理、何時舉行」
（本輪新增）跟「這個活動今年每個收費項目多少錢」（`ActivityPrice`，
V7.0 已有）兩組資訊，互不影響。

---

## 九、管理者可調整項目（未來 UI/API 需求，本輪不開發）

未來管理端功能需要支援（本輪只記錄需求，不開發）：

- 新增年度（把七種活動的 `ActivityYear` 一次性建立好，可從前一年度
  複製排序/名稱等設定，但日期/報名期間需要重新設定，不應該直接複製
  去年的具體日期）。
- 修改日期（`registrationStartDate`/`registrationEndDate`/
  `activityDate`/`lunarDate`/`solarDate`）。
- 修改排序（`sortOrder`）。
- 修改是否開放（`isRegistrationOpen`）。
- 修改是否啟用（`isActive`）。
- 修改活動說明（`activityName`/`notes`）。

**全部透過修改 `ActivityYear` 資料列完成，不需要修改任何程式碼**——
這是本輪「管理者完全控制」設計原則（第一節）的具體落實。

---

## 十、ER Diagram

```
ActivityYear（本輪擴充，@@unique([year, activityType])）
    │  activityName / sortOrder / isActive / isRegistrationOpen /
    │  registrationStartDate / registrationEndDate / activityDate /
    │  lunarDate / solarDate / isDivineAssignedDate / notes
    │
    ├──1───N ActivityPrice（年度標準價格，V7.0 已定案，本輪不變）
    │
    ├──1───N RegistrationGroup（報名群組，V7.0 已定案，本輪不變）
    │
    └──1:1  ActivitySummary（活動統計，V7.0 已定案，本輪不變）

ActivityType（enum，本輪新增 TREASURY_REPLENISHMENT）：
  ANNUAL_LANTERN / PURIFICATION / SOUTHERN_TOUR / TEMPLE_CELEBRATION /
  UNIVERSAL_SALVATION / TREASURY_REPLENISHMENT（★新增） /
  NORTHERN_TOUR / REPRINT
```

**本節與 `docs/FINANCE_CORE_SCHEMA.md` 第二節 ER Diagram 的關係**：
財務核心的 ER Diagram 畫的是 `ActivityYear` 跟 `ActivityPrice`/
`RegistrationGroup`/`ActivitySummary` 的財務關聯，本節補上
`ActivityYear` 自己內部（引擎層）的欄位擴充，兩份 ER Diagram 合起來
才是 `ActivityYear` 的完整圖像，`FINANCE_CORE_SCHEMA.md` 已加註指向
本文件（見該文件 `ActivityYear` model 註解）。

---

## 十一、`ActivityYear` 關聯圖

```
                         ┌───────────────────────────┐
                         │   ActivityYear（本輪核心） │
                         │   一年、一種活動類型一筆    │
                         └─────────────┬─────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
              ▼                        ▼                        ▼
      ActivityPrice[]          RegistrationGroup[]        ActivitySummary?
   （這個活動今年的標準價格）  （這個活動今年的報名/收款）  （這個活動今年的統計）
              │                        │
              │                        └──1───N RegistrationItem
              │                                       │
              └───（報名時的 standardUnitPrice 快照）──┘

七筆 ActivityYear（同一年度，不同 activityType）彼此之間沒有外鍵關聯，
只透過「同一個 year 值」邏輯上屬於同一個年度；sortOrder 決定它們在
畫面/報表上的顯示順序，isActive/isRegistrationOpen/日期欄位各自獨立
控制每一個活動自己的狀態，互不影響（例如宮慶開放報名，不會影響普渡的
isRegistrationOpen）。
```

---

## 十二、活動生命週期流程圖

```
① 建立新年度
   管理者觸發「建立 115 年度活動」
   → 系統依第三節預設模板，建立 7 筆 ActivityYear
     （activityName/sortOrder 帶入預設值，isActive 除北巡外預設 true，
      isRegistrationOpen 預設 false，日期欄位全部留空）

② 設定日期與報名期間
   管理者針對每個活動個別設定：
   - 宮慶/普渡/補庫：換算固定農曆日期的對應國曆日期，填入
     lunarDate/solarDate/activityDate
   - 年度燈/祭改：設定 registrationStartDate（通常農曆年前一個半月）
   - 南巡/北巡：等神明指定後才填入日期，並將 isDivineAssignedDate
     改為 true（指定前，isDivineAssignedDate 維持 false，首頁顯示
     「等待神明指定日期」）

③ 開放報名
   管理者將該活動 isRegistrationOpen 改為 true
   → 首頁依第五節邏輯自動切換主打此活動
   → 家戶快速報名／代辦人報名（V6.4 既有流程）開始可以對這個
     ActivityYear 建立 RegistrationGroup/RegistrationItem

④ 報名與收款（沿用既有財務核心主流程，本輪不重複定義）
   RegistrationItem → Receivable → Payment → LedgerEntry
   → FinancialAccount 更新 → ActivitySummary 重新彙總
   （完整流程見 docs/FINANCE_CORE_SCHEMA.md 第四節）

⑤ 報名截止 / 活動結束
   管理者將 isRegistrationOpen 改回 false（活動本身仍是 isActive，
   只是不再開放新報名）
   → 首頁第五節邏輯不再判定此活動為「受理中」
   → 第六節「下一個重要活動」邏輯自動往序列下一個活動前進

⑥ 年度結束 / 準備下一年度
   等所有活動都結束後，管理者重複步驟①建立下一個年度的 ActivityYear
   （不會覆蓋今年度的資料，年度之間透過 year 欄位完全隔離，沿用 V5.1
   「每一年互不覆蓋」的既有保證）
```

---

## 十三、建議 Prisma Schema（提案，本輪不套用 migration，不影響正式資料庫）

```prisma
// ============================================================
// V7.0.2 Annual Activity Engine —— 本區塊完整提案，本輪不寫入
// prisma/schema.prisma、不產生 migration、不影響正式資料庫。
// 本區塊是對 docs/FINANCE_CORE_SCHEMA.md 已定案的 ActivityYear 的
// 擴充提案，不是另建新表。
// ============================================================

/// ActivityType 本輪新增一個值：TREASURY_REPLENISHMENT（補庫）。
/// 其餘七個既有值（V7.0 定案）維持不變。
enum ActivityType {
  ANNUAL_LANTERN          // 年度燈
  PURIFICATION            // 祭改
  SOUTHERN_TOUR           // 南巡
  TEMPLE_CELEBRATION      // 宮慶
  UNIVERSAL_SALVATION     // 普渡
  TREASURY_REPLENISHMENT  // 補庫（V7.0.2 新增）
  NORTHERN_TOUR           // 北巡（三年一次）
  REPRINT                 // 補印（既有值，不涉及本輪引擎邏輯）
}

/// 某年度、某活動的完整引擎設定（V7.0 定義了財務關聯部分，
/// V7.0.2 本輪擴充活動引擎欄位）
model ActivityYear {
  id           String       @id @default(cuid())
  year         Int          // 民國年
  activityType ActivityType

  /// V7.0.2 新增：活動引擎欄位
  activityName          String    // 活動名稱，預設帶入標準名稱，管理者可修改
  sortOrder             Int       @default(0) // 顯示排序
  isActive              Boolean   @default(true) // 是否啟用（北巡預設 false，見下方 ADR-0012 對照 V7.0 isHeld 的整併說明）
  isRegistrationOpen    Boolean   @default(false) // 是否開放報名
  registrationStartDate DateTime?
  registrationEndDate   DateTime?
  activityDate          DateTime? // 活動日期（首頁倒數計算的權威欄位）
  lunarDate             String?   // 農曆日期文字，例如「六月初六」
  solarDate             DateTime? // 國曆日期
  isDivineAssignedDate  Boolean   @default(false) // 南巡/北巡專用：日期是否已由神明指定確認

  notes String? @db.Text

  prices             ActivityPrice[]
  registrationGroups RegistrationGroup[]
  summary            ActivitySummary?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([year, activityType])
  @@index([year, isActive])
  @@index([year, sortOrder])
  @@map("activity_years")
}
```

**與 V7.0 `ActivityYear` 定義的差異**：V7.0 原本只有
`id`/`year`/`activityType`/`isHeld`/`notes` 五個欄位（見
`docs/FINANCE_CORE_SCHEMA.md` 第三節）。本輪新增
`activityName`/`sortOrder`/`isRegistrationOpen`/
`registrationStartDate`/`registrationEndDate`/`activityDate`/
`lunarDate`/`solarDate`/`isDivineAssignedDate` 九個欄位，並**建議把
`isHeld` 整併為 `isActive`**（兩者語意重疊：都是「這個活動今年是否
舉辦」），這是本輪的判斷，列入第十五節尚待確認事項，等你確認後才會
正式反映到 `FINANCE_CORE_SCHEMA.md` 的定案版本。

---

## 十四、建議開發順序

延續 `docs/FINANCE_CORE_SCHEMA.md` 第八節的開發順序規劃，本輪引擎欄位
建議在「階段 1：`ActivityYear` + `ActivityPrice`」這一步**一起**做
（本來就是同一張表的欄位擴充，不需要拆成獨立階段）：

1. `ActivityYear` 擴充欄位（本輪規格）＋ `ActivityPrice`：一次到位，
   包含建立新年度的預設模板邏輯（第三節七筆預設資料）。
2. 首頁查詢邏輯（第五、六節的判斷規則）：純查詢，不影響任何寫入，
   建議在通用報名機制之前先做，方便及早在畫面上驗證「不寫死月份」
   的效果。
3. 神明指定日期的管理端輸入介面（第七節）：南巡/北巡專用，可以晚一點
   做，不影響其他活動。
4. 其餘沿用 `docs/FINANCE_CORE_SCHEMA.md` 第八節既定順序（`Receivable`
   → `Payment`+`LedgerEntry` → ... ）。

---

## 十五、尚待確認事項

1. **`activityDate`/`lunarDate`/`solarDate` 三欄位是否有冗餘？**
   多數情況下 `activityDate` 會等於 `solarDate`（見第二節說明），本輪
   採納你明確列出的三個獨立欄位，但這代表資料一致性要靠應用邏輯維護
   （修改 `solarDate` 時要記得同步 `activityDate`，除非兩者本來就是
   同一個查詢/顯示概念、只是本規格暫時分開命名）——**這點請確認是否
   接受，或是否要合併成單一欄位**。
2. **`isActive` 是否要正式取代 V7.0 的 `isHeld`？** 本規格建議整併（見
   第十三節），因為兩者語意重疊，但這代表 V7.0 已定案的 Schema 需要
   做一次欄位改名，正式套用 migration 時會是一個 `rename column` 動作
   ——**這點請確認是否符合預期，或是否想保留 `isHeld` 並讓 `isActive`
   是完全獨立的另一個概念**。
3. **多個活動同時「受理中」時，首頁畫面要不要同時顯示？** 第五節提到
   年度燈/祭改常常同期受理，本規格只定義了資料查詢邏輯（依 `sortOrder`
   排序），實際首頁要顯示一個主打+其餘列表、還是輪播、还是別的呈現
   方式，屬於未來 UI 設計階段的決定，本輪不涉及。
4. **建立新年度時，七筆預設資料要不要自動複製上一年度的
   `activityName`/`sortOrder`（但不複製日期）？** 本規格第十二節①
   步驟建議是，但這屬於未來「建立新年度」API 的實作細節，本輪只記錄
   建議方向。
5. **年度切換的邊界情況**：例如 12 月北巡日期還沒到、但已經跨年進入
   下一個民國年，「今天」算今年度還是明年度？本規格第六節建議「今年度
   序列走完才查明年度」，但實際「今年度」的定義（民國年 vs 國曆年）
   需要在正式開發時對照 `src/lib/lunar.ts` 既有的年度換算邏輯一併
   確認。

---

## 十六、本輪確認：本次完全沒有做的事

- 沒有開發收款中心 UI、財務 UI、流水帳 UI、年度燈 UI、普渡 UI、南巡
  UI、北巡 UI、宮慶 UI。
- 沒有開發任何 API。
- 沒有套用任何 migration，沒有修改正式資料庫，`prisma/schema.prisma`
  本輪完全沒有變動（本文件的 Schema 全部是提案文字）。
- 沒有部署 Render、沒有推送 GitHub。
- 沒有執行 `npm install`/`prisma generate`/`next build`。
- 沒有開始 V7.1。
