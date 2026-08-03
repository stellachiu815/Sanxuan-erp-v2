import Link from "next/link";
import { listPrintItemsForPrintCenter } from "@/lib/additionalPrintItems";
import TabletLandscapeSheetV34, { type V34Density } from "@/components/universal-salvation/v34/TabletLandscapeSheetV34";
import V34PrintButton from "@/components/universal-salvation/v34/V34PrintButton";
import {
  PRINT_BATCH_META,
  filterBatchItems,
  isUnprinted,
  isComplete,
  buildTabletGroups,
  type PrintBatchKey,
  type BatchItem,
} from "@/lib/TabletBatchService";

/**
 * V34（平行開發）中元普渡橫式列印**獨立路由**——與現行 /print 版型並存、不取代。
 *
 *   /universal-salvation/[year]/print-center/print-v34?batch=ancestor-soul&density=standard
 *   /universal-salvation/[year]/print-center/print-v34?batch=creditor&ids=a,b,c&density=economy
 *
 * ⚠️ 只讀既有資料查詢（listPrintItemsForPrintCenter 等，read-only），**不**修改任何資料流程/名稱正規化/
 *    收款/Excel/DB。名稱由既有 formatter（toRecord→formatTabletMainText）解析後帶入，本頁只負責排版。
 *    Preview 與正式列印使用同一份 DOM/CSS（window.print），一致。
 */
export const dynamic = "force-dynamic";

function Notice({ year, title, detail }: { year: number; title: string; detail?: string }) {
  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 18 }}>{title}</h1>
      {detail && <p style={{ color: "#7a7367", marginTop: 8 }}>{detail}</p>}
      <Link href={`/universal-salvation/${year}/print-center`} style={{ display: "inline-block", marginTop: 16, color: "#2c2a27" }}>
        ← 返回列印管理
      </Link>
    </div>
  );
}

export default async function TabletLandscapePrintV34Route({
  params,
  searchParams,
}: {
  params: Promise<{ year: string }>;
  searchParams: Promise<{ batch?: string; ids?: string; density?: string; workno?: string }>;
}) {
  const { year: yearParam } = await params;
  const { batch: batchParam, ids: idsParam, density: densityParam, workno: worknoParam } = await searchParams;
  const year = Number(yearParam);
  if (!Number.isInteger(year)) return <Notice year={0} title="年度格式錯誤" />;

  const showWorkNumber = worknoParam !== "0";
  const density: V34Density = densityParam === "economy" ? "economy" : "standard";

  const batch = batchParam as PrintBatchKey | undefined;
  if (!batch || !(batch in PRINT_BATCH_META)) {
    return <Notice year={year} title="列印批次參數不正確" detail="batch 需為 ancestor-soul、creditor 或 pocket。" />;
  }
  const meta = PRINT_BATCH_META[batch];

  // 讀既有資料（唯讀；已濾 deletedAt / 非本年度）——不修改任何資料流程。
  const all = (await listPrintItemsForPrintCenter(year, {})) as unknown as BatchItem[];
  const inBatch = filterBatchItems(all, batch);

  let chosen: BatchItem[];
  const ids = (idsParam ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length > 0) {
    const byId = new Map(inBatch.map((i) => [i.id, i]));
    const invalid = ids.filter((id) => !byId.has(id));
    if (invalid.length > 0) return <Notice year={year} title="含非本批次或無效的項目，已阻擋列印" />;
    chosen = ids.map((id) => byId.get(id)!).filter((i) => isComplete(i));
  } else {
    chosen = inBatch.filter((i) => isUnprinted(i) && isComplete(i));
  }

  const groups = buildTabletGroups(chosen).map((g) => ({
    documentType: g.documentType,
    categoryLabel: g.categoryLabel,
    records: g.records,
  }));

  return (
    <div className="v34-print-page">
      <div className="no-print" style={{ position: "sticky", top: 0, zIndex: 10, display: "flex", gap: 12, alignItems: "center", padding: "10px 16px", background: "#faf6ee", borderBottom: "1px solid #e6ddc9" }}>
        <strong>{meta.label}（V34 橫式）</strong>
        <span style={{ fontSize: 13, color: "#7a7367" }}>{meta.paperLabel}｜{chosen.length} 筆｜密度：{density === "economy" ? "省紙" : "標準"}</span>
        <Link
          href={`?batch=${batch}${ids.length ? `&ids=${ids.join(",")}` : ""}&density=${density === "economy" ? "standard" : "economy"}${showWorkNumber ? "" : "&workno=0"}`}
          style={{ marginLeft: "auto", borderRadius: 999, border: "1px solid #cfc8bb", background: "#fff", padding: "6px 16px", fontSize: 14, textDecoration: "none", color: "#2c2a27" }}
        >
          切換密度（標準／省紙）
        </Link>
        <V34PrintButton />
        <Link href={`/universal-salvation/${year}/print-center`} style={{ borderRadius: 999, border: "1px solid #cfc8bb", background: "#fff", padding: "6px 16px", fontSize: 14, textDecoration: "none", color: "#2c2a27" }}>
          返回列印管理
        </Link>
      </div>

      <TabletLandscapeSheetV34
        groups={groups}
        density={density}
        showWorkNumber={showWorkNumber}
        title="中元普渡"
        subtitle={`民國 ${year} 年度`}
      />
    </div>
  );
}
