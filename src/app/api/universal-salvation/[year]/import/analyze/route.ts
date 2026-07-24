import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { prisma } from "@/lib/prisma";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { analyzePurificationImport } from "@/lib/purificationImport";

/**
 * V14.4 Part 6B：POST /api/universal-salvation/[year]/import/analyze
 * multipart/form-data（file=Excel）。解析＋保守匹配＋建立草稿 batch，**不建正式資料**。
 * 需 create 權限；READONLY → 403；operator 取自 session。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ year: string }> }) {
  const check = await assertUniversalSalvationPermissionForOperator(await readOperatorUserId(request), "create");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { year: yearParam } = await params;
  const year = Number(yearParam);
  if (!Number.isInteger(year)) return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "請選擇要匯入的 Excel 檔案" }, { status: 400 });
  const buffer = Buffer.from(await (file as File).arrayBuffer());

  const event = await prisma.templeEvent.findFirst({ where: { activityType: "UNIVERSAL_SALVATION", year }, select: { id: true } });

  const result = await analyzePurificationImport({
    buffer,
    year,
    templeEventId: event?.id ?? null,
    originalFilename: typeof (file as File).name === "string" ? (file as File).name : null,
    createdByUserId: check.operator.id,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true, batchId: result.batchId, detectedColumns: result.detectedColumns, ...result.summary }, { status: 201 });
}
