# 台北三玄宮 ERP — Finance Core（財務核心）正式資料架構（V7.0 / V6.4 / V7.0.3 / V7.1 更新）

**狀態：資料模型與 Schema 設計定案，尚未實作、尚未套用 migration、尚未
開發任何 UI/API、尚未執行 Build、尚未變更正式資料庫。**

本文件是 `docs/FINANCE_AND_ACTIVITY_SPEC.md`（V6.2/V6.3，記錄「為什麼這樣
設計」的業務規則分析）跟 `docs/ADMINISTRATION_RULES.md`（V6.3，行政操作
規則）之後的**正式收斂版本**：把前兩輪的「建議 Schema」提案，定案成
V7.0 要求的九個財務核心資料模型，並補上完整 ER Diagram、資料流程圖、
模組相依圖。**本文件是目前財務核心 Schema 的權威版本**，之後如果
`FINANCE_AND_ACTIVITY_SPEC.md` 裡的提案 Schema 內容跟本文件有出入，
以本文件為準（並會在該文件加註參照）。

**V6.4 更新重點**：`RegistrationItem` 新增 `activityType`/`year`（冗餘
存放）、`sourceHouseholdId`/`sourceMemberId`（快速報名來源）、
`isTemporaryName`（臨時姓名）、`status`（新 enum
`RegistrationItemStatus`，取消＝狀態改變不是刪除）欄位，支援「家戶快速
報名、姓名層級儲存」的操作模式，詳見第十節；ER Diagram（第二節）已
同步標註。架構決策見 `docs/ADR.md` ADR-0011。

**V7.0.3 更新重點**：`Payment` 新增 `financialAccountId`（收款當下就指定
現金/銀行帳戶）、`payerName`（付款人）欄位，支援「報名當下立即付款」——
報名完成計價後，系統可以走「先存為未繳」（只建立 `Receivable`）或「立即
收款」（同一步再建立 `Payment`）兩種路徑，詳見第四節 4.5 小節；狀態
（`PARTIAL`/`PAID`/`REFUND_PENDING`）依實收金額 vs 應收金額自動計算，
沿用既有 `ReceivableStatus` enum、不新增值。架構決策見 `docs/ADR.md`
ADR-0013。

**V7.1 更新重點**：本文件不再是「收款/付款狀態」欄位層級的權威版本——
`docs/COLLECTION_CENTER.md`（新文件）正式把 `ReceivableStatus` 擴充為
7 個狀態值、`Payment` 擴充 `registrationGroupId`/`payerNameSnapshot`
（正式改名自 `payerName`）/`payerMemberId`/`payerHouseholdId`/`status`
（新 enum `PaymentStatus`）/`createdById` 欄位，並新增
`FamilyLampGroup`/`FamilyLampMember`（全家燈整組計價）、
`QuickCollectionEntry`（快速收款）兩個新模型。本文件下方第三節的
Prisma Schema 保留 V7.0 定案時的版本作為歷史脈絡與九個核心模型的
權威定義（模型本身，例如 `RegistrationGroup`/`RegistrationItem`/
`Receivable`/`FinancialAccount`/`LedgerEntry`/`ActivitySummary` 沒有
被推翻），但涉及**收款/付款狀態欄位**的最新定案內容一律以
`docs/COLLECTION_CENTER.md` 為準。架構決策見 `docs/ADR.md`
ADR-0014、ADR-0015。

---

## 目錄

1. 九個財務核心資料模型總覽
2. ER Diagram（完整版）
3. 完整 Prisma Schema（提案，本輪不套用）
4. 資料流程圖
5. 模組相依圖
6. 哪些資料可以沿用
7. 哪些資料要新增
8. 開發順序
9. 本輪對 V6.2 尚待確認事項的處理
10. 家戶快速報名與姓名明細的 Schema 擴充（V6.4 新增）
11. 本輪確認：本次完全沒有做的事（依你的要求，涵蓋 V7.0 + V6.4 + V7.0.3）

> **V7.1 附註**：收款中心相關的狀態/欄位擴充與新模型，已移至新文件
> `docs/COLLECTION_CENTER.md` 統一說明，本文件第三節 `ReceivableStatus`
> enum 與 `Payment` model 上方均已加註指向該文件的對應章節。

---

## 一、九個財務核心資料模型總覽

| # | 模型 | 用途 |
|---|---|---|
| 1 | `ActivityYear` | 某年度、某活動是否舉辦（宮廟層級，非家戶層級），是價格與報名的年度容器 |
| 2 | `ActivityPrice` | 某年度、某活動的標準收費項目與單價（V6.2 稱 `ActivityPriceItem`，V7.0 正式定名為 `ActivityPrice`） |
| 3 | `RegistrationGroup` | 代辦群組：一位代辦人／功德主底下可以包含不同家戶（例如功德主林美玲底下有王家、陳家、李家） |
| 4 | `RegistrationItem` | 報名明細：活動、年度、單價、數量、小計、真正祭祀對象、真正家戶 |
| 5 | `Receivable` | 應收：付款狀態（未繳/部分繳款/已繳清/退款），**不得更新銀行** |
| 6 | `Payment` | 收款：只有真正收款才建立，**才可以**更新銀行/現金/流水帳；V7.0.3 新增 `financialAccountId`（收款帳戶）/`payerName`（付款人），支援報名當下立即付款 |
| 7 | `FinancialAccount` | 現金／銀行帳戶：期初、收入、支出、目前餘額全部自動計算 |
| 8 | `LedgerEntry` | 流水：任何 `Payment` 自動建立，不得人工重複建立 |
| 9 | `ActivitySummary` | 活動統計：每個活動自動統計應收/已收/未收/支出/結餘，本輪不做畫面 |

**這九個模型跟三個既有的規劃是同一批財務核心的一部分**：`TaiSuiYearZodiac`
（V6.3 新增，犯太歲名單）、`TourVehicle`／`TourRoomCharge`（V6.2 新增，
南巡北巡車次/雙人房），完整 Schema 見第三節。

---

## 二、ER Diagram（完整版）

