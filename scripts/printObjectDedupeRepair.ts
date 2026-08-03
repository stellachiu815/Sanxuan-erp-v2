/**
 * V33 §9 重複「預設列印物件」安全修復（dry-run 預設；--commit 才寫入）。
 *
 *   # 1) 預覽（唯讀）——強烈建議先跑，確認保留/移除清單
 *   npx tsx scripts/printObjectDedupeRepair.ts
 *   YEAR=115 npx tsx scripts/printObjectDedupeRepair.ts
 *   # 2) 實際修復（交易、冪等、可重跑）——軟刪除多餘的預設 TABLET／基本 POCKET
 *   npx tsx scripts/printObjectDedupeRepair.ts --commit
 *
 * 規則（規格 §6/§7）：
 *   - 只處理**同一 (sourceEntryId, itemType) 的預設物件（isExtra=false、未刪除）出現 ≥2 筆**的情況。
 *   - 保留一筆（printCount 最大→createdAt 最早→id 最小），其餘**軟刪除**（deletedAt/ deletedByName）。
 *   - 額外寶袋（isExtra=true）一律不動；CANCELLED／已軟刪不動。
 *   - **不改**金額／收款／收據／財務／registrationOrder／workOrder；不硬刪、不合併 Entry。
 *   - 交易內完成；冪等（已刪除者略過）；可重複執行。
 *   - 「同一 Member 多筆有效冤親 Entry」屬 NEEDS_REVIEW，本腳本**不處理**（需人工，見診斷報告）。
 */
import { prisma } from "../src/lib/prisma";
import { duplicateDefaultPrintObjects } from "../src/lib/TabletBatchService";

type Row = { id: string; sourceEntryId: string; itemType: string; isExtra: boolean; printCount: number; createdAt: Date | null; deletedAt: Date | null };

async function main() {
  const commit = process.argv.includes("--commit");
  const yearEnv = process.env.YEAR ? Number(process.env.YEAR) : null;
  const by = process.env.OPERATOR ?? "system:printObjectDedupeRepair";

  // 取所有 UNIVERSAL_SALVATION 的列印物件（限本年度可選）；只在 active（未刪）中判定重複。
  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT api."id", api."sourceEntryId", api."itemType", api."isExtra", api."printCount", api."createdAt", api."deletedAt"
    FROM "additional_print_items" api
    JOIN "ritual_records" rr ON rr."id" = api."ritualRecordId"
    WHERE rr."activityType" = 'UNIVERSAL_SALVATION' AND api."deletedAt" IS NULL
      ${yearEnv != null ? `AND rr."year" = ${yearEnv}` : ""}
  `);

  const dupGroups = duplicateDefaultPrintObjects(
    rows.map((r) => ({ id: r.id, sourceEntryId: r.sourceEntryId, itemType: r.itemType, isExtra: r.isExtra, printCount: r.printCount ?? 0, createdAt: r.createdAt }))
  );
  const removeIds = dupGroups.flatMap((g) => g.removeIds);

  console.log("=== V33 §9 重複預設列印物件修復 ===");
  console.log(`模式：${commit ? "COMMIT（會寫入）" : "DRY-RUN（唯讀）"}｜年度：${yearEnv ?? "全部"}`);
  console.log(`重複組數：${dupGroups.length}｜移除候選：${removeIds.length} 筆`);
  for (const g of dupGroups) {
    console.log(`  entry ${g.sourceEntryId} ${g.itemType}｜保留 ${g.keepId}｜移除 ${g.removeIds.join(", ")}`);
  }

  if (!commit) {
    console.log("\nDRY-RUN 結束，未寫入任何資料。確認清單無誤後，加 --commit 執行修復。");
    return;
  }
  if (removeIds.length === 0) {
    console.log("\n無重複可修復。");
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    let n = 0;
    for (const id of removeIds) {
      // 冪等：只軟刪仍未刪除者；不動金額/收款/registrationOrder/workOrder。
      const r = await tx.$executeRawUnsafe(
        `UPDATE "additional_print_items" SET "deletedAt" = NOW(), "deletedByName" = $1, "updatedAt" = NOW()
         WHERE "id" = $2 AND "deletedAt" IS NULL AND "isExtra" = false`,
        by, id
      );
      n += Number(r) || 0;
    }
    return n;
  });
  console.log(`\nCOMMIT 完成：軟刪除 ${result} 筆多餘預設列印物件（可重跑，冪等）。額外寶袋與 CANCELLED 未受影響。`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
