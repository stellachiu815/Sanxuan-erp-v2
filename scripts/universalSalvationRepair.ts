/**
 * V30.5/6/7 中元普渡「既有資料安全修復」腳本。
 *
 * ⚠️ 預設**唯讀 dry-run**；只有 --commit 才可能寫入。限定該年度中元普渡（預設 115）。
 * 復用既有正式流程與共用架構，不建第二套。不改金額／已收款／收據／財務。
 *
 * 用法：
 *   dry-run 全部：  npx tsx scripts/universalSalvationRepair.ts 115
 *   單獨階段預覽：  npx tsx scripts/universalSalvationRepair.ts 115 --restore-orphans
 *   單獨階段寫入：  npx tsx scripts/universalSalvationRepair.ts 115 --restore-orphans --commit
 *   （未指定任何階段時：只預覽全部三階段、一律不寫入，即使加 --commit。）
 *
 * 階段（可單獨指定；每階段冪等、可重跑、正式寫入以 transaction）：
 *   --restore-orphans       A 孤兒冤親 RESTORE（只恢復原軟刪 item，不新建、不改金額/建立時間/收款/編號）
 *   --confirm-safe-drafts   B DRAFT→SAFE_CONFIRM（過既有 validateForConfirm 才 confirmRegistration；未收款可確認；不改金額）
 *   --assign-missing-orders C registrationOrder 補號（NULL→applyRegistrationOrder；已有號不動；NULL templeEventId 不處理）
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { parseRepairArgs } from "@/lib/repairArgs";
import { backfillMissingTabletItems } from "@/lib/tabletItemBackfill";
import { validateForConfirm, confirmRegistration } from "@/lib/activityRegistration";
import { applyRegistrationOrder } from "@/lib/registrationOrder";

const OPERATOR = "系統修復(V30.7)";

async function main() {
  const { year, commit, stages, writeEnabled, explicitStages } = parseRepairArgs(process.argv.slice(2));
  const mode = writeEnabled ? "【正式寫入 --commit】" : commit && !explicitStages ? "【--commit 但未指定階段 → 只預覽、不寫入】" : "【唯讀 dry-run】";
  console.log(`=== V30.7 中元普渡資料修復 ${mode} year=${year} ===`);
  console.log(`本次階段：${[stages.restoreOrphans && "RESTORE_ORPHANS", stages.confirmSafeDrafts && "CONFIRM_SAFE_DRAFTS", stages.assignMissingOrders && "ASSIGN_MISSING_ORDERS"].filter(Boolean).join(" / ")}\n`);

  const records = await prisma.ritualRecord.findMany({
    where: { activityType: "UNIVERSAL_SALVATION", year, deletedAt: null },
    select: { id: true, status: true, household: { select: { name: true } } },
  });
  const recordIds = new Set(records.map((r) => r.id));
  console.log(`本年度中元普渡 RitualRecord：${records.length} 筆\n`);

  // ── A. 孤兒冤親 RESTORE ──
  if (stages.restoreOrphans) {
    console.log("── A. 孤兒冤親（RESTORE 可唯一判定者）──");
    const preview = await backfillMissingTabletItems({ commit: false, categories: ["DEBT_CREDITOR"] });
    const inYear = preview.plan.filter((p) => recordIds.has(p.entry.ritualRecordId));
    const restoreTargets = inYear.filter((p) => p.action === "RESTORE");
    const skip = inYear.filter((p) => p.action !== "RESTORE");
    console.log(`  處理前：本年度孤兒冤親 ${inYear.length}；可 RESTORE ${restoreTargets.length}；不處理 ${skip.length}`);
    for (const p of restoreTargets) console.log(`    ✔ [RESTORE] entry=${p.entry.entryId} 姓名=${p.entry.displayName} item=${p.itemId ?? "—"}`);
    for (const p of skip) console.log(`    ✘ 略過 entry=${p.entry.entryId} 動作=${p.action} 原因=${p.reason ?? "—"}`);
    if (writeEnabled && restoreTargets.length > 0) {
      const targetIds = new Set(restoreTargets.map((p) => p.entry.entryId));
      const excludeEntryIds = preview.orphans.map((o) => o.entryId).filter((id) => !targetIds.has(id));
      const res = await backfillMissingTabletItems({ commit: true, categories: ["DEBT_CREDITOR"], excludeEntryIds });
      const after = await backfillMissingTabletItems({ commit: false, categories: ["DEBT_CREDITOR"] });
      const remain = after.plan.filter((p) => recordIds.has(p.entry.ritualRecordId) && p.action === "RESTORE").length;
      console.log(`  → 已 RESTORE ${res.restored.length} 筆；處理後剩餘可 RESTORE ${remain} 筆。`);
    }
    console.log("");
  }

  // ── B. DRAFT → SAFE_CONFIRM ──
  if (stages.confirmSafeDrafts) {
    console.log("── B. DRAFT item（僅對通過 validateForConfirm 的 record 確認）──");
    const before = await prisma.ritualRegistrationItem.count({ where: { ritualRecordId: { in: [...recordIds] }, deletedAt: null, status: "DRAFT" } });
    const draftRecords = await prisma.ritualRegistrationItem.groupBy({
      by: ["ritualRecordId"],
      where: { ritualRecordId: { in: [...recordIds] }, deletedAt: null, status: "DRAFT" },
      _count: { _all: true },
    });
    console.log(`  處理前：DRAFT item ${before} 筆，分佈於 ${draftRecords.length} 個 record`);
    let safe = 0;
    const blocked: { record: string; household: string; reasons: string[] }[] = [];
    for (const dr of draftRecords) {
      const rec = records.find((r) => r.id === dr.ritualRecordId);
      const v = await validateForConfirm(dr.ritualRecordId);
      if (v.ok) {
        safe += 1;
        if (writeEnabled) {
          const c = await confirmRegistration(dr.ritualRecordId, OPERATOR);
          console.log(`    ✔ [SAFE_CONFIRM] record=${dr.ritualRecordId}（${rec?.household.name ?? ""}）DRAFT=${dr._count._all} → ${c.ok ? "已確認" : "失敗:" + c.error}`);
        } else {
          console.log(`    ✔ [SAFE_CONFIRM] record=${dr.ritualRecordId}（${rec?.household.name ?? ""}）DRAFT=${dr._count._all}`);
        }
      } else {
        blocked.push({ record: dr.ritualRecordId, household: rec?.household.name ?? "", reasons: v.reasons });
      }
    }
    console.log(`  SAFE_CONFIRM：${safe} 筆；NEEDS_REVIEW（維持 DRAFT）：${blocked.length} 筆`);
    for (const b of blocked) console.log(`    ✘ [NEEDS_REVIEW] record=${b.record}（${b.household}）：${b.reasons.join("；")}`);
    if (writeEnabled) {
      const after = await prisma.ritualRegistrationItem.count({ where: { ritualRecordId: { in: [...recordIds] }, deletedAt: null, status: "DRAFT" } });
      console.log(`  → 處理後剩餘 DRAFT item ${after} 筆（NEEDS_REVIEW 維持）。`);
    }
    console.log("");
  }

  // ── C. registrationOrder 補號 ──
  if (stages.assignMissingOrders) {
    console.log("── C. registrationOrder 補號（缺號者用既有 applyRegistrationOrder）──");
    const nullOrder = await prisma.$queryRaw<{ id: string; ritualRecordId: string; typeId: string }[]>`
      SELECT rri."id", rri."ritualRecordId", rri."registrationItemTypeId" AS "typeId"
      FROM "ritual_registration_items" rri JOIN "ritual_records" rr ON rr."id" = rri."ritualRecordId"
      WHERE rr."activityType" = 'UNIVERSAL_SALVATION' AND rr."year" = ${year} AND rr."deletedAt" IS NULL
        AND rri."deletedAt" IS NULL AND rri."registrationOrder" IS NULL AND rr."templeEventId" IS NOT NULL
      ORDER BY rri."createdAt"`;
    console.log(`  處理前：[SAFE_ASSIGN_ORDER] registrationOrder NULL 且活動已歸屬者 ${nullOrder.length} 筆（NULL templeEventId 不處理；已有號不動）`);
    if (writeEnabled && nullOrder.length > 0) {
      let assigned = 0;
      for (const it of nullOrder) {
        await prisma.$transaction(async (tx) => {
          const ord = await applyRegistrationOrder(tx, it.id, it.ritualRecordId, it.typeId);
          if (ord != null) assigned += 1;
        });
      }
      const after = await prisma.$queryRaw<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM "ritual_registration_items" rri JOIN "ritual_records" rr ON rr."id" = rri."ritualRecordId"
        WHERE rr."activityType" = 'UNIVERSAL_SALVATION' AND rr."year" = ${year} AND rr."deletedAt" IS NULL
          AND rri."deletedAt" IS NULL AND rri."registrationOrder" IS NULL AND rr."templeEventId" IS NOT NULL`;
      console.log(`  → 已補號 ${assigned} 筆；處理後剩餘 NULL ${after[0]?.n ?? 0} 筆。`);
    }
    console.log("");
  }

  console.log(`=== 結束（${writeEnabled ? "已寫入" : "未寫入 / dry-run"}）===`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