```
Household 1───N Member
    │                │
    │                └──────────────────────────┐
    └──1───N RitualRecord（既有，不變）           │
    │             │                              │
    │             └──1:1── UniversalSalvationDetail ──1:N── UniversalSalvationEntry
    │                                             │
    └──1───N RegistrationItem ──N:1───────────────┘
                  │        （householdId／memberId 連回真正的家戶/成員；
                  │         sourceHouseholdId／sourceMemberId 記錄快速報名
                  │         來源，V6.4 新增，見下方★標示；isTemporaryName／
                  │         status／activityType／year 亦為 V6.4 新增欄位）
                  │
                  N
                  │
                  1
        RegistrationGroup ───可選 ritualRecordId───▶ RitualRecord（普渡時關聯回內部祭祀主檔）
                  │  （★兩種模式共用同一個容器，見 FINANCE_AND_ACTIVITY_SPEC.md 4.1／ADR-0011：
                  │    ①代辦人模式：普渡專用，一位代辦人跨不同家戶，例如林美玲底下有王家/陳家/李家
                  │    ②家戶快速報名模式：V6.4 新增，年度燈/祭改專用，同一戶按姓名勾選，
                  │      系統自動建立輕量 RegistrationGroup（每個「家戶＋活動類型＋年度」一組），
                  │      agentDisplayName 預設帶入戶長姓名或「○○○一家」，僅供顯示追蹤用途）
                  │
                  N───1  ActivityYear（宮廟層級，@@unique([year, activityType])）
                              │
                              ├──1───N ActivityPrice（年度標準價格，可複製前一年）
                              │
                              └──1:1  ActivitySummary（活動統計：應收/已收/未收/支出/結餘，自動彙總）

RegistrationGroup ──1:1── Receivable（應收：totalAmount/paidAmount/refundAmount/status，不碰銀行帳戶）
                                │
                                └──1───N Payment（真正收款事件：★V7.0.3 新增 financialAccountId／payerName，
                                              │    支援「報名當下立即付款」，見 4.5 節）
                                              ├──N:1── FinancialAccount（★V7.0.3：Payment 直接指定收款帳戶）
                                              │
                                              └──1:1── LedgerEntry（流水分錄，一筆 Payment 只產生一筆，
                                                            │        financialAccountId 沿用 Payment 的選擇）
                                                            └──N:1── FinancialAccount（現金/銀行帳戶，期初+自動彙總收支=目前餘額）

TourVehicle（南巡/北巡車次設定：車號/是否啟用/單價/人數/小計）─┐
TourRoomCharge（雙人房加價設定：每間價格/間數/小計）───────────┼─（確認後）寫入對應的 RegistrationItem
海報贊助（自由金額）───────────────────────────────────────────┘

TaiSuiYearZodiac（V6.3：年度 + 生肖清單，@@unique([year, zodiac])，
                   獨立表，透過 year 邏輯對照 ActivityYear，無外鍵關聯）

AuditLog（既有，通用 entityType/entityId，涵蓋以上所有新表的異動記錄）
User / Role / permissions.ts（既有，不變；LedgerEntry 的 createdBy/voidedBy 關聯回 User）
```

---

## 三、完整 Prisma Schema（提案，本輪不套用 migration，不影響正式資料庫）

