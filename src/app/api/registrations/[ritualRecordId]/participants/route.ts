import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import {
  listParticipants,
  removeParticipant,
  upsertParticipantsInTransaction,
} from "@/lib/ritualParticipants";

/**
 * V13.4：報名成員管理（新增／移除／恢復）。
 *
 * GET    ?operatorUserId=xxx&includeRemoved=1   列出成員
 * POST   { operatorUserId, memberIds }          加入或恢復成員
 * DELETE { operatorUserId, memberId }           移除成員（軟刪除，可恢復）
 *
 * ⚠️ 一律透過 ritualParticipants service 寫入，不在這裡直接操作 Prisma。
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ritualRecordId: string }> }
) {
  const url = new URL(request.url);
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request),
    "view"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { ritualRecordId } = await params;
  const includeRemoved = url.searchParams.get("includeRemoved") === "1";
  const participants = await listParticipants(ritualRecordId, includeRemoved);

  return NextResponse.json({ ok: true, participants });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ritualRecordId: string }> }
) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertRitualRegistrationPermissionForOperator(
    operatorUserId,
    "manageParticipant"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });

  const memberIds = Array.isArray(body.memberIds)
    ? body.memberIds.filter((x): x is string => typeof x === "string")
    : [];
  if (memberIds.length === 0) {
    return NextResponse.json({ error: "請選擇要加入的成員" }, { status: 400 });
  }

  const { ritualRecordId } = await params;

  const record = await prisma.ritualRecord.findUnique({ where: { id: ritualRecordId } });
  if (!record || record.deletedAt) {
    return NextResponse.json({ error: "找不到這筆活動報名" }, { status: 404 });
  }

  // 成員必須屬於同一家戶
  const members = await prisma.member.findMany({
    where: { id: { in: memberIds }, deletedAt: null },
    select: { id: true, householdId: true, name: true },
  });
  const foreign = members.filter((m) => m.householdId !== record.householdId);
  if (foreign.length > 0) {
    return NextResponse.json(
      { error: `「${foreign.map((m) => m.name).join("、")}」不屬於這個家戶` },
      { status: 400 }
    );
  }

  const outcomes = await prisma.$transaction((tx) =>
    upsertParticipantsInTransaction(tx, ritualRecordId, memberIds, check.operator.name)
  );

  return NextResponse.json({ ok: true, outcomes });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ritualRecordId: string }> }
) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertRitualRegistrationPermissionForOperator(
    operatorUserId,
    "manageParticipant"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await readJsonBody(request);
  const memberId = body && typeof body.memberId === "string" ? body.memberId : "";
  if (!memberId) return NextResponse.json({ error: "請指定要移除的成員" }, { status: 400 });

  const { ritualRecordId } = await params;
  const result = await removeParticipant(ritualRecordId, memberId, check.operator.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, message: "已移除這位成員，之後可再次加入恢復。" });
}
