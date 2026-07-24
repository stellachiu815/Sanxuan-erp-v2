import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { isRowConfirmable, type MatchStatus } from "@/lib/purificationImportRules";

/**
 * V14.4 Part 6B：PATCH /api/universal-salvation/[year]/import/[batchId]/rows/[rowId]
 * 逐列 resolution/編輯：指定信眾/家戶、確認建新、修改普渡欄位、excluded/resolved。
 * PATCH 後重新計算 confirmable。需 create 權限（READONLY → 403）；operator 取自 session。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ batchId: string; rowId: string }> }) {
  const check = await assertUniversalSalvationPermissionForOperator(await readOperatorUserId(request), "create");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { batchId, rowId } = await params;
  const row = await prisma.purificationImportRow.findFirst({ where: { id: rowId, batchId } });
  if (!row) return NextResponse.json({ error: "找不到這一列草稿" }, { status: 404 });
  if (row.confirmationStatus === "CONFIRMED") return NextResponse.json({ error: "此列已正式建立，不能再編輯" }, { status: 409 });

  const body = await readJsonBody(request);
  const data: Prisma.PurificationImportRowUpdateInput = {};

  if (typeof body?.matchedDevoteeId === "string" || body?.matchedDevoteeId === null) data.matchedDevoteeId = body.matchedDevoteeId;
  if (typeof body?.matchedHouseholdId === "string" || body?.matchedHouseholdId === null) data.matchedHouseholdId = body.matchedHouseholdId;
  if (typeof body?.createNewDevoteeConfirmed === "boolean") data.createNewDevoteeConfirmed = body.createNewDevoteeConfirmed;
  if (typeof body?.createNewHouseholdConfirmed === "boolean") data.createNewHouseholdConfirmed = body.createNewHouseholdConfirmed;
  if (typeof body?.excluded === "boolean") data.excluded = body.excluded;
  if (body?.editedData && typeof body.editedData === "object") data.editedData = body.editedData as Prisma.InputJsonValue;

  // 若指定了正確信眾，狀態視為已解決（但「只有姓名相同」不會因此自動 MATCHED——
  // 這裡是「人工指定」而非自動比對，符合指令：不得因編輯其他欄位為空就自動 MATCHED）。
  const matchedDevoteeId = (data.matchedDevoteeId as string | null | undefined) ?? row.matchedDevoteeId;
  const createNew = (data.createNewDevoteeConfirmed as boolean | undefined) ?? row.createNewDevoteeConfirmed;
  const confirmable = isRowConfirmable(row.matchingStatus as MatchStatus, matchedDevoteeId ?? null, createNew);
  data.resolved = confirmable;

  const updated = await prisma.purificationImportRow.update({ where: { id: rowId }, data });
  return NextResponse.json({ ok: true, row: updated, confirmable });
}
