/**
 * V33 §9 「取消冤親測試資料」專用清理腳本（dry-run 預設；--commit 才寫入）。
 *
 * ⚠️ 只針對本次已確認的測試資料，範圍寫死、逐筆安全檢查、整批 all-or-nothing：
 *     householdCode = HF00001
 *     ritualRecordId = rrcms5yrp5u0001ed2akhfsomei
 *     status = CANCELLED、類型 = US_YUANQIN
 * 不使用既有 printObjectDedupeRepair.ts；不碰其他家戶/RitualRecord/OK 資料/額外寶袋/收款/收據/財務。
 *
 *   # 1) 預覽（唯讀，強制先跑）
 *   npx tsx scripts/purgeCancelledYuanqinTestData.ts
 *   # 2) 實際清理（交易、冪等、可重跑）——軟刪除 CANCELLED item + entry + 預設 TABLET + 基本 POCKET
 *   npx tsx scripts/purgeCancelledYuanqinTestData.ts --commit
 *
 * 安全規則：任一筆有 amountPaid>0／收據／財務交易／printCount>0／status≠CANCELLED → 整批停止，不部分執行。
 */
import { prisma } from "../src/lib/prisma";

const HOUSEHOLD_CODE = "HF00001";
const RITUAL_RECORD_ID = "rrcms5yrp5u0001ed2akhfsomei";
const OPERATOR = process.env.OPERATOR ?? "system:purgeCancelledYuanqinTestData";

type RriRow = { id: string; entryId: string | null; amountPaid: string | number; status: string };
type PoRow = { id: string; sourceEntryId: string; itemType: string; isExtra: boolean; printCount: number; deletedAt: Date | null };

