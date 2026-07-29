# 三玄宮 ERP — 交接與現況總覽（HANDOFF）

> 開新對話時，把「一、給新對話的開場白」整段貼上即可接續。所有實作都已寫進本資料夾的檔案，換聊天室不會遺失。

---

## 一、給新對話的開場白（可直接複製貼上）

三玄宮 ERP（Next.js 15 App Router + Prisma + PostgreSQL，資料夾已連結）。

環境限制（重要）：沙盒沒有資料庫連線、Prisma linux 引擎抓不到（403）、`next build` 會 SIGBUS。所以驗證一律用 `npx tsc --noEmit` ＋ `npx tsx --test tests/*.test.ts`；正式 `npm run build`、`prisma migrate`、`prisma generate`、同步工具的 dry-run／commit，全部在我的 Mac 上跑。

規矩：一次只做一個模組、每步可測、不破壞既有功能、沿用既有架構不建第二套、不動正式資料、不用 `prisma migrate reset`。**未經我確認，不得 commit／push／deploy。**

請先看 `docs/HANDOFF.md` 了解現況，再問我要做哪一項。

---

## 二、目前完成的工作（近期）

| 版本 | 內容 | 狀態 |
|---|---|---|
| V24 / V24.2 / V24.3 | 正式匯入：牌位類型路由、確認頁 commit-preview 效能、匯入交易改批次寫入（解 P2028） | 已完成，tsc 0、測試過 |
| V25 | 個人地址權威架構：`Member.address` 欄位＋顯示 fallback（個人→家戶）＋匯入寫入＋新增信眾表單 | 已完成；migration 已建，**待 Mac 套用** |
| V25（同步工具） | `scripts/syncDevoteesFromExcel.ts`：以正式信眾 Excel 為權威，dry-run/commit、分批短交易（冪等、可中斷重跑）、`--resolve` 人工決議、`--report-remaining` 唯讀報表、重複來源合併、歷代祖先排除 | 已完成；**待 Mac 實跑同步** |
| V25.1 | 正式匯入預檢：家戶編號（HouseholdCode）優先——同編號同名直接更新，不再要求人工確認（修 726 戶誤判） | 已完成，tsc 0、測試過 |
| V26 | 供品管理首頁修正：排除中元普渡，只顯示四主祀聖壽＋宮慶＋（有設定的）花果 | 已完成，tsc 0、測試過 |

---

## 三、待辦 / 需在 Mac 執行的事

1. **Migration 歷史修復**（正式資料庫有一筆幽靈 migration `20260726104522_npx_prisma_migrate_status`）：步驟見 `docs/V25_1_migration_repair.md`。先跑裡面的唯讀 `migrate diff` 確認，再決定方案 A/B。**不要 reset。**
2. **套用 V25 migration**：`npx prisma migrate deploy`（或 dev）→ `npx prisma generate`（Mac 上會把 `Member.address` 變原生型別）。
3. **V25 正式同步**：
   - Dry-run：`npm run sync:devotees -- --file "<正式信眾.xlsx>"`
   - 人工決議（如需解 CONFLICT）：加 `--resolve scripts/data/v25-devotee-resolutions.example.json`（複製此範本改成自己的，勿把真實個資進 git）
   - 正式：`npm run sync:devotees:commit -- --file "<正式信眾.xlsx>" [--resolve ...]`
   - 再跑一次 dry-run 應顯示需寫入 0（冪等驗收）
4. **V26 驗收**：開 `/offering-center` 確認不再出現中元普渡。
5. 各項目最後在 Mac：`npx tsc --noEmit`、`npm run build`。

---

## 四、關鍵檔案索引

- 個人地址規則：`src/lib/personalAddress.ts`
- 信眾摘要（含 displayAddress）：`src/lib/devoteeProfile.ts`
- 正式匯入核心：`src/lib/devoteeImportBatch.ts`、`devoteeImportMemberMatch.ts`（V25.1 預檢）、`devoteeImportValidate.ts`、`devoteeImportNormalize.ts`
- 同步工具：`scripts/syncDevoteesFromExcel.ts`、決議範本 `scripts/data/v25-devotee-resolutions.example.json`
- 供品規則：`src/lib/offeringRules.ts`（V26 活動範圍）、頁面 `src/app/offering-center/page.tsx`
- Migration 修復說明：`docs/V25_1_migration_repair.md`
- 相關測試：`tests/v24Import.test.ts`、`v25DevoteeAuthoritativeSync.test.ts`、`v25_1HouseholdPrecheck.test.ts`、`offeringRules.test.ts`

---

## 五、驗證指令（Mac）

```bash
npx tsc --noEmit
npx tsx --test tests/v25DevoteeAuthoritativeSync.test.ts
npx tsx --test tests/offeringRules.test.ts
npm run build
```

（沙盒能跑的只有前三類；build 需在 Mac。）

---

## 六、不可更動（除非明確要求）

正式信眾/家戶資料、V25 權威同步邏輯、Excel 匯入流程、年度燈架構、普渡報名、白米流程、收據規則、登入/Session、角色權限矩陣、列印管理與模板。
