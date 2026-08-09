import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import {
  previewRecordEntryAddressRealign,
  applyRecordEntryAddressRealign,
} from "@/lib/backfillEntryAddress";

/**
 * 重新對齊牌位地址（依祭祀資料）。
 *
 * GET  /api/registrations/[ritualRecordId]/address-realign
 *   → 純預覽：列出這筆報名中，牌位地址與祭祀資料不一致的差異（不寫入）。
 * POST /api/registrations/[ritualRecordId]/address-realign
 *   body: { entryIds: string[] }
 *   → 只更新使用者勾選的牌位地址（保護手動填對的地址、不整批硬套）。
 *
 * 規則（Stella 定案）：牌位地址一律以「祭祀資料（永久牌位安奉地）」為準。
 * 權限：預覽＝view；套用＝register（與「重新產生列印資料」同層級）。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ ritualRecordId: string }> }) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { ritualRecordId } = await params;
  const result = await previewRecordEntryAddressRealign(ritualRecordId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, changes: result.changes, noWorshipMatch: result.noWorshipMatch });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ ritualRecordId: string }> }) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "register");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await readJsonBody(request);
  const entryIds = Array.isArray((body as { entryIds?: unknown })?.entryIds)
    ? ((body as { entryIds: unknown[] }).entryIds.filter((x): x is string => typeof x === "string"))
    : [];

  const { ritualRecordId } = await params;
  const result = await applyRecordEntryAddressRealign(ritualRecordId, entryIds);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({
    ok: true,
    updated: result.updated,
    message: `已依祭祀資料重新對齊 ${result.updated} 個牌位的地址。`,
  });
}
