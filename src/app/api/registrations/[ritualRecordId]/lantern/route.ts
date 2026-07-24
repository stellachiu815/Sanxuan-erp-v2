import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import {
  upsertLanternRegistrationInTransaction,
  buildLanternPrintBatch,
} from "@/lib/lanternRegistration";
import { isLanternActivityType } from "@/lib/registrationFormTypes";

/**
 * V13.4：年度燈報名內容（金額）與列印資料。
 *
 * GET   ?operatorUserId=xxx     列印批次（讀 participant 快照，不碰 Member）
 * PATCH { operatorUserId, unitPrice }  設定／調整本年度金額
 *
 * ⚠️ 列印資料一律讀 RitualParticipant 的快照——每位成員各自一份。
 * 全家燈列印全戶名單時，每個人的農曆生日與虛歲都不同，
 * 絕不用代表人的資料代替。
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ritualRecordId: string }> }
) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request),
    "view"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { ritualRecordId } = await params;
  const batch = await buildLanternPrintBatch(ritualRecordId);
  if (!batch) return NextResponse.json({ error: "找不到這筆年度燈報名" }, { status: 404 });

  return NextResponse.json({ ok: true, batch });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ritualRecordId: string }> }
) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertRitualRegistrationPermissionForOperator(
    operatorUserId,
    "createLantern"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });

  const { ritualRecordId } = await params;

  const record = await prisma.ritualRecord.findUnique({
    where: { id: ritualRecordId },
    include: { participants: { where: { deletedAt: null } } },
  });
  if (!record || record.deletedAt) {
    return NextResponse.json({ error: "找不到這筆活動報名" }, { status: 404 });
  }
  if (!isLanternActivityType(record.activityType)) {
    return NextResponse.json({ error: "這筆報名不是年度燈活動" }, { status: 400 });
  }

  // 前端送來的金額由伺服器重算，不直接採用
  const unitPrice =
    typeof body.unitPrice === "number"
      ? body.unitPrice
      : typeof body.unitPrice === "string" && body.unitPrice.trim() !== ""
        ? Number(body.unitPrice)
        : null;
  if (unitPrice !== null && !Number.isFinite(unitPrice)) {
    return NextResponse.json({ error: "單價必須是數字" }, { status: 400 });
  }

  const result = await prisma.$transaction((tx) =>
    upsertLanternRegistrationInTransaction(tx, {
      ritualRecordId,
      activityType: record.activityType,
      participantCount: record.participants.length,
      unitPrice,
      notes: typeof body.notes === "string" ? body.notes : null,
      operatorName: check.operator.name,
    })
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json({ ok: true, amountDue: result.amountDue });
}
