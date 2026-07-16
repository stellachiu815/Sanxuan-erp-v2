import { NextRequest, NextResponse } from "next/server";
import { previewPurificationPrintBatch, type PrintBatchFilter } from "@/lib/purification";

/**
 * 列印前完整 A4 預覽（需求「十三」）——純查詢，不會標記已列印、不會建立
 * 列印批次、不會鎖定年度。畫面的列印中心按下【最佳化版面】或切換篩選條件
 * 時都是呼叫這支，只有使用者確認沒有問題、按下真正的「產生列印批次／
 * 下載 PDF」時，才會呼叫 POST .../print-batches（見同目錄下 print-batches
 * 的說明）。
 *
 * POST /api/purification/years/xxx/print-preview
 * body: { "filter": { "kind": "ALL" | "UNPRINTED" | "NUMBER_RANGE" | "NAME" | "IDS", ... } }
 *
 * （用 POST 而不是 GET，是因為 NUMBER_RANGE/NAME/IDS 篩選條件用查詢字串
 * 表達會很雜亂，跟 print-batches 保持同樣的 body 格式，畫面可以共用同一段
 * 組 filter 的程式碼。）
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ yearId: string }> }
) {
  const { yearId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !body.filter || typeof body.filter !== "object") {
    return NextResponse.json({ error: "請提供正確的篩選條件（filter）" }, { status: 400 });
  }

  const rawFilter = body.filter as Record<string, unknown>;
  let filter: PrintBatchFilter;
  switch (rawFilter.kind) {
    case "ALL":
      filter = { kind: "ALL" };
      break;
    case "UNPRINTED":
      filter = { kind: "UNPRINTED" };
      break;
    case "NUMBER_RANGE": {
      const from = Number(rawFilter.from);
      const to = Number(rawFilter.to);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) {
        return NextResponse.json({ error: "編號範圍格式錯誤" }, { status: 400 });
      }
      filter = { kind: "NUMBER_RANGE", from, to };
      break;
    }
    case "NAME": {
      const query = typeof rawFilter.query === "string" ? rawFilter.query.trim() : "";
      if (!query) {
        return NextResponse.json({ error: "請輸入姓名" }, { status: 400 });
      }
      filter = { kind: "NAME", query };
      break;
    }
    case "IDS": {
      const ids = Array.isArray(rawFilter.ids) ? rawFilter.ids.filter((x): x is string => typeof x === "string") : [];
      if (ids.length === 0) {
        return NextResponse.json({ error: "請提供要預覽的 id 清單" }, { status: 400 });
      }
      filter = { kind: "IDS", ids };
      break;
    }
    default:
      return NextResponse.json({ error: "篩選條件的 kind 不正確" }, { status: 400 });
  }

  const result = await previewPurificationPrintBatch(yearId, filter);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    pages: result.data.pages,
    totalCount: result.data.totalCount,
    blockingCount: result.data.blockingCount,
  });
}
