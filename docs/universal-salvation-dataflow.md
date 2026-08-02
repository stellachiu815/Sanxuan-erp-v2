# 中元普渡（Universal Salvation）資料鏈全盤文件

> V30.7 盤點。描述中元普渡從入口到收款/列印/編號的完整資料流、各 Model 生命週期、關聯與已知缺口。

## 狀態（V30.7 更新）

**已完成並上線（不得重做）：**
- ✅ V30.3 migration 已正式 `migrate deploy`（`registrationOrder` / `templeEventId` / `registrationItemId` 欄位＋unique index 已在正式 DB）。
- ✅ Prisma Client 已 `generate`。
- ✅ registrationOrder 已正式補號 **73 筆**。
- ✅ V30.3 已 commit / push / deploy。

**尚未完成（正確的剩餘工作，取代舊「下一步部署 V30.3 migration」建議）：**
1. V30.5／V30.6／V30.7 未 commit 修改的 **Mac `npm run build` 與 DB 驗證**。
2. 執行 `scripts/universalSalvationRepair.ts` **dry-run**（預設唯讀）檢視 SAFE_CONFIRM／NEEDS_REVIEW／RESTORE／SAFE_ASSIGN_ORDER 筆數。
3. **Stella 人工驗收**（信眾明細、列印管理入口、地址兩行、上線檢查頁、Excel）。
4. 經授權後才執行 **孤兒冤親 RESTORE／SAFE_CONFIRM／補號**（`--commit` 且指定階段；本輪未執行）。

> 註：既然欄位已 deploy 且 client 已 generate，程式中大量 `registrationOrder`／`registrationItemId` 的 **raw SQL** 屬可清理技術債（日後可改回 typed query），但**功能上已完全可用**，不阻擋上線。

---

## 0. 一頁總覽：兩層架構

普渡資料分成**兩個平行層**，靠 1:1／關聯欄位串起來：

- **項目層（計價/報名）**：`RitualRecord` → `RitualRegistrationItem`（每個報名項目一列；財務、狀態、registrationOrder 都在這）。
- **內容層 / 列印物件層**：`UniversalSalvationEntry`（牌位內容：姓名/陽上/地址）＋ `AdditionalPrintItem`（TABLET/POCKET 列印物件：列印狀態/printCount）。

串接關鍵：
- 牌位 item ↔ entry：`RitualRegistrationItem.universalSalvationEntryId`（1:1，unique）。
- 列印物件 ↔ entry：`AdditionalPrintItem.sourceEntryId`（多對一：一個 entry 有 TABLET×1＋POCKET×1）。
- 寶袋列印物件 ↔ 自身報名：`AdditionalPrintItem.registrationItemId` →（US_POCKET_EXTRA）`RitualRegistrationItem`（V30.3b/c；作業號碼 No.xxx 來源）。
- 編號：`RitualRegistrationItem.registrationOrder`，範圍 `(templeEventId, registrationItemTypeId)`，advisory lock + unique index。

---

## 1. 各項目完整資料流

圖例：入口 → API → Service → Transaction → 產生的資料。「✅串通 / ⚠️缺口」。

### 1.1 超拔祖先 US_ANCESTOR（TABLET, 免費）
```
信眾頁/家戶頁「新增牌位」→ POST /households/[id]/rituals/universal-salvation/[year]/entries
  → ritual.createUniversalSalvationEntry (tx)
     → UniversalSalvationEntry.create（姓名/陽上/地址）
     → ensureLinkedTabletItem → RitualRegistrationItem(US_ANCESTOR, status=record.status) + applyRegistrationOrder ✅
     → ensureTabletPrintObjects → AdditionalPrintItem TABLET×1 + 基本POCKET×1（POCKET 另建 US_POCKET_EXTRA item+order+registrationItemId）✅
確認：/registrations/[id]/confirm → confirmRegistration → record+DRAFT item → CONFIRMED ✅
列印：/universal-salvation/[year]/print-center（PrintObjectCenter, mm 引擎）；名單：/print-center/rosters/US_ANCESTOR/[year] ✅
收款：receivableAdapters.universalSalvationTabletAdapter（item 自身金額，免費則 0）✅
```

### 1.2 乙位正魂 US_ZHENGHUN（TABLET, 免費）
同 1.1，`category=INDIVIDUAL_SOUL`。基本寶袋、地址、陽上皆同。✅

### 1.3 累世冤親債主 US_YUANQIN（TABLET, 免費, 全戶逐人）
```
信眾頁/家戶頁「全戶加入冤親」→ debtCreditorBatch.submitDebtCreditorBatch
  → POST /registrations/batch → registerItemsBatch (tx)
     → 每位成員 RitualRegistrationItem(US_YUANQIN) + applyRegistrationOrder
     → US_YUANQIN 分支：UniversalSalvationEntry.create + item.universalSalvationEntryId 回填 + ensureTabletPrintObjects ✅
冪等：同 (record,type,member) 未取消不重建 ✅
歷史缺口：早期 US_YUANQIN 未 seed 時 ensureLinkedTabletItem 靜默 return → 14 筆孤兒 entry（V30.4 已改拋錯防未來；既有 14 筆走 tabletItemBackfill RESTORE，dry-run only）⚠️
```

