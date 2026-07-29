/**
 * 一次性清理工具：清除「V15R4 年度燈統一前殘留、且完全空殼」的舊 TempleEvent。
 *
 * ── 背景 ───────────────────────────────────────────────────────
 * V15R4 起，光明燈／太歲燈／全家燈／祭改統一成單一「年度燈（ANNUAL_LANTERN）」
 * TempleEvent。統一 migration 刻意**不搬移**統一前已存在的獨立 TempleEvent，
 * 以保留舊年度的實際報名/祭改/列印資料。結果：某些年度會同時看到「年度燈」
 * 與殘留的獨立「光明燈」「祭改」活動卡。本工具只清掉其中**完全沒有任何業務
 * 子資料**的空殼，讓 /activities 不再顯示殘留。
 *
 * ── 處理範圍（本版刻意收斂）─────────────────────────────────────
 *   年度：預設鎖定民國 116（可用 --year 覆蓋）。
 *   類型：只允許 GUANGMING_LANTERN（光明燈）與 PURIFICATION（祭改）。
 *   明確排除：ANNUAL_LANTERN（新架構年度燈）——程式內有雙重防呆，
 *            絕不會被納入候選（見 ALLOWED / FORBIDDEN 斷言）。
 *
 * ── TempleEvent 子關聯分類（決定空殼判定）─────────────────────────
 * ① 真正業務資料（存在即禁止刪除）——以下任一 > 0 就跳過：
 *      records                 報名（RitualRecord）
 *      purificationEntries     祭改報名
 *      offeringClaims          供品認捐（含收款/退款/收據）
 *      printBatches            列印批次
 *      additionalPrintItems    普渡附加列印（寶袋等，含金額）
 *      expenses                活動支出
 *      financeRecords          財務流水
 *      stoveMasterRegistrations 爐主登錄
 *      bannedNumbers           祭改額外禁用號碼（人工設定）
 *      activityOfferings       供品設定（③純設定，但本版保守一律當有資料→跳過）
 *      floralOfferingSlots     花果排程（由花果供品設定衍生，同上）
 *    另有兩個「純快照欄位」（templeEventId 非 FK 關聯，_count 抓不到，另計）：
 *      importBatch             匯入歷史
 *      purificationImportBatch 祭改匯入歷史
 * ② 系統自動建立、可隨空殼一併刪、不阻擋判定：
 *      checklist               活動待辦清單（每次建立自動 seed，無業務內容）
 *
 * 註：V26.1 供品模板只對四聖壽／宮慶自動建立供品，對光明燈／祭改**不會**自動
 *     seed 供品——所以這兩類活動上若出現 activityOfferings，必是人工加入，
 *     本版一律視為「有資料」跳過，不刪。
 *
 * ── 安全機制 ───────────────────────────────────────────────────
 *   - 預設 dry-run，只列出、不刪；必須加 --commit 才實際刪除。
 *   - 計數不排除軟刪除（deletedAt 非 null）列——曾有任何子資料一律保留。
 *   - commit 時每筆在**同一交易內重查一次**仍為空殼才刪，避免掃描到刪除之間
 *     有人新增資料而誤刪；每筆刪除寫一筆 RecordVersion(DELETE) 稽核。
 *
 * ── 用法（需資料庫連線的環境，例如本機 Mac）─────────────────────
 *   Dry-run（預設，民國116）：npx tsx scripts/cleanupLegacyTempleEvents.ts
 *   實際刪除：                npx tsx scripts/cleanupLegacyTempleEvents.ts --commit
 *   指定其他年度：            npx tsx scripts/cleanupLegacyTempleEvents.ts --year 115
 *
 * ── 絕不做 ──
 *   不改 schema、不建 migration、不改現行活動流程、不動有任何業務子資料的活動。
 */