```prisma
// ============================================================
// V7.0 Finance Core（財務核心）—— 本區塊完整提案，本輪不寫入
// prisma/schema.prisma、不產生 migration、不影響正式資料庫。
// ============================================================

/// ActivityType 需新增三個值（V6.2 已提案）：PURIFICATION（祭改）、
/// SOUTHERN_TOUR（南巡）、NORTHERN_TOUR（北巡）。既有四個值不變。
enum ActivityType {
  ANNUAL_LANTERN          // 年度燈
  PURIFICATION            // 祭改（新增）
  SOUTHERN_TOUR           // 南巡（新增）
  TEMPLE_CELEBRATION      // 宮慶
  UNIVERSAL_SALVATION     // 普渡
  TREASURY_REPLENISHMENT  // 補庫（V7.0.2 新增，見 docs/ACTIVITY_ENGINE.md）
  NORTHERN_TOUR           // 北巡（新增，三年一次）
  REPRINT                 // 補印（既有值，財務核心本輪不涉及補印收費，保留不動）
}

/// 某年度、某活動是否舉辦（宮廟層級，非家戶層級）
/// V7.0.2 更新：本模型的完整「年度活動引擎」欄位擴充（活動名稱/顯示排序/
/// 是否啟用/是否開放報名/報名起訖日/活動日期/農曆國曆日期/神明指定日期
/// 標記）已移到 docs/ACTIVITY_ENGINE.md 規劃，該文件是這些引擎欄位的
/// 權威版本；本檔案這裡保留 V7.0 定案時的基礎欄位版本，作為財務關聯的
/// 參照起點，實際欄位以 ACTIVITY_ENGINE.md 第十三節為準（含 isHeld 是否
/// 整併為 isActive 的尚待確認事項）。
model ActivityYear {
  id           String       @id @default(cuid())
  year         Int          // 民國年
  activityType ActivityType
  isHeld       Boolean      @default(true) // 北巡預設 false，其餘預設 true（V7.0.2 提案整併為 isActive，見 ACTIVITY_ENGINE.md）
  notes        String?      @db.Text

  prices             ActivityPrice[]
  registrationGroups RegistrationGroup[]
  summary            ActivitySummary?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([year, activityType])
  @@map("activity_years")
}

/// 年度標準收費項目（V6.2 稱 ActivityPriceItem，V7.0 正式定名 ActivityPrice）
model ActivityPrice {
  id             String       @id @default(cuid())
  activityYearId String
  activityYear   ActivityYear @relation(fields: [activityYearId], references: [id], onDelete: Cascade)

  itemKey   String  // 例如 "GUANG_MING_LANTERN" / "TAI_SUI_LANTERN" /
                     // "ANCESTOR_LINE" / "BUS_SEAT" / "DOUBLE_ROOM" / "POSTER_SPONSOR"
  itemLabel String  // 顯示名稱
  unitPrice Decimal? @db.Decimal(12, 2) // 可為空：贊普/白米/海報贊助這類「不設定固定價格」的項目
  sortOrder Int      @default(0)
  isActive  Boolean  @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([activityYearId, itemKey])
  @@map("activity_prices")
}

/// 代辦群組：一位代辦人／功德主底下可以包含不同家戶
model RegistrationGroup {
  id             String       @id @default(cuid())
  activityYearId String
  activityYear   ActivityYear @relation(fields: [activityYearId], references: [id])

  ritualRecordId String? // 普渡時可選關聯回既有 RitualRecord（內部祭祀內容主檔）

  agentDisplayName String  // 代辦人／功德主姓名（自由輸入）
  agentHouseholdId String? // 可選：代辦人剛好是既有家戶聯絡人
  agentMemberId    String? // 可選：代辦人剛好是既有成員

  notes String? @db.Text

  items      RegistrationItem[]
  receivable Receivable?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([activityYearId])
  @@map("registration_groups")
}

/// 姓名層級報名明細的狀態。取消＝狀態改變，不是刪除，允許之後重新勾選
/// 復原（見 docs/ADR.md ADR-0011、docs/ADMINISTRATION_RULES.md 11.8）。
enum RegistrationItemStatus {
  ACTIVE     // 今年此活動有效報名
  CANCELLED  // 曾經報名過（或去年有），今年取消勾選，保留歷史紀錄
}

/// 報名明細：每一筆都要連回真正的家戶/成員
model RegistrationItem {
  id                  String            @id @default(cuid())
  registrationGroupId String
  registrationGroup   RegistrationGroup @relation(fields: [registrationGroupId], references: [id], onDelete: Cascade)

  /// V6.4 新增：activityType/year 冗餘存放在 RegistrationItem 上，方便
  /// 「查某一年某活動的所有姓名明細」不用多層 join。技術上可從
  /// registrationGroupId → RegistrationGroup → ActivityYear 查到，這裡
  /// 冗餘存放是採納你在 V6.4 明確列出的欄位需求（見
  /// FINANCE_AND_ACTIVITY_SPEC.md 十三節第 9 項）——**代價是新增/修改時
  /// 要靠應用邏輯保證這兩欄跟所屬 RegistrationGroup 一致，不是資料庫層級
  /// 自動保證**，仍待你確認是否可接受。
  activityType ActivityType
  year         Int

  householdId String?    // 大多數情況必填；冤親債主/無緣子女等非真實成員項目可為空
  household   Household? @relation("RegistrationItemHousehold", fields: [householdId], references: [id])
  memberId    String?
  member      Member?    @relation("RegistrationItemMember", fields: [memberId], references: [id])

  /// V6.4 新增：家戶快速報名情境下的「來源」標記，跟 householdId/memberId
  /// 不同——householdId/memberId 是這筆明細目前連回的正式家戶/成員（可能
  /// 事後補上），sourceHouseholdId/sourceMemberId 是「這筆明細最初是從
  /// 哪一戶的快速帶入畫面新增的」，即使當事人不屬於該家戶正式成員也會
  /// 保留這個來源記錄，供之後查詢/追溯用（見 ADR-0011 第 4 點）。
  sourceHouseholdId String?
  sourceHousehold   Household? @relation("RegistrationItemSourceHousehold", fields: [sourceHouseholdId], references: [id])
  sourceMemberId    String?
  sourceMember      Member?    @relation("RegistrationItemSourceMember", fields: [sourceMemberId], references: [id])

  /// V6.4 新增：臨時姓名（尚無正式信眾資料、可能是親友、可能只報名一次）。
  /// 為 true 時 memberId 通常為空，displayName 才是唯一可靠的姓名來源；
  /// 之後若確認為既有信眾，可以事後補上 memberId 重新連結，但不得回頭
  /// 修改這筆歷史紀錄原本的活動內容/金額（見 ADR-0011 第 4 點）。
  isTemporaryName Boolean @default(false)

  /// V6.4 新增：見上方 RegistrationItemStatus。取消勾選＝CANCELLED，
  /// 不刪除資料；重新勾選＝改回 ACTIVE。
  status RegistrationItemStatus @default(ACTIVE)

  /// V6.4 更新：沿用既有 chargeItemKey 欄位名稱（對應
  /// ActivityPrice.itemKey），與你 V6.4 需求文字裡使用的「itemType」是
  /// 同一個概念的不同稱呼——本文件維持既有的 chargeItemKey 命名以避免
  /// 跟 V7.0 已定案的 Schema 產生兩套用詞，如果你偏好正式改名為
  /// itemType，屬於欄位改名、不影響資料結構，可在正式開發前再統一調整。
  chargeItemKey String // 對應 ActivityPrice.itemKey（＝你需求中的 itemType）
  displayName   String // 這筆明細顯示名稱（必填，臨時姓名時尤其重要）

  standardUnitPrice Decimal? @db.Decimal(12, 2) // 報名當下的標準價快照
  actualUnitPrice   Decimal  @db.Decimal(12, 2) // 實際收費單價
  quantity          Int      @default(1)
  subtotal          Decimal  @db.Decimal(12, 2) // = actualUnitPrice * quantity

  priceAdjustedReason String? @db.Text // 實際價 ≠ 標準價時的調整原因
  notes               String? @db.Text

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([registrationGroupId])
  @@index([householdId, activityType, year])
  @@index([memberId, activityType, year])
  @@map("registration_items")
}

/// V7.1 更新：本 enum 在「收款中心」規格（docs/COLLECTION_CENTER.md）
/// 正式擴充為 7 個狀態值（未繳/部分繳款/已繳清/溢收待處理/退款待處理/
/// 已退款/已作廢），本檔案這裡保留 V7.0 定案時的 4 值版本作為歷史脈絡，
/// 實際欄位以 COLLECTION_CENTER.md 第三節為準，見 ADR-0014。
enum ReceivableStatus {
  UNPAID          // 未繳
  PARTIAL         // 部分繳款
  PAID            // 已繳清
  REFUND_PENDING  // 退款/溢收待處理
}

/// 應收：獨立資料表（V7.0 定案，解決 V6.2 尚待確認事項第 1 項，
/// 見第九節）。這張表完全不含任何現金/銀行帳戶欄位，
/// 「應收不得更新銀行」在架構上天生保證。
model Receivable {
  id                  String            @id @default(cuid())
  registrationGroupId String            @unique
  registrationGroup   RegistrationGroup @relation(fields: [registrationGroupId], references: [id], onDelete: Cascade)

  totalAmount      Decimal          @db.Decimal(12, 2) // 應收總額（= 底下所有 RegistrationItem.subtotal 加總）
  paidAmount       Decimal          @default(0) @db.Decimal(12, 2) // 已收總額
  refundAmount     Decimal          @default(0) @db.Decimal(12, 2) // 退款總額
  unreceivedAmount Decimal          @db.Decimal(12, 2) // 未收總額 = totalAmount - paidAmount + refundAmount
  status           ReceivableStatus @default(UNPAID)

  payments Payment[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("receivables")
}

enum PaymentMethod {
  CASH
  BANK_TRANSFER
  OTHER
}

/// 收款事件：只有真正收款才會建立這筆資料
/// V7.1 更新：本模型在「收款中心」規格（docs/COLLECTION_CENTER.md）
/// 正式擴充 registrationGroupId（冗餘存放）/payerNameSnapshot（正式
/// 改名自 payerName）/payerMemberId/payerHouseholdId/status
/// （新 enum PaymentStatus）/createdById 欄位，本檔案這裡保留 V7.0.3
/// 定案時的版本作為歷史脈絡，實際欄位以 COLLECTION_CENTER.md 第四節
/// 為準，見 ADR-0014。
model Payment {
  id           String     @id @default(cuid())
  receivableId String
  receivable   Receivable @relation(fields: [receivableId], references: [id])

  amount        Decimal       @db.Decimal(12, 2) // 實收金額
  paidOn        DateTime      @db.Date            // 收款日期
  paymentMethod PaymentMethod                     // 付款方式
  isRefund      Boolean       @default(false)

  /// V7.0.3 新增：這筆錢實際進了哪個現金/銀行帳戶。收款當下就必須指定，
  /// 不是等流水帳分錄才選——自動建立的 LedgerEntry.financialAccountId
  /// 直接沿用這裡的值，不會出現「同一筆收款，Payment 跟 LedgerEntry
  /// 記到不同帳戶」的不一致。
  financialAccountId String
  financialAccount   FinancialAccount @relation(fields: [financialAccountId], references: [id])

  /// V7.0.3 新增：付款人（實際付錢的人，可能不是報名的代辦人/戶長本人，
  /// 例如子女代替父母繳費）。自由輸入文字，不強制連回 Member。
  payerName String?

  notes String? @db.Text // 備註

  ledgerEntry LedgerEntry? // 1:1，一筆 Payment 只產生一筆 LedgerEntry

  createdAt DateTime @default(now())

  @@index([financialAccountId])
  @@map("payments")
}

/// 現金／銀行帳戶
model FinancialAccount {
  id               String   @id @default(cuid())
  name             String   // 例如「現金」「第一銀行 OOXX」
  type             String   // "CASH" | "BANK"
  openingBalance   Decimal  @default(0) @db.Decimal(12, 2)
  openingBalanceOn DateTime @db.Date

  ledgerEntries LedgerEntry[]
  payments      Payment[] // V7.0.3 新增：Payment.financialAccountId 的反向關聯

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("financial_accounts")
}

/// 註：以下 LedgerEntryType / LedgerEntryStatus 與既有的
/// FinanceRecordType / FinanceRecordStatus 定義完全相同（INCOME/EXPENSE、
/// DRAFT/CONFIRMED/VOID），是既有 enum 的正式改名，見第九節 ADR 對照。
enum LedgerEntryType {
  INCOME
  EXPENSE
}

enum LedgerEntryStatus {
  DRAFT
  CONFIRMED
  VOID
}

/// 流水分錄：既有 FinanceRecord 的正式改名 + 擴充版本（見第九節）。
/// 任何 Payment 建立時，系統自動建立唯一一筆對應的 LedgerEntry，
/// 用 @@unique([paymentId]) 資料庫層級約束禁止人工重複建立。
model LedgerEntry {
  id          String            @id @default(cuid())
  type        LedgerEntryType
  category    String?           // 項目分類，例如「香油錢」「法會收入」「雜支」
  amount      Decimal           @db.Decimal(12, 2)
  occurredOn  DateTime          @db.Date
  description String?           @db.Text
  status      LedgerEntryStatus @default(DRAFT)

  financialAccountId String
  financialAccount   FinancialAccount @relation(fields: [financialAccountId], references: [id])

  paymentMethod       PaymentMethod?
  activityType        ActivityType?  // 這筆錢屬於哪個活動；null = 一般雜項收支
  registrationGroupId String?        // 可選：來自哪個報名群組

  paymentId String?  @unique // 一筆 Payment 只能對應一筆 LedgerEntry
  payment   Payment? @relation(fields: [paymentId], references: [id])

  createdById String
  createdBy   User   @relation("LedgerEntryCreatedBy", fields: [createdById], references: [id])
  voidedById  String?
  voidedBy    User?     @relation("LedgerEntryVoidedBy", fields: [voidedById], references: [id])
  voidedAt    DateTime?
  voidReason  String?   @db.Text

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([status])
  @@index([financialAccountId])
  @@index([activityType])
  @@map("finance_records") // 沿用既有 finance_records 資料表名稱，見第九節
}

/// 活動統計：每個活動（依年度）自動統計應收/已收/未收/支出/結餘。
/// 設計為「快取/彙總表」，由應用邏輯在 Receivable / Payment / LedgerEntry
/// 異動時重新計算寫入，不是即時運算的查詢視圖（見第四節資料流程圖）。
/// 本輪只設計資料模型，不開發任何統計畫面。
model ActivitySummary {
  id             String       @id @default(cuid())
  activityYearId String       @unique
  activityYear   ActivityYear @relation(fields: [activityYearId], references: [id], onDelete: Cascade)

  receivableTotal Decimal @default(0) @db.Decimal(12, 2)
  receivedTotal   Decimal @default(0) @db.Decimal(12, 2)
  unreceivedTotal Decimal @default(0) @db.Decimal(12, 2)
  expenseTotal    Decimal @default(0) @db.Decimal(12, 2)
  balanceTotal    Decimal @default(0) @db.Decimal(12, 2) // = receivedTotal - expenseTotal

  recalculatedAt DateTime @default(now())

  @@map("activity_summaries")
}

// ============================================================
// 南巡／北巡專用（V6.2 提案，本輪整合進 Finance Core 一併定案）
// ============================================================

model TourVehicle {
  id             String @id @default(cuid())
  activityYearId String

  vehicleNumber  Int      // 1,2,3,4,5,6,7,8,9
  isEnabled      Boolean  @default(true) // 2、4 車預設 false，其餘預設 true
  perPersonPrice Decimal? @db.Decimal(12, 2)
  headcount      Int      @default(0)
  subtotal       Decimal  @default(0) @db.Decimal(12, 2) // = perPersonPrice * headcount

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([activityYearId, vehicleNumber])
  @@map("tour_vehicles")
}

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

// ============================================================
// 年度燈／犯太歲專用（V6.3 提案，本輪整合進 Finance Core 一併定案）
// ============================================================

model TaiSuiYearZodiac {
  id     String @id @default(cuid())
  year   Int    // 民國年
  zodiac String // 生肖字串，沿用 src/lib/lunar.ts 既有的生肖顯示文字

  createdAt DateTime @default(now())

  @@unique([year, zodiac])
  @@map("tai_sui_year_zodiacs")
}

// ============================================================
// 既有 Household / Member 需要新增的「反向關聯」欄位（純新增，
// 不影響既有欄位；示意，不是完整 model 定義）
// ============================================================

model Household {
  // ...既有欄位不變...
  registrationItems RegistrationItem[] // 新增反向關聯
}

model Member {
  // ...既有欄位不變...
  registrationItems RegistrationItem[] // 新增反向關聯
}

model User {
  // ...既有欄位不變...
  createdLedgerEntries LedgerEntry[] @relation("LedgerEntryCreatedBy") // 取代既有 FinanceRecordCreatedBy
  voidedLedgerEntries  LedgerEntry[] @relation("LedgerEntryVoidedBy")  // 取代既有 FinanceRecordVoidedBy
}
```

