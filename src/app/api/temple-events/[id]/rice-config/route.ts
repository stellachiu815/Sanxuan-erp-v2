import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { getRiceQuotaSummary, updateRiceConfig, type UpdateRiceConfigInput } from "@/lib/whiteRiceService";

/**
 * V14.4 白米年度配額：年度設定與即時配額彙總（指令四）。
 *
 * GET   /api/temple-events/[id]/rice-config
 *   → 回傳 riceTotalKg／riceUnitPrice／riceOpen／riceNote，以及即時彙總：
 *     已認購斤數／剩餘斤數／認購總金額／已收／未收（由有效正式報名重算）。
 * PATCH /api/temple-events/[id]/rice-config
 *   body: { totalKg?, unitPrice?, open?, note? }
 *
 * 沿用普渡年度活動（TempleEvent），不建平行活動資料；操作人一律取自 session。
 * READONLY 只能 GET（view），PATCH 需 update 權限。白米無貼紙、無列印品。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await assertUniversalSalvationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { id } = await params;
  const summary = await getRiceQuotaSummary(id);
  if (!summary) return NextResponse.json({ error: "找不到這個活動年度" }, { status: 404 });
  return NextResponse.json({ ok: true, ...summary });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await assertUniversalSalvationPermissionForOperator(await readOperatorUserId(request), "update");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await readJsonBody(request);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });

  const input: UpdateRiceConfigInput = {};
  if ("totalKg" in body) input.totalKg = body.totalKg === null ? null : Number(body.totalKg);
  if ("unitPrice" in body) input.unitPrice = body.unitPrice === null ? null : Number(body.unitPrice);
  if ("open" in body) input.open = Boolean(body.open);
  if ("note" in body) input.note = typeof body.note === "string" ? body.note : null;

  const { id } = await params;
  const result = await updateRiceConfig(id, input, check.operator.name);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({
    ok: true,
    ...result.data,
    message: "已更新白米年度配額。修改單價不影響既有報名（既有報名金額為建立當下鎖定價）。",
  });
}
