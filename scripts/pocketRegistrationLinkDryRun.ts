/**
 * V30.3c 寶袋統一資料鏈（RitualRegistrationItem US_POCKET_EXTRA ↔ AdditionalPrintItem POCKET）
 * — 既有資料「唯讀」盤點。
 *
 * ⚠️ 完全唯讀：只查詢、只印出結果，**不寫入、不更新、不刪除、不 backfill 任何正式資料**。
 * 目的：在正式回填 registrationItemId／補建缺漏資料之前，看清楚既有寶袋資料現況與可安全處理範圍。
 *
 * 使用方式（Mac、專案根目錄；自動讀 .env 的 DATABASE_URL）：
 *   npx tsx scripts/pocketRegistrationLinkDryRun.ts
 *
 * 分類（對應正式指令 五、既有資料 dry-run）：
 *   [A] 已連結：AdditionalPrintItem.registrationItemId 非 null（新式，已完成）。
 *   [B] 基本寶袋未連結：itemType=POCKET, isExtra=false, registrationItemId=null → 需補一筆 US_POCKET_EXTRA 報名項目。
 *   [C] 額外寶袋未連結（legacy）：itemType=POCKET, isExtra=true, registrationItemId=null → 舊式，保留 legacy 應收；可否唯一配對既有 US_POCKET_EXTRA item。
 *   [D] US_POCKET_EXTRA 報名項目無對應寶袋列印物件 → 需補一筆 AdditionalPrintItem。
 *   [E] 已取消／已刪除／跨活動異常。
 *   [F] 一對多／多對多、無法唯一配對 → 維持原狀，人工判斷。
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";

type PocketRow = {
  id: string;
  householdId: string;
  ritualRecordId: string;
  memberId: string | null;
  printName: string;
  isExtra: boolean;
  status: string;
  deletedAt: Date | null;
  registrationItemId: string | null;
  recordDeletedAt: Date | null;
  templeEventId: string | null;
};
type RegRow = {
  id: string;
  ritualRecordId: string;
  memberId: string | null;
  registrationOrder: number | null;
  status: string;
  deletedAt: Date | null;
  linkedPocketCount: number;
};

async function main() {
  console.log("=== V30.3c 寶袋統一資料鏈 dry-run（唯讀，不寫入任何資料）===\n");

  const pockets = await prisma.$queryRaw<PocketRow[]>`
    SELECT api."id", api."householdId", api."ritualRecordId", api."memberId",
           api."printName", api."isExtra", api."status", api."deletedAt",
           api."registrationItemId", rr."deletedAt" AS "recordDeletedAt", rr."templeEventId"
    FROM "additional_print_items" api
    JOIN "ritual_records" rr ON rr."id" = api."ritualRecordId"
    WHERE api."itemType" = 'POCKET' AND rr."activityType" = 'UNIVERSAL_SALVATION'
  `;

  const regs = await prisma.$queryRaw<RegRow[]>`
    SELECT rri."id", rri."ritualRecordId", rri."memberId", rri."registrationOrder",
           rri."status", rri."deletedAt",
           (SELECT COUNT(*)::int FROM "additional_print_items" a WHERE a."registrationItemId" = rri."id") AS "linkedPocketCount"
    FROM "ritual_registration_items" rri
    JOIN "registration_item_types" rit ON rit."id" = rri."registrationItemTypeId"
    JOIN "ritual_records" rr ON rr."id" = rri."ritualRecordId"
    WHERE rit."key" = 'US_POCKET_EXTRA' AND rr."activityType" = 'UNIVERSAL_SALVATION'
  `;

  const cat = {
    linked: [] as PocketRow[],
    basicUnlinked: [] as PocketRow[],
    extraUnlinked: [] as PocketRow[],
    abnormal: [] as PocketRow[],
    regNoPocket: [] as RegRow[],
    regMultiPocket: [] as RegRow[],
  };

  const regsByRecord = new Map<string, RegRow[]>();
  for (const r of regs) {
    if (r.deletedAt == null) {
      const arr = regsByRecord.get(r.ritualRecordId) ?? [];
      arr.push(r);
      regsByRecord.set(r.ritualRecordId, arr);
    }
    if (r.linkedPocketCount === 0 && r.deletedAt == null) cat.regNoPocket.push(r);
    if (r.linkedPocketCount > 1) cat.regMultiPocket.push(r);
  }

  const alreadyLinkedRegIds = new Set(pockets.map((p) => p.registrationItemId).filter((x): x is string => !!x));
  const uniqueMatch: { pocket: PocketRow; reg: RegRow }[] = [];
  const cannotMatch: PocketRow[] = [];

  for (const p of pockets) {
    if (p.deletedAt || p.recordDeletedAt || p.status === "CANCELLED") {
      cat.abnormal.push(p);
      continue;
    }
    if (p.registrationItemId) {
      cat.linked.push(p);
      continue;
    }
    if (!p.isExtra) {
      cat.basicUnlinked.push(p);
      continue;
    }
    // 額外寶袋 legacy（未連結）：嘗試唯一配對既有 US_POCKET_EXTRA item。
    cat.extraUnlinked.push(p);
    const candidates = (regsByRecord.get(p.ritualRecordId) ?? []).filter(
      (r) => !alreadyLinkedRegIds.has(r.id) && (p.memberId == null || r.memberId === p.memberId)
    );
    if (candidates.length === 1) uniqueMatch.push({ pocket: p, reg: candidates[0] });
    else cannotMatch.push(p);
  }

  const line = (label: string, n: number) => console.log(`${label}：${n} 筆`);
  console.log(`POCKET 列印物件總數：${pockets.length}；US_POCKET_EXTRA 報名項目總數：${regs.length}\n`);
  line("[A] 已連結（registrationItemId 非 null）", cat.linked.length);
  line("[B] 基本寶袋未連結（需補 US_POCKET_EXTRA 報名項目）", cat.basicUnlinked.length);
  line("[C] 額外寶袋未連結 legacy（保留 legacy 應收）", cat.extraUnlinked.length);
  line("    ├─ 其中可唯一配對既有 US_POCKET_EXTRA item（本輪不寫入）", uniqueMatch.length);
  line("    └─ 無法唯一配對（0 或多候選）", cannotMatch.length);
  line("[D] US_POCKET_EXTRA 報名項目無對應寶袋列印物件（需補 AdditionalPrintItem）", cat.regNoPocket.length);
  line("[E] 已取消／已刪除／跨活動異常寶袋", cat.abnormal.length);
  line("[F] 一報名對多寶袋（需人工判斷）", cat.regMultiPocket.length);

  console.log("\n【可唯一配對明細（僅預覽，未寫入）】");
  for (const m of uniqueMatch) {
    console.log(`  - ${m.pocket.printName}（pocket ${m.pocket.id}）→ US_POCKET_EXTRA ${m.reg.id}（order=${m.reg.registrationOrder ?? "null"}）`);
  }

  console.log("\n（唯讀結束；未寫入、未 backfill、未修改任何資料。）");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