---

## 四、資料流程圖

### 4.1 主流程：從設定價格到入帳

```
① 管理者設定年度價格
   ActivityYear（例如 115 年・普渡）
        │
        ▼
   ActivityPrice（歷代祖先/贊普/白米... 單價，可複製 114 年再修改）

② 行政人員建立報名
   RegistrationGroup（代辦人：林美玲，底下：王家/陳家/李家）
        │
        ▼
   RegistrationItem × N（每筆連回真正家戶/成員，單價快照自 ActivityPrice，
                          數量 × 實際單價 = 小計）
        │
        ▼（RegistrationGroup 建立/異動 RegistrationItem 時，觸發重新計算）
   Receivable（totalAmount = Σ RegistrationItem.subtotal，
               初始 status = UNPAID，unreceivedAmount = totalAmount）
        │
        │  ※ 到此為止，完全沒有觸碰任何 FinancialAccount —— 這就是
        │    「應收不得更新銀行」的具體落實。
        ▼
③ 行政人員收到真正款項
   Payment（金額/日期/付款方式，可能分好幾筆分期繳款）
        │
        ├──▶ 更新 Receivable.paidAmount / unreceivedAmount / status
        │     （分期繳款：status 在 UNPAID → PARTIAL → PAID 之間流轉；
        │      退款：Payment.isRefund = true，更新 refundAmount，
        │      status 視情況設為 REFUND_PENDING）
        │
        └──▶ 自動建立 LedgerEntry（@@unique([paymentId]) 保證只建立一筆）
                    │
                    ▼
             更新 FinancialAccount 的「目前餘額」
             （currentBalance = openingBalance + Σ 該帳戶所有已確認
              LedgerEntry 的收入 - 支出；本期收入/本期支出同樣是對
              LedgerEntry 依月份/帳戶查詢彙總，不需要額外欄位）
                    │
                    ▼
④ 觸發 ActivitySummary 重新計算（依 activityYearId 分組）
   receivableTotal / receivedTotal / unreceivedTotal ← 彙總該年度活動底下
     所有 RegistrationGroup 對應的 Receivable
   expenseTotal ← 彙總該年度活動所有 activityType 相符的 LedgerEntry
     （type = EXPENSE）
   balanceTotal = receivedTotal - expenseTotal
```

