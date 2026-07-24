import { NextRequest, NextResponse } from "next/server";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { getPurificationImportBatch } from "@/lib/purificationImport";

/**
 * V14.4 Part 6B：GET /api/universal-salvation/[year]/import/[batchId]
 * 讀取草稿 batch 與逐列（含 confirmationStatus / confirmedRecordId，兼作 result）。view 權限。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const check = await assertUniversalSalvationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { batchId } = await params;
  const batch = await getPurificationImportBatch(batchId);
  if (!batch) return NextResponse.json({ error: "找不到匯入批次" }, { status: 404 });
  return NextResponse.json({ ok: true, batch });
}