### 1.4 無緣子女 US_WUYUAN（TABLET, 免費）
同 1.1，`category=UNBORN_CHILD`，無既有來源時建一筆空白草稿供填。基本寶袋同。✅

### 1.5 白米 US_RICE（RICE, 計價/斤）
```
普渡編輯頁白米 / 匯入 → whiteRiceService（建立即 applyRegistrationOrder；不建 entry、不建列印物件）✅
確認：受年度配額 assertRiceQuota 檢查（confirmRegistration 內）✅
名單：/print-center/rosters/US_RICE/[year]（顯示斤數）；收款：riceRegistrationAdapter ✅
無牌位 entry、無 AdditionalPrintItem（正常）✅
```

### 1.6 基本寶袋 US_BASIC_POCKET（POCKET, 永遠免費）
```
牌位建立時 ensureTabletPrintObjects 自動建：AdditionalPrintItem POCKET(isExtra=false, isChargeable=false)
  + createPocketRegistrationItem → US_POCKET_EXTRA RitualRegistrationItem(amountDue=0) + applyRegistrationOrder
  + registrationItemId 連結（V30.3c）✅
No.xxx：resolvePrintItemRegistrationOrder 經 registrationItemId 取自身順序（與額外寶袋共用同一序列）✅
收款：免費（amountDue=0，adapter subtotal>0 過濾自然排除）✅
```

### 1.7 額外寶袋（收費）/（免費）US_POCKET_EXTRA（POCKET）
```
牌位底下「增加寶袋」→ POST /entries/[entryId]/print-items（itemType=POCKET）
  → additionalPrintItems.createExtraPocket (tx)
     → createPocketRegistrationItem(US_POCKET_EXTRA, amountDue=收費?小計:0) + applyRegistrationOrder
     → createAdditionalPrintItem(POCKET, isExtra=true, registrationItemId=reg.id) ✅
收款唯一來源＝US_POCKET_EXTRA item adapter（universalSalvationPocketItemAdapter）；
  legacy additionalPrintItemAdapter 排除 registrationItemId 非 null，避免重複計價 ✅
免費（未勾收費）：仍建列印物件、可列印/補印，amountDue=0 不計應收 ✅
舊式 registrationItemId=null 額外寶袋：保留 legacy 應收 ✅
```

### 1.8 贊普 US_SPONSOR（SPONSOR, 固定價）/ 1.9 隨喜贊普 US_SPONSOR_DONATION（SPONSOR, 自由額）
```
報名精靈/編輯頁 → registerItemsBatch / syncSponsorItemInTx（各自一筆、各自計價）+ applyRegistrationOrder ✅
名單：/print-center/rosters/US_SPONSOR(_DONATION)/[year]；收款：universalSalvationSponsorItemAdapter ✅
無牌位 entry、無列印物件（正常）✅
```

### 沿用去年
`copyUniversalSalvationFromPreviousYear` → 建 DRAFT record + entries（不複製付款/收據/列印狀態）；之後手動確認。✅

---

## 2. Model 生命週期參考

| Model | 用途 | 建立時機 | 修改時機 | 刪除規則 | 永久? | Restore? |
|---|---|---|---|---|---|---|
| `RitualRecord` | 一戶一年一活動主檔 | 首次報名/加入活動 | 確認/取消/編輯 | soft delete（deletedAt）→回收區 | 否（年度） | 是（recycleBin 30天） |
| `RitualRegistrationItem` | 報名項目層（財務/狀態/registrationOrder） | 各入口報名 | 確認/改量/收款 | soft delete + CANCELLED | 否 | 是（ensureLinkedTabletItem 恢復 DRAFT） |
| `UniversalSalvationEntry` | 牌位內容（姓名/陽上/地址） | 建牌位 | 編輯牌位 | soft delete | 否（可連永久 WorshipRecord） | 是 |
| `AdditionalPrintItem` | TABLET/POCKET 列印物件 | 牌位建立(基本)/增加寶袋(額外) | 改名/量/收費 | cancel→回收區 soft delete | 否 | 是（restoreCancelled…） |
| `WorshipRecord` | 家戶永久牌位（祖先/正魂） | 永久名單/同步 | 家戶維護 | soft delete | **是** | 是 |
| `registrationOrder`(欄位) | 普渡報名順序 | 建 item 即取號 | 不改（取消保留原號） | — | — | — |
| `TempleEventPrintBatch` | 列印批次紀錄 | 確認完成列印 | — | — | 是（紀錄） | — |

誰建立/修改/列印：建立＝報名操作人（session user）；修改＝具權限操作人；列印＝列印中心「確認完成列印」寫 printCount/printedAt/lastPrintedByUserId。收款金額只由收款中心 PaymentAllocation/Adjustment 動，報名/列印流程一律不碰。

---

## 3. 關聯圖（文字）

```
Household 1─* Member
Household 1─* RitualRecord ─* RitualRegistrationItem ─(1:1 opt)─ UniversalSalvationEntry
                                   │                                     │
                                   │(US_POCKET_EXTRA).id                 │.id
                                   │                                     │
RitualRecord 1─* AdditionalPrintItem ──registrationItemId──┘   sourceEntryId┘
                     (TABLET/POCKET)
RitualRecord 1─1 UniversalSalvationDetail ─* UniversalSalvationEntry
Receivable：各 adapter 依 sourceType 指向 item / detail / additionalPrintItem
```