### 4.2 「同一筆收款只入帳一次」的具體保證

```
Payment 建立
    │
    ▼
資料庫檢查 LedgerEntry.paymentId 的 @@unique 約束
    │
    ├── 該 Payment 已經有對應 LedgerEntry？ → 資料庫直接拒絕新建，
    │                                          不會產生第二筆
    └── 尚未有 → 建立唯一一筆 LedgerEntry，同時帶有
                  activityType（活動帳篩選依據）與
                  financialAccountId（現金/銀行帳戶篩選依據）
                  ↓
        「活動帳」「總帳」「現金/銀行餘額」是同一筆資料的三種查詢角度，
        不是三張分開維護的表——不可能出現重複計算。
```

### 4.3 南巡／北巡的特化流程（沿用同一套容器）

```
TourVehicle（設定車號/單價/人數）──┐
TourRoomCharge（設定每間價/間數）───┼── 管理者按「確認本次車資」──▶ 寫入對應的 RegistrationItem（chargeItemKey = "BUS_SEAT_1" 等）
海報贊助（自由輸入金額）───────────┘

之後就完全沿用 4.1 的主流程（RegistrationItem → Receivable → Payment →
LedgerEntry → FinancialAccount → ActivitySummary），不需要另外一套邏輯。
```

### 4.4 普渡的特化流程

```
既有的普渡登記畫面（V2.0～V3.2）
    │
    ▼
RitualRecord + UniversalSalvationDetail + UniversalSalvationEntry
（內部祭祀內容，完全不變，繼續當正式主檔）
    │
    │ （可選）關聯
    ▼
RegistrationGroup.ritualRecordId
    │
    ▼
RegistrationItem × 6（歷代祖先/個人乙位正魂/冤親債主/無緣子女/贊普/白米，
                       固定順序，前四項數量來自 UniversalSalvationEntry
                       筆數，贊普/白米金額手動輸入、無標準價）
    │
    ▼
之後同樣完全沿用 4.1 的主流程。對外收款/收據只讀 Receivable/Payment 的
彙總欄位，架構上天生不會 join 到 UniversalSalvationEntry 的明細內容。
```

### 4.5 報名當下立即付款：兩種完成方式（V7.0.3 新增）

行政人員完成報名計價後，系統必須支援兩種完成方式，兩者都會建立
`RegistrationGroup`/`RegistrationItem`/`Receivable`，差別只在於是否
**同一步**也建立 `Payment`：

```
報名畫面完成計價
    │
    ├──────────────────┬──────────────────────────────┐
    │                  │                              │
    ▼                  ▼                              │
【先存為未繳】      【立即收款】                        │
    │                  │                              │
    ▼                  ▼                              │
建立               建立                                 │
RegistrationGroup  RegistrationGroup                    │
    │                  │                              │
    ▼                  ▼                              │
建立               建立                                 │
RegistrationItem   RegistrationItem                     │
    │                  │                              │
    ▼                  ▼                              │
建立               建立                                 │
Receivable         Receivable                           │
（status=UNPAID）  （status 待計算，見下）               │
    │                  │                              │
    │                  ▼                              │
    │              同一步再建立 Payment                 │
    │              （實收金額/付款方式/現金或銀行帳戶/    │
    │               付款人/收款日期/備註）                │
    │                  │                              │
    │                  ▼                              │
    │              自動建立唯一一筆 LedgerEntry         │
    │              （沿用 4.2 的 @@unique(paymentId) 保證，  │
    │               即使報名與收款是同一次操作送出的，     │
    │               也只會走一次「建立 Payment」的邏輯，   │
    │               不會因為是同一個表單就被特殊處理成   │
    │               兩筆──入帳仍然是單一路徑）             │
    │                  │                              │
    │                  ▼                              │
    │              更新 FinancialAccount 目前餘額        │
    ▼                  ▼                              │
（維持未繳，等之後管理者另外走「收款」流程再建立 Payment）  │
                                                       │
之後不論走哪一條路徑，後續的收款、對帳、活動統計，都是同一套
Receivable → Payment → LedgerEntry → FinancialAccount → ActivitySummary
流程（見 4.1），沒有平行的第二套資料鏈。
```

