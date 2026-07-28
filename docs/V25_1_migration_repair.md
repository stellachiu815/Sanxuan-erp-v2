# V25.1 Migration 歷史修復（不 reset、不清資料、不重匯）

## 真正根因

正式資料庫的 `_prisma_migrations` 表裡有一筆 `20260726104522_npx_prisma_migrate_status`
被記錄為「已套用（applied）」，但它的資料夾：

- **本機 `prisma/migrations/` 沒有**
- **git 全歷史沒有**（`git log --all` 查無）

由名稱可判斷，這是開發期間一次**誤植指令**（很可能是
`npx prisma migrate dev --name "npx prisma migrate status"`，把「migrate status」
當成了 `--name`）所產生並套用到共用/正式資料庫、但那個資料夾從未 commit 進 git。

於是 Prisma 比對「資料庫已套用清單」與「本機 migrations 目錄」時，發現資料庫多了一筆
本機沒有的 migration → 回報：

```
The migrations recorded in the database diverge from the local migrations directory.
Missing migration: 20260726104522_npx_prisma_migrate_status
```

這是**歷史對不上**的問題，不是資料問題。資料完全沒事。

---

## 修復原則

- 保留正式資料 ✅（以下都不動任何業務資料表）
- 保留 migration 歷史 ✅（方案 A 重建資料夾，記錄完整保留）
- 完成 Member.address migration ✅（`20260818000000_v25_member_personal_address`）
- 不使用 `prisma migrate reset` ✅
- 不重匯資料 ✅
- 正式機一律用 `prisma migrate deploy`，**絕不用 `migrate dev`**（dev 會嘗試建立 shadow DB／偵測 drift 後可能提議 reset）

---

## 步驟 0：先備份（必做）

```bash
# Render 後台建立資料庫快照，或：
pg_dump "$DATABASE_URL" > backup_before_v25_$(date +%Y%m%d_%H%M).sql
```

## 步驟 1：先看清楚現況（唯讀，不改任何東西）

```bash
# 1a. 目前資料庫記了哪些 migration、狀態如何
npx prisma migrate status

# 1b. 這筆幽靈 migration 的實際紀錄（checksum、套用時間、步數）
psql "$DATABASE_URL" -c "SELECT migration_name, checksum, finished_at, applied_steps_count \
  FROM \"_prisma_migrations\" WHERE migration_name = '20260726104522_npx_prisma_migrate_status';"

# 1c. 最關鍵：確認『正式資料庫的實際結構』與『目前 schema.prisma』只差 Member.address
#     （這代表那筆幽靈 migration 沒有留下未追蹤的結構差異）
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

**步驟 1c 期望輸出只有這一行（或等價）：**

```sql
ALTER TABLE "members" ADD COLUMN "address" TEXT;
```

- 若「只」看到上面這一行 → 一切正常，往下走。
- 若看到其他非預期的結構差異 → **先停下**把差異貼出來確認，不要繼續。

---

## 方案 A（建議｜保留歷史紀錄）

思路：資料夾遺失，就把它「原樣補回來」，讓本機目錄與資料庫歷史一致。此檔為 no-op，
資料庫已標記 applied，`migrate deploy` 會直接略過、不會重跑。

> 本次已幫你把資料夾重建好：
> `prisma/migrations/20260726104522_npx_prisma_migrate_status/migration.sql`
> （內容為說明 + `SELECT 1;`，請 commit 進 git。）

```bash
# 2. 對齊資料庫此列的 checksum 到重建後的檔案內容（否則會報「migration was modified」）
NEWSUM=$(sha256sum prisma/migrations/20260726104522_npx_prisma_migrate_status/migration.sql | cut -d' ' -f1)
echo "new checksum = $NEWSUM"
psql "$DATABASE_URL" -c "UPDATE \"_prisma_migrations\" \
  SET checksum = '$NEWSUM' \
  WHERE migration_name = '20260726104522_npx_prisma_migrate_status';"

# 3. 確認歷史已一致：應顯示全部 applied、只剩 V25 一筆 pending，且無 divergence
npx prisma migrate status

# 4. 只套用新的 V25 migration（不會動到幽靈 migration）
npx prisma migrate deploy

# 5. 重新產生 client（Member.address 變原生型別）
npx prisma generate
```

只改了：本機 migrations 目錄（+1 個資料夾）＋ `_prisma_migrations` 表**這一列的 checksum**。
**沒有動任何業務資料。**

---

## 方案 B（替代｜若你偏好移除這筆誤植紀錄）

若你認為這筆幽靈 migration 純屬誤植、不想保留它：在步驟 1c 確認結構一致後，
直接刪掉這筆孤兒紀錄（它本來就沒有資料夾、沒有 git 紀錄）。這不會 drop 任何欄位/表，
只是移除 `_prisma_migrations` 的一列 metadata，且可還原（重新 INSERT）。

```bash
# 先記下這一列（要還原時可用）
psql "$DATABASE_URL" -c "SELECT * FROM \"_prisma_migrations\" \
  WHERE migration_name = '20260726104522_npx_prisma_migrate_status';"

# 刪除孤兒紀錄
psql "$DATABASE_URL" -c "DELETE FROM \"_prisma_migrations\" \
  WHERE migration_name = '20260726104522_npx_prisma_migrate_status';"

# 若採方案 B，請把本次重建的資料夾刪掉（因為資料庫已不再有這筆紀錄）
rm -rf prisma/migrations/20260726104522_npx_prisma_migrate_status

npx prisma migrate status     # 應無 divergence、只剩 V25 pending
npx prisma migrate deploy
npx prisma generate
```

方案 B 之後：git 歷史、本機目錄、資料庫歷史三者完全一致（最乾淨），但你會少掉這筆
誤植紀錄——由於它從未進 git，實務上不算損失真正的歷史。

---

## 驗收

```bash
npx prisma migrate status          # 全部 applied、無 divergence
psql "$DATABASE_URL" -c "\d members" | grep address   # 應看到 address | text
npx tsc --noEmit
npm run build
```

之後即可用永久同步工具校正個人資料（地址等）：

```bash
npm run sync:devotees -- --file "<正式信眾.xlsx>"          # dry-run
npm run sync:devotees:commit -- --file "<正式信眾.xlsx>"   # 正式寫入
```

## 建議：避免再次發生

- 正式機部署一律 `prisma migrate deploy`，不要 `migrate dev`。
- 每次 `migrate dev` 產生的資料夾**務必 commit 進 git** 後再部署。
- CI 可加一步 `prisma migrate status`，發現 divergence 即擋下。
