import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { printRegistrationItems, resolvePrintableItemIds, type PrintCenterFilters } from "@/lib/printDocuments";

/**
 * V15R8：列印／補印（單筆／勾選批次／目前篩選全部）。
 *
 * POST /api/print-center/items/print
 *   body: { ids: string[] }                              → 單筆／勾選批次
 *   body: { all: true, filter: {year,itemKey,source,printStatus,q} } → 目前篩選結果全部（只套用該篩選）
 *
 * 語意：printCount++；首次設 printedAt（首次後不覆蓋）；每次更新 lastPrintedAt 與操作人。
 * 不新增第二筆報名、不改金額／收款／報名狀態。權限沿用既有列印（manageParticipant），READONLY → 403。
 */
export async function POST(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "manageParticipant");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await readJsonBody(request);
  let ids: string[] = [];
  if (body && body.all === true && body.filter && typeof body.filter === "object") {
    const f = body.filter as Record<string, unknown>;
    const year = Number(f.year);
    if (!Number.isInteger(year)) return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });
    const printStatus = f.printStatus === "UNPRINTED" || f.printStatus === "PRINTED" ? f.printStatus : "ALL";
    const filter: PrintCenterFilters = {
      year,
      itemKey: typeof f.itemKey === "string" && f.itemKey ? f.itemKey : null,
      source: typeof f.source === "string" && f.source ? f.source : null,
      printStatus,
      q: typeof f.q === "string" && f.q ? f.q : null,
    };
    ids = await resolvePrintableItemIds(filter);
  } else if (body && Array.isArray(body.ids)) {
    ids = body.ids.filter((x: unknown): x is string => typeof x === "string");
  } else {
    return NextResponse.json({ error: "請提供 ids（單筆／批次）或 all＋filter（全部列印）" }, { status: 400 });
  }

  const result = await printRegistrationItems(ids, { id: check.operator.id, name: check.operator.name });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, printed: result.printed });
}