**實收金額 vs 應收金額的狀態自動計算規則**（`Receivable.status`，
`ReceivableStatus` enum 沿用 V7.0 定義，不新增值）：

| 條件 | 自動狀態 |
|---|---|
| 實收金額（`Payment.amount` 累計）< 應收金額（`Receivable.totalAmount`） | `PARTIAL`（部分繳款） |
| 實收金額 = 應收金額 | `PAID`（已繳清） |
| 實收金額 > 應收金額 | `REFUND_PENDING`（溢收待處理——**不可自行吞掉差額**，必須留下溢收金額待處理，不能系統自動視為「多繳的算了」而不留紀錄） |

**防止重複建立 Payment/LedgerEntry 的保證**：「先存為未繳」跟「立即
收款」是**同一支建立報名的邏輯**多加一個可選的「同時建立 Payment」
步驟，不是兩套平行的 API——不管行政人員選哪一個按鈕，`Receivable` 永遠
只建立一次；只有選「立即收款」才會在同一次操作裡多呼叫一次「建立
Payment」的既有邏輯（跟之後管理者另外幫這筆報名收款用的是**同一支**
建立 Payment 的邏輯，沒有另外複製一份），因此 4.2 節「`@@unique
([paymentId])` 保證一筆 Payment 只入帳一次」的保證，在「報名當下立即
付款」這個情境下依然成立，不需要額外的防重複機制。

```
                        ┌─────────────────────┐
                        │  Household / Member  │（既有，基礎資料）
                        └──────────┬───────────┘
                                   │ 被引用
                                   ▼
┌──────────────┐          ┌──────────────────┐
│ RitualRecord │◀─可選────│ RegistrationGroup │◀────────┐
│ （既有，不變）│  關聯    └─────────┬─────────┘         │
└──────────────┘                    │                    │
                                     ▼                    │
                          ┌────────────────────┐          │
                          │  RegistrationItem   │          │
                          └──────────┬──────────┘          │
                                     │                      │
                     ┌───────────────┴──────────┐           │
                     ▼                          ▼           │
           ┌──────────────────┐        ┌─────────────────┐  │
           │   ActivityYear    │───────▶│  ActivityPrice   │  │
           │ （宮廟層級容器）   │        └──────────────────┘  │
           └─────────┬─────────┘                              │
                     │                                        │
        ┌────────────┼────────────────────────┐               │
        ▼                                     ▼               │
┌────────────────┐                   ┌──────────────────┐      │
│ ActivitySummary │◀──彙總──────────  │    Receivable     │◀────┘
│ （活動統計，快取）│                  └─────────┬──────────┘
└────────────────┘                              │
        ▲                                       ▼
        │ 彙總                          ┌─────────────────┐
        │                               │     Payment      │
        │                               └─────────┬─────────┘
        │                                          │ 1:1 自動建立
        │                                          ▼
        └──────────────────────────────┌──────────────────┐
                                        │   LedgerEntry     │
                                        └─────────┬─────────┘
                                                  │
                                                  ▼
                                        ┌──────────────────┐
                                        │ FinancialAccount  │
                                        └──────────────────┘

平行、獨立於上述主鏈的模組：
- TourVehicle / TourRoomCharge → （確認後）寫入 RegistrationItem（不直接
  進入其他模組，透過 RegistrationItem 銜接主鏈）
- TaiSuiYearZodiac → 獨立表，只透過 year 欄位邏輯對照 ActivityYear，不
  參與上面任何一條資料流
- AuditLog → 橫向依附所有上述模型的異動記錄（entityType/entityId 通用
  設計，不需要個別加關聯）
- User / Role / permissions.ts → 橫向依附所有需要權限檢查的操作
  （LedgerEntry 的 createdBy/voidedBy 直接關聯 User）
```

**相依順序讀法**：`ActivityYear`/`ActivityPrice` 是最底層、最先要有的
容器；`RegistrationGroup`/`RegistrationItem` 依附在它們之上；
`Receivable` 依附在 `RegistrationGroup` 之上；`Payment` 依附在
`Receivable` 之上；`LedgerEntry` 依附在 `Payment`（且同時關聯
`FinancialAccount`）；`ActivitySummary` 橫向彙總 `ActivityYear` 底下的
`Receivable`＋`LedgerEntry`，是整條鏈最後才會被更新的一環——這個順序也
直接對應第八節的建議開發順序。

---

## 六、哪些資料可以沿用

| 既有資料/架構 | 沿用方式 |
|---|---|
| `Household` / `Member` | `RegistrationItem` 直接關聯，只需新增兩個反向關聯欄位（純新增，見第三節） |
| `RitualRecord`／`UniversalSalvationDetail`／`UniversalSalvationEntry` | 普渡內部祭祀內容完全不變，`RegistrationGroup` 額外用可選欄位關聯 |
| `Role` / `User` / `src/lib/permissions.ts` | 完全沿用；`User` 只需新增兩個反向關聯（`createdLedgerEntries`/`voidedLedgerEntries`，取代既有的 `FinanceRecordCreatedBy`/`VoidedBy`） |
| `AuditLog`（通用 entityType/entityId） | 完全沿用，九個新模型的異動記錄都寫進同一張表 |
| `ActivityType` enum | 沿用，新增三個值（祭改/南巡/北巡），既有四個值不變 |
| `FinanceRecordType`／`FinanceRecordStatus` enum | 概念完全沿用，正式定名為 `LedgerEntryType`／`LedgerEntryStatus`（值不變：INCOME/EXPENSE、DRAFT/CONFIRMED/VOID） |
| `finance_records` 資料表（@@map） | 沿用同一張實體資料表（透過 `@@map("finance_records")`），`LedgerEntry` 是這張表的正式改名+擴充版本，不是另建新表 |
| `TaiSuiYearZodiac`（V6.3 提案） | 直接沿用 V6.3 的設計，本輪原封不動整合進本文件第三節 |
| `TourVehicle`／`TourRoomCharge`（V6.2 提案） | 直接沿用 V6.2 的設計，本輪原封不動整合進本文件第三節 |
| `src/lib/lunar.ts` 生肖換算邏輯 | 沿用，`TaiSuiYearZodiac.zodiac` 字串要跟這裡的顯示文字一致 |
| 「複製前一年資料」既有 API 模式 | `ActivityPrice` 複製前一年價格、`RegistrationGroup`「延用去年報名」都比照這個既有模式設計 |

