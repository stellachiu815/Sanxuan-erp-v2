/**
 * V34.3：115 普渡「匯入 46 列 ↔ V34 列印筆數」對帳（唯讀，只 SELECT／沿用既有查詢，不改任何資料）。
 *
 * 重點：直接沿用正式 print-v34 的同一條查詢與批次規則，數字與畫面一致：
 *   listPrintItemsForPrintCenter(115, {})  → 一列一個列印物件（TABLET/POCKET）
 *   filterBatchItems / batchOf / isUnprinted / isComplete / isPrintableStatus（TabletBatchService）
 * 另從 purification_import_batches/rows 取 46 列 Excel 對照。
 *
 *   npx tsx scripts/auditImportPrintV34_115.ts
 */
import { prisma } from "../src/lib/prisma";
import { listPrintItemsForPrintCenter } from "../src/lib/additionalPrintItems";
import {
  filterBatchItems,
  batchOf,
  isUnprinted,
  isComplete,
  isPrintableStatus,
  type BatchItem,
} from "../src/lib/TabletBatchService";

const YEAR = 115;
const CAT_LABEL: Record<string, string> = {
  ANCESTOR_LINE: "歷代祖先",
  INDIVIDUAL_SOUL: "乙位正魂",
  UNBORN_CHILD: "無緣子女",
  DEBT_CREDITOR: "累世冤親債主",
};

function catZh(raw: string | null | undefined): string {
  const k = (raw ?? "").trim();
  return CAT_LABEL[k] ?? k ?? "（未分類）";
}