async function main() {
  const commit = process.argv.includes("--commit");

  // 0) 家戶存在性（household.id 即家戶編號）。
  const hh = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "households" WHERE "id" = $1`, HOUSEHOLD_CODE
  );
  if (hh.length === 0) { console.error(`找不到家戶 ${HOUSEHOLD_CODE}，停止。`); process.exit(1); }

  // 1) RitualRecord 必須屬於該家戶、且為 UNIVERSAL_SALVATION。
  const rr = await prisma.$queryRawUnsafe<{ id: string; householdId: string; activityType: string }[]>(
    `SELECT "id","householdId","activityType" FROM "ritual_records" WHERE "id" = $1`, RITUAL_RECORD_ID
  );
  if (rr.length === 0 || rr[0].householdId !== HOUSEHOLD_CODE || rr[0].activityType !== "UNIVERSAL_SALVATION") {
    console.error(`RitualRecord ${RITUAL_RECORD_ID} 不屬於 ${HOUSEHOLD_CODE} 或非普渡，停止。`); process.exit(1);
  }

  // 2) 目標：該 RR 內 CANCELLED 的 US_YUANQIN RRI。
  const cancelled = await prisma.$queryRawUnsafe<RriRow[]>(
    `SELECT rri."id", rri."universalSalvationEntryId" AS "entryId", rri."amountPaid", rri."status"
     FROM "ritual_registration_items" rri
     JOIN "registration_item_types" rit ON rit."id" = rri."registrationItemTypeId" AND rit."key" = 'US_YUANQIN'
     WHERE rri."ritualRecordId" = $1 AND rri."status" = 'CANCELLED'`, RITUAL_RECORD_ID
  );
  // 保留：同 RR 內「非 CANCELLED、未軟刪」的 US_YUANQIN（OK 正常資料）。
  const okRows = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM "ritual_registration_items" rri
     JOIN "registration_item_types" rit ON rit."id" = rri."registrationItemTypeId" AND rit."key" = 'US_YUANQIN'
     WHERE rri."ritualRecordId" = $1 AND rri."status" <> 'CANCELLED' AND rri."deletedAt" IS NULL`, RITUAL_RECORD_ID
  );
  const okCount = okRows[0]?.n ?? 0;

  const entryIds = cancelled.map((r) => r.entryId).filter((x): x is string => !!x);
  const inList = entryIds.length ? entryIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",") : "''";

  // 3) 對應預設列印物件（isExtra=false：預設 TABLET／基本 POCKET）；額外寶袋（isExtra=true）不列入。
  const printObjs = entryIds.length
    ? await prisma.$queryRawUnsafe<PoRow[]>(
        `SELECT "id","sourceEntryId","itemType","isExtra","printCount","deletedAt"
         FROM "additional_print_items" WHERE "sourceEntryId" IN (${inList})`)
    : [];
  const defaultObjs = printObjs.filter((p) => !p.isExtra);
  const extraObjs = printObjs.filter((p) => p.isExtra);
  const tabletN = defaultObjs.filter((p) => p.itemType === "TABLET").length;
  const pocketN = defaultObjs.filter((p) => p.itemType === "POCKET").length;

  // 4) 財務關聯檢查（US 付款、收款分錄、收據行）。
  const rriIds = cancelled.map((r) => r.id);
  const rriInList = rriIds.length ? rriIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",") : "''";
  const usPay = rriIds.length ? await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM "universal_salvation_payments" WHERE "ritualRegistrationItemId" IN (${rriInList})`) : [{ n: 0 }];
  const alloc = rriIds.length ? await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM "payment_allocations" WHERE "sourceId" IN (${rriInList})`) : [{ n: 0 }];
  const receiptLine = rriIds.length ? await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM "receipt_lines" WHERE "sourceId" IN (${rriInList})`) : [{ n: 0 }];
  const financeLinks = (usPay[0]?.n ?? 0) + (alloc[0]?.n ?? 0) + (receiptLine[0]?.n ?? 0);

  // 5) 逐筆安全檢查：amountPaid=0、status=CANCELLED、printCount=0、無財務關聯。任一違反 → 整批停止。
  const violations: string[] = [];
  for (const r of cancelled) {
    if (Number(r.amountPaid) !== 0) violations.push(`RRI ${r.id} amountPaid=${r.amountPaid}≠0`);
    if (r.status !== "CANCELLED") violations.push(`RRI ${r.id} status=${r.status}≠CANCELLED`);
  }
  for (const p of defaultObjs) if ((p.printCount ?? 0) > 0) violations.push(`列印物件 ${p.id} printCount=${p.printCount}>0`);
  if (financeLinks > 0) violations.push(`偵測到財務關聯 ${financeLinks} 筆（US付款/收款分錄/收據行）`);

  console.log("=== V33 §9 取消冤親測試資料 清理（專用腳本）===");
  console.log(`模式：${commit ? "COMMIT（會寫入）" : "DRY-RUN（唯讀）"}`);
  console.log(`家戶：${HOUSEHOLD_CODE}｜RitualRecord：${RITUAL_RECORD_ID}`);
  console.log(`預計清理：CANCELLED item ${cancelled.length}｜對應 Entry ${entryIds.length}｜預設 TABLET ${tabletN}｜基本 POCKET ${pocketN}`);
  console.log(`保留：OK 正常資料 ${okCount} 筆｜額外寶袋 ${extraObjs.length}（不動）｜財務關聯 ${financeLinks}`);

  if (violations.length > 0) {
    console.error("\n⚠️ 安全檢查未通過，整批停止（不部分執行）：");
    for (const v of violations) console.error("  - " + v);
    process.exit(2);
  }
  console.log("\n安全檢查通過：全部 amountPaid=0、status=CANCELLED、printCount=0、無財務關聯。");

  if (!commit) {
    console.log("\nDRY-RUN 結束，未寫入任何資料。確認無誤後加 --commit 執行（交易、冪等、可重跑）。");
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    let items = 0, ents = 0, objs = 0;
    for (const r of cancelled) {
      items += Number(await tx.$executeRawUnsafe(
        `UPDATE "ritual_registration_items" SET "deletedAt"=NOW(),"deletedByName"=$1 WHERE "id"=$2 AND "deletedAt" IS NULL AND "status"='CANCELLED'`,
        OPERATOR, r.id)) || 0;
      if (r.entryId) ents += Number(await tx.$executeRawUnsafe(
        `UPDATE "universal_salvation_entries" SET "deletedAt"=NOW() WHERE "id"=$1 AND "deletedAt" IS NULL`, r.entryId)) || 0;
    }
    for (const p of defaultObjs) {
      objs += Number(await tx.$executeRawUnsafe(
        `UPDATE "additional_print_items" SET "deletedAt"=NOW(),"deletedByName"=$1 WHERE "id"=$2 AND "deletedAt" IS NULL AND "isExtra"=false AND "printCount"=0`,
        OPERATOR, p.id)) || 0;
    }
    return { items, ents, objs };
  });
  console.log(`\nCOMMIT 完成（軟刪除）：item ${result.items}｜entry ${result.ents}｜預設列印物件 ${result.objs}。可重跑（冪等）。`);
  console.log("請重新執行 scripts/yuanqinDuplicateDiagnose.ts 確認 15 筆 CANCELLED 已不在有效清單、2 筆 OK 仍存在。");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
