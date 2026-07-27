import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { buildItemRoster } from "@/lib/printDocuments";

/**
 * V16 白米管理：某年度白米認購名單（供活動設定頁的「白米管理」清單＋搜尋／篩選／排序）。
 *
 * GET /api/temple-events/[id]/rice-registrations
 *   → { ok, year, rows:[{ registrationItemId, householdName, memberName, quantity, amountDue, amountPaid, amountUnpaid, status }] }
 *
 * 沿用 buildItemRoster（同一份 RitualRegistrationItem 名單來源，不建第二套查詢／名單）；
 * includeDraft=true 讓管理頁同時看到草稿與已確認（列印仍只列 CONFIRMED）。READONLY 可檢視。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await assertUniversalSalvationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { id } = await params;
  const event = await prisma.templeEvent.findUnique({ where: { id }, select: { year: true } });
  if (!event) return NextResponse.json({ error: "找不到這個活動年度" }, { status: 404 });

  const roster = await buildItemRoster("US_RICE", event.year, true);
  if (!roster) return NextResponse.json({ error: "白米報名項目設定不存在" }, { status: 404 });

  return NextResponse.json({ ok: true, year: event.year, rows: roster.rows });
}
