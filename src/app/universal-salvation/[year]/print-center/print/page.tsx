import Link from "next/link";
import { listPrintItemsForPrintCenter } from "@/lib/additionalPrintItems";
import TabletPrintPage from "@/components/universal-salvation/TabletPrintPage";
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
 * V27.10：跨家戶牌位**專用列印路由**。
 *
 *   /universal-salvation/[year]/print-center/print?batch=ancestor-soul
 *   /universal-salvation/[year]/print-center/print?batch=creditor
 *   （選 &ids=a,b,c 補印指定項目；未給 ids 則＝一鍵列印該批次全部「未列印且完整」）
 *
 * 只 render TabletPrintPage（真正的 A4 牌位版面）。伺服器端**重新查詢並驗證**（§5）：
 *   年度、類型、是否刪除（listPrintItemsForPrintCenter 已濾 deletedAt）、是否可列印、
 *   指定 ids 是否全屬同一批次（跨批次或非本批次一律擋）。不信任前端傳入資料。
 * 寶袋（紅色紙）沿用既有「牌位與寶袋列印」版型，不走本路由。
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

export default async function TabletBatchPrintRoute({
  params,
  searchParams,
}: {
  params: Promise<{ year: string }>;
  searchParams: Promise<{ batch?: string; ids?: string; scope?: string; debug?: string }>;
}) {
  const { year: yearParam } = await params;
  const { batch: batchParam, ids: idsParam, debug: debugParam } = await searchParams;

  const year = Number(yearParam);
  if (!Number.isInteger(year)) return <Notice year={0} title="年度格式錯誤" />;

  const batch = batchParam as PrintBatchKey | undefined;
  if (!batch || !(batch in PRINT_BATCH_META)) {
    return <Notice year={year} title="列印批次參數不正確" detail="batch 需為 ancestor-soul 或 creditor。" />;
  }
  const meta = PRINT_BATCH_META[batch];

  // 寶袋（紅色紙）使用既有寶袋版型，不走本牌位專用列印頁。
  if (!meta.usesTabletEngine) {
    return (
      <Notice
        year={year}
        title="寶袋請於「牌位與寶袋列印」區塊列印（紅色紙）"
        detail="寶袋使用既有寶袋專用版型，與黃色牌位分開列印，不在本牌位版面頁。"
      />
    );
  }

  // 伺服器端重新查詢（唯讀；已濾 deletedAt / 非本年度）。
  const all = (await listPrintItemsForPrintCenter(year, {})) as unknown as BatchItem[];
  const inBatch = filterBatchItems(all, batch);

  let chosen: BatchItem[];
  const ids = (idsParam ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length > 0) {
    // 補印：驗證每個 id 都屬於本批次（跨批次/非本批次一律擋），且資料完整。
    const byId = new Map(inBatch.map((i) => [i.id, i]));
    const invalid = ids.filter((id) => !byId.has(id));
    if (invalid.length > 0) {
      return <Notice year={year} title="含非本批次或無效的項目，已阻擋列印" detail="不同列印批次需分開列印，請回管理頁重新選取同一批次。" />;
    }
    chosen = ids.map((id) => byId.get(id)!).filter((i) => isComplete(i));
    const incompleteN = ids.length - chosen.length;
    if (incompleteN > 0) {
      return <Notice year={year} title={`有 ${incompleteN} 筆資料不完整，已阻擋列印`} detail="請回管理頁補齊缺漏欄位後再列印。" />;
    }
  } else {
    // 一鍵：本批次全部「未列印且完整」。
    chosen = inBatch.filter((i) => isUnprinted(i) && isComplete(i));
  }

  const groups = buildTabletGroups(chosen);

  return (
    <TabletPrintPage
      year={year}
      batchLabel={meta.label}
      paperLabel={meta.paperLabel}
      count={chosen.length}
      groups={groups}
      debug={debugParam === "1"}
    />
  );
}