import { ActivityType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";

/** 允許處理的舊獨立類型（本版只有光明燈與祭改）。 */
const ALLOWED_ACTIVITY_TYPES: ActivityType[] = ["GUANGMING_LANTERN", "PURIFICATION"];
/** 明確禁止處理的類型（新架構年度燈，雙重防呆）。 */
const FORBIDDEN_ACTIVITY_TYPES: ActivityType[] = ["ANNUAL_LANTERN"];
/** 預設鎖定的年度（民國年）。 */
const DEFAULT_YEAR = 116;

/** TempleEvent 上「業務子資料」反向關聯（用於 _count，不含自動 seed 的 checklist）。 */
const SUBSTANTIVE_RELATIONS = [
  "records",
  "bannedNumbers",
  "printBatches",
  "expenses",
  "financeRecords",
  "purificationEntries",
  "additionalPrintItems",
  "activityOfferings",
  "floralOfferingSlots",
  "offeringClaims",
  "stoveMasterRegistrations",
] as const;

const COUNT_SELECT = {
  records: true,
  bannedNumbers: true,
  printBatches: true,
  expenses: true,
  financeRecords: true,
  purificationEntries: true,
  additionalPrintItems: true,
  activityOfferings: true,
  floralOfferingSlots: true,
  offeringClaims: true,
  stoveMasterRegistrations: true,
  checklist: true,
} satisfies Prisma.TempleEventCountOutputTypeSelect;

type CountShape = Record<(typeof SUBSTANTIVE_RELATIONS)[number] | "checklist", number>;

/** 純快照欄位參照（templeEventId 非 FK 關聯，需另外查）。 */
async function countSnapshotRefs(
  client: Prisma.TransactionClient | typeof prisma,
  templeEventId: string
): Promise<{ importBatch: number; purificationImportBatch: number }> {
  const [importBatch, purificationImportBatch] = await Promise.all([
    client.importBatch.count({ where: { templeEventId } }),
    client.purificationImportBatch.count({ where: { templeEventId } }),
  ]);
  return { importBatch, purificationImportBatch };
}

/** 回傳所有 > 0 的業務子資料項目（給輸出用）；空陣列＝完全空殼。 */
function nonEmptyReasons(count: CountShape, snap: { importBatch: number; purificationImportBatch: number }): string[] {
  const reasons: string[] = [];
  for (const key of SUBSTANTIVE_RELATIONS) if (count[key] > 0) reasons.push(`${key}=${count[key]}`);
  if (snap.importBatch > 0) reasons.push(`importBatch=${snap.importBatch}`);
  if (snap.purificationImportBatch > 0) reasons.push(`purificationImportBatch=${snap.purificationImportBatch}`);
  return reasons;
}

type Args = { commit: boolean; year: number };
function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Args = { commit: false, year: DEFAULT_YEAR };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--commit") out.commit = true;
    else if (argv[i] === "--year") {
      const v = Number(argv[++i]);
      if (Number.isFinite(v)) out.year = v;
    }
  }
  return out;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function main() {
  const args = parseArgs();

  // 防呆：允許清單不得與禁止清單重疊（例如永不允許 ANNUAL_LANTERN）。
  const overlap = ALLOWED_ACTIVITY_TYPES.filter((t) => FORBIDDEN_ACTIVITY_TYPES.includes(t));
  if (overlap.length > 0) {
    throw new Error(`允許清單誤含禁止類型：${overlap.join(", ")}，中止以策安全`);
  }

  const candidates = await prisma.templeEvent.findMany({
    where: { activityType: { in: ALLOWED_ACTIVITY_TYPES }, year: args.year },
    include: { _count: { select: COUNT_SELECT } },
    orderBy: [{ activityType: "asc" }, { createdAt: "asc" }],
  });

  console.log("========================================================");
  console.log(`舊 TempleEvent 清理工具　模式：${args.commit ? "COMMIT（實際刪除）" : "DRY-RUN（不刪除）"}`);
  console.log(`年度：民國 ${args.year}　允許類型：${ALLOWED_ACTIVITY_TYPES.join(" / ")}　排除：${FORBIDDEN_ACTIVITY_TYPES.join(" / ")}`);
  console.log("========================================================");

  if (candidates.length === 0) {
    console.log("沒有符合條件的舊活動，無需處理。");
    return;
  }

  const empties: typeof candidates = [];
  let keptCount = 0;

  for (const e of candidates) {
    // 雙重防呆：候選一定在允許清單、且一定不是禁止類型。
    if (!ALLOWED_ACTIVITY_TYPES.includes(e.activityType) || FORBIDDEN_ACTIVITY_TYPES.includes(e.activityType)) {
      console.log(`\n[跳過] 非允許類型（防呆攔截）：${e.activityType}　id=${e.id}`);
      keptCount += 1;
      continue;
    }

    const count = e._count as CountShape;
    const snap = await countSnapshotRefs(prisma, e.id);
    const reasons = nonEmptyReasons(count, snap);
    const isEmpty = reasons.length === 0;

    if (isEmpty) empties.push(e);
    else keptCount += 1;

    const allDetail =
      SUBSTANTIVE_RELATIONS.map((k) => `${k}=${count[k]}`).join(" ") +
      ` importBatch=${snap.importBatch} purificationImportBatch=${snap.purificationImportBatch}`;
    console.log(`\n[${isEmpty ? "可清（完全空殼）" : "跳過（有業務資料）"}] ${e.activityType}　民國${e.year}　${e.name}`);
    console.log(`  id=${e.id}　status=${e.status}　createdAt=${fmtDate(e.createdAt)}　checklist=${count.checklist}（自動seed，可連帶刪）`);
    console.log(`  子資料：${allDetail}`);
    if (!isEmpty) console.log(`  ← 保留原因：存在 ${reasons.join("、")}`);
  }

  console.log("\n--------------------------------------------------------");
  console.log(`合計：候選 ${candidates.length}　可清 ${empties.length}　跳過/保留 ${keptCount}`);
  console.log("--------------------------------------------------------");

  if (!args.commit) {
    console.log("\nDRY-RUN 結束，未刪除任何資料。確認上方「可清」清單無誤後，加 --commit 執行實際刪除。");
    return;
  }
  if (empties.length === 0) {
    console.log("\n沒有可刪除的空殼，結束。");
    return;
  }

  console.log("\n開始刪除空殼（每筆交易內重查仍為空殼才刪，並寫入稽核紀錄）…");
  let deleted = 0;
  let skipped = 0;

  for (const e of empties) {
    const result = await prisma.$transaction(async (tx) => {
      const fresh = await tx.templeEvent.findUnique({ where: { id: e.id }, include: { _count: { select: COUNT_SELECT } } });
      if (!fresh) return { status: "gone" as const };
      // 交易內再次防呆＋重查所有子資料（含純快照參照）。
      if (!ALLOWED_ACTIVITY_TYPES.includes(fresh.activityType) || FORBIDDEN_ACTIVITY_TYPES.includes(fresh.activityType)) {
        return { status: "forbidden" as const };
      }
      const snap = await countSnapshotRefs(tx, e.id);
      const reasons = nonEmptyReasons(fresh._count as CountShape, snap);
      if (reasons.length > 0) return { status: "not-empty" as const, reasons };

      await tx.templeEventChecklistItem.deleteMany({ where: { templeEventId: e.id } });
      await tx.templeEvent.delete({ where: { id: e.id } });
      await recordVersion(
        {
          entityType: "TempleEvent",
          entityId: e.id,
          action: "DELETE",
          beforeData: fresh,
          operatorName: "cleanupLegacyTempleEvents",
          changeNote: "清除 V15R4 年度燈統一前殘留、完全空殼的舊活動（僅光明燈/祭改、無任何業務子資料）",
        },
        tx
      );
      return { status: "deleted" as const };
    });

    if (result.status === "deleted") {
      deleted += 1;
      console.log(`  ✓ 已刪除　${e.activityType}　民國${e.year}　${e.name}（id=${e.id}）`);
    } else {
      skipped += 1;
      const why =
        result.status === "gone"
          ? "已不存在"
          : result.status === "forbidden"
            ? "防呆攔截（非允許類型）"
            : `重查發現已有資料：${result.reasons.join("、")}`;
      console.log(`  ⚠ 跳過（${why}）　id=${e.id}`);
    }
  }

  console.log("\n--------------------------------------------------------");
  console.log(`刪除完成：實刪 ${deleted}　跳過 ${skipped}`);
  console.log("--------------------------------------------------------");
}

main()
  .catch((err) => {
    console.error("清理工具執行失敗：", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