async function main() {
  console.log(`=== V34.3 115 普渡 匯入↔列印 對帳（唯讀）===\n`);

  // ── A) 46 列 Excel 匯入對照（purification_import_rows） ──
  const batches = await prisma.$queryRawUnsafe<{ id: string; originalFilename: string | null; createdAt: Date }[]>(
    `SELECT "id","originalFilename","createdAt" FROM "purification_import_batches" WHERE "year"=${YEAR} ORDER BY "createdAt" DESC`
  );
  console.log(`115 匯入批次：${batches.length} 個`);
  for (const b of batches) console.log(`  batch ${b.id}｜${b.originalFilename ?? "(無檔名)"}｜${new Date(b.createdAt).toISOString()}`);

  const latest = batches[0];
  if (latest) {
    const rows = await prisma.$queryRawUnsafe<{
      rowNumber: number; normalizedData: unknown; matchingStatus: string; confirmationStatus: string;
      resolutionAction: string | null; existingMatchStatus: string | null; excluded: boolean; confirmedRecordId: string | null;
    }[]>(
      `SELECT "rowNumber","normalizedData","matchingStatus","confirmationStatus","resolutionAction","existingMatchStatus","excluded","confirmedRecordId"
       FROM "purification_import_rows" WHERE "batchId"='${latest.id.replace(/'/g, "''")}' ORDER BY "rowNumber" ASC`
    );
    console.log(`\n── A) 最新批次 ${latest.id} 共 ${rows.length} 列 ──`);
    console.log(`行號 | 類別 | 核心名稱 | 處理結果 | confirmedRecordId`);
    const catCount: Record<string, number> = {};
    let created = 0, updated = 0, skipped = 0, pending = 0;
    for (const r of rows) {
      const nd = (r.normalizedData ?? {}) as Record<string, unknown>;
      const cat = catZh(nd.tabletCategory as string);
      const core = String(nd.tabletName ?? nd.devoteeName ?? nd.primaryContact ?? "").trim() || "（空）";
      let result: string;
      if (r.excluded) result = "排除";
      else if (r.confirmationStatus !== "CONFIRMED") { result = `待處理(${r.matchingStatus})`; pending++; }
      else if (r.resolutionAction === "SKIP" || r.existingMatchStatus === "EXISTS") { result = "略過(已存在)"; skipped++; }
      else if (r.resolutionAction === "UPDATE") { result = "更新"; updated++; }
      else { result = "建立"; created++; }
      catCount[cat] = (catCount[cat] ?? 0) + 1;
      console.log(`#${r.rowNumber} | ${cat} | ${core} | ${result} | ${r.confirmedRecordId ?? "—"}`);
    }
    console.log(`\nA 統計：總列數 ${rows.length}｜建立 ${created}｜更新 ${updated}｜略過 ${skipped}｜待處理 ${pending}`);
    console.log(`各類別列數：` + Object.entries(catCount).map(([k, v]) => `${k} ${v}`).join("、"));
  } else {
    console.log("（找不到 115 匯入批次，A 段略過）");
  }

  // ── B) 列印物件層：沿用正式 print-v34 查詢 ──
  const items = (await listPrintItemsForPrintCenter(YEAR, {})) as unknown as (BatchItem & { sourceEntryId: string })[];
  console.log(`\n── B) 列印物件（listPrintItemsForPrintCenter, year=${YEAR}）：${items.length} 個 ──`);
  console.log(`api.id | entry.id | 類別 | batch | printCount | 缺欄位 | 完整 | 未列印 | 出現在V34(ancestor-soul) | 未出現原因`);

  const ancestorSoul = filterBatchItems(items, "ancestor-soul");
  const creditor = filterBatchItems(items, "creditor");
  const pocket = filterBatchItems(items, "pocket");

  for (const it of items) {
    const b = batchOf(it);
    const complete = isComplete(it);
    const unprinted = isUnprinted(it);
    const inV34 = b === "ancestor-soul" && isPrintableStatus(it.status) && unprinted && complete;
    let reason = "";
    if (!inV34 && b === "ancestor-soul") {
      if (!isPrintableStatus(it.status)) reason = `狀態 ${it.status} 不可列印`;
      else if (!complete) reason = `缺欄位：${it.tabletMissingFields.join("／")}`;
      else if (!unprinted) reason = `已列印 printCount=${it.printCount}`;
    } else if (b !== "ancestor-soul") {
      reason = `屬 ${b ?? "無批次"}，非 ancestor-soul`;
    }
    console.log(
      `${it.id} | ${it.sourceEntryId} | ${catZh(it.sourceCategory)} | ${b ?? "—"} | ${it.printCount} | ${it.tabletMissingFields.join("／") || "—"} | ${complete ? "Y" : "N"} | ${unprinted ? "Y" : "N"} | ${inV34 ? "Y" : "N"} | ${reason}`
    );
  }

  // ── C) 白米／贊普（RitualRegistrationItem，無個別列印物件） ──
  const rri = await prisma.$queryRawUnsafe<{ key: string; n: number }[]>(
    `SELECT rit."key" AS key, COUNT(*)::int AS n
     FROM "ritual_registration_items" rri
     JOIN "registration_item_types" rit ON rit."id"=rri."registrationItemTypeId"
     JOIN "ritual_records" rr ON rr."id"=rri."ritualRecordId"
     WHERE rri."deletedAt" IS NULL AND rr."deletedAt" IS NULL AND rr."year"=${YEAR} AND rr."activityType"::text='UNIVERSAL_SALVATION'
     GROUP BY rit."key" ORDER BY rit."key"`
  );
  console.log(`\n── C) 報名項目類型統計（RitualRegistrationItem）──`);
  for (const r of rri) console.log(`  ${r.key}：${r.n}`);
  const riceN = rri.find((r) => r.key === "US_RICE")?.n ?? 0;
  const sponsorN = (rri.find((r) => r.key === "US_SPONSOR")?.n ?? 0) + (rri.find((r) => r.key === "US_SPONSOR_DONATION")?.n ?? 0);

  // ── D) 最終分類統計 ──
  const byCat = (cat: string) => items.filter((i) => i.itemType === "TABLET" && i.sourceCategory === cat).length;
  const ancestorSoulExpected = ancestorSoul.length; // 可列印狀態的 ancestor-soul 物件
  const ancestorSoulActual = ancestorSoul.filter((i) => isUnprinted(i) && isComplete(i)).length; // = 畫面的 40
  const excluded = ancestorSoul.filter((i) => !(isUnprinted(i) && isComplete(i)));

  console.log(`\n════════ D) 分類統計 ════════`);
  console.log(`Excel 總列數        ：${latest ? "見 A 段" : "N/A"}`);
  console.log(`祖先(TABLET物件)    ：${byCat("ANCESTOR_LINE")}`);
  console.log(`乙位正魂(TABLET物件)：${byCat("INDIVIDUAL_SOUL")}`);
  console.log(`無緣子女(TABLET物件)：${byCat("UNBORN_CHILD")}`);
  console.log(`冤親債主(TABLET物件)：${byCat("DEBT_CREDITOR")}（creditor 批次 ${creditor.length}）`);
  console.log(`寶袋(POCKET物件)    ：${pocket.length}`);
  console.log(`白米(US_RICE)       ：${riceN}（無個別列印物件）`);
  console.log(`贊普(US_SPONSOR*)   ：${sponsorN}（無個別列印物件）`);
  console.log(`ancestor-soul 應有（可列印物件）：${ancestorSoulExpected}`);
  console.log(`ancestor-soul 實際（未列印且完整＝V34畫面）：${ancestorSoulActual}`);
  console.log(`差異：${ancestorSoulExpected - ancestorSoulActual} 筆，明細：`);
  for (const i of excluded) {
    const reason = !isComplete(i) ? `缺 ${i.tabletMissingFields.join("／")}` : !isUnprinted(i) ? `已列印(${i.printCount})` : "其他";
    console.log(`  - entry ${i.sourceEntryId}｜${catZh(i.sourceCategory)}｜${i.sourceDisplayName}｜${reason}`);
  }
  console.log(`\n（唯讀對帳結束，未修改任何資料。）`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