---

## 七、哪些資料要新增

| 新增資料表 | 是否為全新概念 |
|---|---|
| `ActivityYear` | 全新（V6.2 提案，本輪定案） |
| `ActivityPrice` | 全新（V6.2 提案時稱 `ActivityPriceItem`，本輪正式定名並定案） |
| `RegistrationGroup` | 全新（V6.2 提案，本輪定案） |
| `RegistrationItem` | 全新（V6.2 提案，本輪定案） |
| `Receivable` | **本輪新定案為獨立資料表**（V6.2 原本建議做成 `RegistrationGroup` 上的彙總欄位，V7.0 明確要求獨立成 `Receivable` 實體，見第九節，解決 V6.2 尚待確認事項第 1 項） |
| `Payment` | 全新（V6.2 提案，本輪從關聯 `RegistrationGroup` 調整為關聯 `Receivable`，見第九節） |
| `FinancialAccount` | 全新（V6.2 提案，本輪定案） |
| `LedgerEntry` | **本輪正式定名**（V6.2 建議直接擴充既有 `FinanceRecord`，V7.0 明確要求獨立命名為 `LedgerEntry`，本輪決策為「沿用同一張實體表、Prisma model 正式改名」，不是另建一張全新的表，見第九節） |
| `ActivitySummary` | **本輪新增**（V6.2 原本認為「活動獨立損益」只需要查詢彙總、不需要新表，V7.0 明確要求獨立的 `ActivitySummary` 快取表，見第九節） |
| `TaiSuiYearZodiac` | V6.3 已提案，本輪沿用整合 |
| `TourVehicle`／`TourRoomCharge` | V6.2 已提案，本輪沿用整合 |
| `ActivityType` enum 新增三個值 | V6.2 已提案，本輪沿用 |

---

## 八、開發順序

延續 V6.2 規格書第十二節的 9 階段規劃，依本輪定案的模型相依關係微調
（跟第五節模組相依圖的讀法一致，由下層容器往上層彙總推進）：

1. **`ActivityYear` + `ActivityPrice`**：最基礎、風險最低（純新增，不碰
   既有資料），其他一切都要依附年度與價格才能繼續。
2. **`FinancialAccount`**：獨立、不依賴報名功能，可以提前做，含期初
   餘額設定。
3. **`RegistrationGroup` + `RegistrationItem`**（先做最通用的版本，不含
   普渡/南北巡特化邏輯）：驗證「報名產生資料、不影響任何財務餘額」的
   核心邏輯。
4. **`Receivable`**：驗證「應收金額正確彙總、狀態正確流轉（未繳→部分
   繳款→已繳清/退款）、且完全不觸碰 `FinancialAccount`」。
5. **`Payment` + `LedgerEntry`（沿用/改名既有 `FinanceRecord`）**：驗證
   「收款 → 唯一一筆流水分錄 → 正確更新帳戶餘額」的核心邏輯，這是財務
   資料正確性最關鍵的一步，建議上線前做最多測試（含「重複建立同一筆
   Payment 的 LedgerEntry 會被資料庫拒絕」的邊界測試）。
6. **登入/session 機制**（如果還沒做）：財務資料的權限檢查
   （`canFinance()`）要真正生效，必須先有這一塊。
7. **`ActivitySummary`**：待 4、5 兩步驟穩定後，再做彙總重算邏輯（每次
   `Receivable`/`LedgerEntry` 異動時觸發，或設計成排程/按需重算，正式
   開發時再確認）。
8. **普渡收款特化**（`RegistrationGroup.ritualRecordId` 關聯、四類自動
   產生報名明細）＋**南巡北巡特化**（`TourVehicle`/`TourRoomCharge` 確認
   後寫入 `RegistrationItem`）：在通用報名/收款機制穩定之後再做。
9. **年度燈燈種限制 + `TaiSuiYearZodiac` 犯太歲提醒 + 延用去年報名批次
   API**：這幾項行政規則本身不複雜，但「延用去年報名」需要跨活動類型的
   交易一致性（見 `docs/ADR.md` ADR-0006），建議放在通用機制穩定後再做。
10. **各活動的收款 UI、月流水/銀行餘額報表、活動獨立損益報表**：等前面
    的資料都能正確產生，這裡純粹是查詢/彙總畫面，風險最低，適合放最後。

---

## 九、本輪對 V6.2 尚待確認事項的處理

`docs/FINANCE_AND_ACTIVITY_SPEC.md` 第十三節列了六項（後來 V6.3 又加了
兩項）尚待確認事項，V7.0 這次的需求明確resolve 了其中幾項：

1. **「`Receivable` 是否需要獨立資料表？」（V6.2 尚待確認事項第 1 項）
   ——已解決**：V7.0 明確要求 `Receivable` 是獨立實體（見需求第五節），
   本輪已定案為獨立資料表，不再是 `RegistrationGroup` 上的彙總欄位。
   `Receivable` 完全不含任何 `FinancialAccount` 關聯，架構上直接保證
   「應收不得更新銀行」。
2. **「流水帳要不要獨立命名為 LedgerEntry？」（V7.0 新提出）——已解決**：
   決策為「沿用既有 `finance_records` 實體資料表（`@@map` 不變），Prisma
   model 正式從 `FinanceRecord` 改名為 `LedgerEntry`」，理由跟 V6.2
   ADR-0002 一致（避免系統裡有兩張本質相同的流水帳表），只是這次採用
   使用者指定的正式名稱。**這代表未來真的要 migration 時，這一步會是
   一個「rename model + 新增欄位」的 migration，不是「新建一張表」**——
   風險很低，因為 `finance_records` 目前在正式環境是空表（V6.1 確認過
   row count = 0）。
3. **「活動獨立損益要不要一張快取表？」（V7.0 新提出）——已解決**：
   V6.2 原本認為純查詢彙總就夠，V7.0 明確要求 `ActivitySummary` 作為
   獨立資料表，本輪已定案為「應用邏輯在相關資料異動時重新計算並寫入」
   的快取表設計，不是即時運算的查詢視圖（詳見第四節資料流程圖 ④）。
