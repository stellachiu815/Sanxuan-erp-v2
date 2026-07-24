import { NextRequest, NextResponse } from "next/server";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { confirmPurificationImportBatch } from "@/lib/purificationImport";
import type { Role } from "@/lib/whiteRice";

/**
 * V14.4 Part 6B：POST /api/universal-salvation/[year]/import/[batchId]/confirm
 * body: { confirmationKey }。逐列共用正式核心物化；batch 原子鎖定＋confirmationKey 防重。
 * 需 create 權限（READONLY → 403）；operator/核准人一律 session。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const check = await assertUniversalSalvationPermissionForOperator(await readOperatorUserId(request), "create");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { batchId } = await params;
  const body = await readJsonBody(request);
  const confirmationKey = typeof body?.confirmationKey === "string" ? body.confirmationKey.trim() : "";
  if (!confirmationKey) return NextResponse.json({ error: "缺少確認識別碼（confirmationKey）" }, { status: 400 });

  const result = await confirmPurificationImportBatch({
    batchId,
    confirmationKey,
    actor: { role: check.operator.role as Role, userId: check.operator.id, name: check.operator.name },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true, results: result.results, deduplicated: result.deduplicated }, { status: result.deduplicated ? 200 : 201 });
}
