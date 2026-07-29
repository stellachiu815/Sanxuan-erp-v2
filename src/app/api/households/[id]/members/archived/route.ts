import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * V28：家戶「已封存成員」清單（成員封存區），可查詢與恢復。
 *
 * GET /api/households/F00009/members/archived
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: householdId } = await params;

  const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

  const members = await prisma.member.findMany({
    where: { householdId, deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    select: { id: true, name: true, role: true, deletedAt: true, deletedByName: true },
  });
  return NextResponse.json({ success: true, data: { members } });
}
