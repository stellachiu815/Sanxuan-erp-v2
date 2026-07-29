import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { WorshipType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { updateWorshipRecord } from "@/lib/worshipRecordManagement";

/**
 * V28：編輯一筆有效（未封存）的祭祀永久資料（歷代祖先／乙位正魂）。
 *
 * PATCH /api/households/F00009/worship/<worshipId>
 * body: { displayName?, location?, yangshangName?, notes?, type? }
 *
 * 沿用既有 updateProfile 權限與 recordVersion 稽核。編輯只影響「未來帶入」，
 * 不回溯既有年度普渡報名／列印快照／收款／收據／帳務。
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; worshipId: string }> }
) {
  const { id: householdId, worshipId } = await params;

  const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "updateProfile");
  if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

  // 確認這筆祭祀資料確實屬於本家戶（避免跨戶竄改）。
  const belongs = await prisma.worshipRecord.findFirst({ where: { id: worshipId, householdId }, select: { id: true } });
  if (!belongs) return NextResponse.json({ success: false, error: "找不到這筆祭祀資料" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ success: false, error: "請求格式錯誤" }, { status: 400 });
  }

  const input: {
    displayName?: string;
    location?: string | null;
    yangshangName?: string | null;
    notes?: string | null;
    type?: WorshipType;
  } = {};
  if (typeof body.displayName === "string") input.displayName = body.displayName;
  if ("location" in body) input.location = typeof body.location === "string" ? body.location : null;
  if ("yangshangName" in body) input.yangshangName = typeof body.yangshangName === "string" ? body.yangshangName : null;
  if ("notes" in body) input.notes = typeof body.notes === "string" ? body.notes : null;
  if (typeof body.type === "string" && (body.type === "ANCESTOR_LINE" || body.type === "INDIVIDUAL")) {
    input.type = body.type as WorshipType;
  }

  const result = await updateWorshipRecord(worshipId, input, check.operator.name);
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });

  revalidatePath(`/household/${householdId}`);
  return NextResponse.json({ success: true, data: result.data });
}
