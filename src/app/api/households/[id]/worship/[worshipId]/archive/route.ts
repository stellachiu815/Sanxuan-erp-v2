import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { archiveWorshipRecord } from "@/lib/worshipRecordManagement";

/**
 * V28：封存（軟刪除）一筆祭祀永久資料。
 *
 * POST /api/households/F00009/worship/<worshipId>/archive
 *
 * 只影響未來帶入；不回溯既有年度普渡報名／列印快照／收款／收據／帳務。
 * 封存後仍可於封存區查詢並恢復（沿用既有 deletedAt/deletedByName＋recordVersion）。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; worshipId: string }> }
) {
  const { id: householdId, worshipId } = await params;

  const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "updateProfile");
  if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

  const belongs = await prisma.worshipRecord.findFirst({ where: { id: worshipId, householdId }, select: { id: true } });
  if (!belongs) return NextResponse.json({ success: false, error: "找不到這筆祭祀資料" }, { status: 404 });

  const result = await archiveWorshipRecord(worshipId, check.operator.name);
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });

  revalidatePath(`/household/${householdId}`);
  return NextResponse.json({ success: true, data: result.data });
}
