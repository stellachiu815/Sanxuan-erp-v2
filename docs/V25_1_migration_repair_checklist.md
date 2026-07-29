# V25.1 Migration 歷史修復 — 執行 Checklist

> 對照說明文件：`docs/V25_1_migration_repair.md`。本檔是「在 Mac 上照做」的逐條打勾版。
> 沙盒（Cowork）無法連正式 DB，以下標 **[Mac]** 的都必須在你的 Mac 上跑；標 **[已完成]** 的是本機檔案，已備妥並進 git。

## 本機狀態（已確認，無需再動）

- [x] 幽靈資料夾 `prisma/migrations/20260726104522_npx_prisma_migrate_status/` 已用 no-op 佔位檔重建，並已 commit（`aedc5cb`）。
- [x] 重建檔 sha256 = `2c07c7cc35d264670c38a9ffef52913ebe333ed9e711d01b4cb9dab3675a0277`（方案 A 對齊 checksum 用）。
- [x] V25 migration `20260818000000_v25_member_personal_address`（`ALTER TABLE "members" ADD COLUMN "address" TEXT;`）在位。
- [x] `schema.prisma` 已有 `Member.address String?`。

---

## 步驟 0 — 備份（必做）[Mac]

- [ ] 建立備份（或用 Render 後台快照）：

```bash
pg_dump "$DATABASE_URL" > backup_before_v25_$(date +%Y%m%d_%H%M).sql
```

## 步驟 1 — 唯讀確認（不寫入）[Mac]

- [ ] 1a 目前 DB migration 狀態：

```bash
npx prisma migrate status
```

- [ ] 1b 幽靈 migration 的實際紀錄（記下 checksum）：

```bash
psql "$DATABASE_URL" -c "SELECT migration_name, checksum, finished_at, applied_steps_count FROM \"_prisma_migrations\" WHERE migration_name = '20260726104522_npx_prisma_migrate_status';"
```

- [ ] 1c 確認正式 DB 結構 vs schema **只差 Member.address**：

```bash
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```

**判讀 1c：**

- 只出現 `ALTER TABLE "members" ADD COLUMN "address" TEXT;` → 正常，往下走。
- 出現任何其他差異 → **停下**，把輸出貼回對話確認，先不要繼續。

> 備註：等價反向寫法 `npx prisma migrate diff --from-migrations ./prisma/migrations --to-url "$DATABASE_URL" --script`，預期輸出為 `DROP COLUMN "address";`，同樣代表「只差 address」。擇一即可。

**→ 停點：把 1a 與 1c 輸出貼回對話，確認無誤後再進方案 A。**

---

## 方案 A（建議｜保留歷史）[Mac]

- [ ] 2 對齊 DB 這一列的 checksum（否則 deploy 會報 "migration was modified"）：

```bash
psql "$DATABASE_URL" -c "UPDATE \"_prisma_migrations\" SET checksum = '2c07c7cc35d264670c38a9ffef52913ebe333ed9e711d01b4cb9dab3675a0277' WHERE migration_name = '20260726104522_npx_prisma_migrate_status';"
```

- [ ] 3 確認歷史一致（應：全 applied、無 divergence、只剩 V25 pending）：

```bash
npx prisma migrate status
```

- [ ] 4 只套用 V25 migration（跳過幽靈 migration）：

```bash
npx prisma migrate deploy
```

- [ ] 5 重新產生 client：

```bash
npx prisma generate
```

## 方案 B（替代｜移除誤植紀錄）[Mac]

僅在你偏好不保留這筆幽靈紀錄時採用，細節見 `docs/V25_1_migration_repair.md`（會刪 `_prisma_migrations` 一列 + 刪本機重建資料夾）。**採 B 就不要跑方案 A。**

---

## 驗收 [Mac]

- [ ] `npx prisma migrate status` → 全 applied、無 divergence
- [ ] `psql "$DATABASE_URL" -c "\d members" | grep address` → 應看到 `address | text`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`

## 後續（migration 修復完成後）

- [ ] V25 正式同步 dry-run：`npm run sync:devotees -- --file "<正式信眾.xlsx>"`
- [ ] V25 正式同步 commit：`npm run sync:devotees:commit -- --file "<正式信眾.xlsx>" [--resolve ...]`
- [ ] 再 dry-run 一次應顯示需寫入 0（冪等驗收）
- [ ] V26 驗收：開 `/offering-center` 確認不再出現中元普渡

---

## 不可做

- 不用 `prisma migrate reset`
- 不用 `prisma migrate dev`（正式機一律 `deploy`）
- 未經確認不 commit／push／deploy