4. 其餘尚未被本輪需求觸及的項目（普渡報名明細數量是否自動同步、南北巡
   確認時機、代辦人是否算一筆報名明細、enum 值英文代稱、犯太歲名單重複
   防呆、延用去年報名的批次 API 邊界案例）**維持 V6.2/V6.3 的建議做法，
   本輪沒有新資訊需要調整**，正式開發前仍建議你逐項確認。

---

## 十、家戶快速報名與姓名明細的 Schema 擴充（V6.4 新增）

V6.4「家戶快速報名與姓名明細規格定稿」要求 `RegistrationItem` 能同時
支援「代辦人模式」（普渡）與「家戶快速報名模式」（年度燈/祭改），本節
整理本輪對 Schema 的擴充內容，完整欄位定義見第三節 `RegistrationItem`
model。

### 10.1 新增欄位總覽

| 欄位 | 型別 | 用途 |
|---|---|---|
| `activityType` | `ActivityType`（必填） | 冗餘存放，方便查詢，見 10.2 |
| `year` | `Int`（必填） | 冗餘存放，方便查詢，見 10.2 |
| `sourceHouseholdId` | `String?` | 記錄快速報名操作的來源家戶，見 10.3 |
| `sourceMemberId` | `String?` | 記錄快速報名操作的來源成員，見 10.3 |
| `isTemporaryName` | `Boolean`（預設 `false`） | 標記臨時姓名，見 10.4 |
| `status` | `RegistrationItemStatus`（新 enum，預設 `ACTIVE`） | 取消＝狀態改變不是刪除，見 10.5 |

### 10.2 `activityType`/`year` 冗餘存放的取捨

這兩個欄位理論上可以透過
`registrationGroupId → RegistrationGroup → ActivityYear` 關聯查到，但
V6.4 需求明確把它們列為 `RegistrationItem` 應有欄位，本輪採納並直接
冗餘存放，換取「查某一年某活動的所有姓名明細」不需要多層 join
（並新增對應複合索引 `@@index([householdId, activityType, year])` /
`@@index([memberId, activityType, year])`）。**代價**：新增/修改
`RegistrationItem` 時，應用邏輯必須自行保證這兩欄跟所屬
`RegistrationGroup` 一致，資料庫不會自動校驗——已列入
`FINANCE_AND_ACTIVITY_SPEC.md` 十三節第 9 項尚待確認事項。

### 10.3 `sourceHouseholdId`/`sourceMemberId` 與 `householdId`/`memberId` 的差異

- `householdId`/`memberId`：這筆明細**目前**連回的正式家戶/成員（可以
  為空，例如普渡冤親債主，或臨時姓名尚未連結時）。
- `sourceHouseholdId`/`sourceMemberId`：這筆明細**最初是從哪一戶的快速
  帶入畫面新增的**，即使當事人事後被確認不屬於該家戶正式成員，這個來源
  記錄也不會被覆蓋或清除，供之後查詢「這戶曾經帶出過哪些人」使用。

### 10.4 臨時姓名（`isTemporaryName`）

`isTemporaryName = true` 時，`memberId` 通常為空，`displayName`
（必填）是唯一可靠的姓名來源。之後若確認為既有信眾，可以事後補上
`memberId` 重新連結回正式 `Member`，但不得回頭修改這筆歷史紀錄原本的
活動內容/金額——只補關聯，不覆蓋事實。

### 10.5 `status`（取消＝狀態改變，不是刪除）

新增 `RegistrationItemStatus { ACTIVE, CANCELLED }`。行政人員在家戶快速
報名畫面取消勾選某人時，若該人今年已有 `ACTIVE` 的明細，狀態改為
`CANCELLED`（不刪除資料列）；之後重新勾選，直接改回 `ACTIVE`，原本的
單價/備註等歷史資訊不會遺失。「每人每活動每年最多一筆 `ACTIVE`
明細」由應用邏輯保證（若需要資料庫層級保證，可在正式開發時評估改用
partial unique index，本輪不涉及該實作細節）。

### 10.6 `RegistrationGroup` 在兩種模式下的行為差異

見 `docs/FINANCE_AND_ACTIVITY_SPEC.md` 4.1 節與 `docs/ADR.md`
ADR-0011：家戶快速報名會**自動建立一個輕量 `RegistrationGroup`**（每個
「家戶＋活動類型＋年度」一組），`agentDisplayName`
預設帶入戶長姓名或「○○○一家」字樣。這是本輪的架構判斷（非使用者明確
指定），列入 `FINANCE_AND_ACTIVITY_SPEC.md` 十三節第 10 項尚待確認事項。

### 10.7 `chargeItemKey` 與需求文字中「itemType」的對應

本文件維持既有的 `chargeItemKey` 欄位命名（對應
`ActivityPrice.itemKey`），與 V6.4 需求文字使用的「itemType」是同一個
概念。維持既有命名是為了不在 V7.0 已定案的 Schema 之外另外引入一套新
用詞；如果你偏好正式改名為 `itemType`，屬於單純欄位改名，可在正式開發
前再統一調整，不影響資料結構或既有決策。

### 10.8 ER Diagram 更新

第二節 ER Diagram 已標註★更新內容（`RegistrationItem` 新增欄位、
`RegistrationGroup` 兩種模式並存的說明）。

**本節同樣是提案，本輪不會寫進 `prisma/schema.prisma`、不會產生
migration、不會影響正式資料庫。**

---

## 十一、本輪確認：本次完全沒有做的事（依你的要求，涵蓋 V7.0 + V6.4 + V7.0.3）

- 沒有開發財務 UI、收款畫面、流水帳畫面、報表。
- 沒有開發年度燈 UI、祭改 UI、南巡 UI、北巡 UI、宮慶 UI。
- 沒有套用任何 migration，沒有修改正式資料庫，`prisma/schema.prisma`
  本輪完全沒有變動（本文件的 Schema 全部是提案文字）。
- 沒有推送到 GitHub、沒有觸發 Render 部署。
- 沒有開發任何新 API。
- 沒有執行 `npm install`/`prisma generate`/`next build`（沒有必要，
  本輪也沒有任何程式碼異動）。
- **（V6.4 新增確認）**沒有實作家戶快速報名的畫面或 API，沒有修改
  `RegistrationItem` 以外的任何 model。
- **（V7.0.3 新增確認）**沒有實作報名畫面上的「先存為未繳」/「立即收款」
  按鈕或任何 API，只更新了 `Payment`/`FinancialAccount` 的欄位規劃與
  資料流程圖，沒有修改除 `Payment`/`FinancialAccount` 以外的任何 model。
- 沒有開始 V7.1。
