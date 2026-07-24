import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { generatePurificationPrintBatch, listPrintBatches, type PrintBatchFilter } from "@/lib/purification";
import { assertPurificationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * 列印批次：清單／產生新批次。
 *
 * GET /api/purification/years/xxx/print-batches
 *   → 這個年度所有列印批次的歷史紀錄（新到舊）。
 *
 * POST /api/purification/years/xxx/print-batches
 *   body: {
 *     "filter": { "kind": "ALL" }
 *            或 { "kind": "UNPRINTED" }
 *            或 { "kind": "NUMBER_RANGE", "from": 1, "to": 99 }
 *            或 { "kind": "NAME", "query": "王小明" }
 *            或 { "kind": "IDS", "ids": ["xxx", "yyy"] },   // 補印單筆／整張都是用這個
 *     "note": "備註",
 *     "operatorName": "操作人姓名"
 *   }
 *
 * 對應需求「十二」：全部列印/指定編號範圍/指定姓名/尚未列印/補印單筆
 * （IDS 只放一個 id）/補印整張 A4（IDS 放整張 33 筆的 id）都是同一支 API，
 * 只是 filter 不一樣。「重新產生 PDF」則是前端拿同一批 pages 資料重新
 * 呼叫產生 PDF，不需要另外呼叫這支（不會重複標記已列印、不會佔用新批次
 * 編號），見前端列印中心的實作。
 *
 * 只要有任何一筆資料沒通過列印前檢查（性別/生日/地址/編號等問題），
 * 整批都會被擋下（回傳 400），不會「先印可以印的、其他跳過」——這是刻意
 * 設計，因為列印前必須先在畫面上看到完整的問題清單、逐一處理過，才可以
 * 列印，不能讓使用者在不知情的狀況下漏印。
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ yearId: string }> }
) {
  const { yearId } = await params;
  const batches = await listPrintBatches(yearId);
  return NextResponse.json({ batches });
}

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
        return NextResponse.json({ error: "請提供要列印的 id 清單" }, { status: 400 });
      }
      filter = { kind: "IDS", ids };
      break;
    }
    default:
      return NextResponse.json({ error: "篩選條件的 kind 不正確" }, { status: 400 });
  }

  const __op = await assertPurificationPermissionForOperator(await readOperatorUserId(request), "print");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });
  const operatorName = __op.operator.name;
  const note = typeof body.note === "string" ? body.note : null;

  const result = await generatePurificationPrintBatch(yearId, filter, operatorName, note);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/purification/${yearId}`);
  revalidatePath(`/purification/${yearId}/print`);

  return NextResponse.json(
    { batchId: result.data.batchId, pages: result.data.pages, totalCount: result.data.totalCount },
    { status: 201 }
  );
}
