import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ActivityType } from "@prisma/client";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { carryOverHouseholdRegistration } from "@/lib/registrationItemRegistration";
import { carryOverUniversalSalvationEntries } from "@/lib/ritual";

/**
 * V15R5「沿用去年」：把某家戶上一年度某活動類型的報名內容 carry-over 到新年度。
 *
 * POST /api/registrations/carry-over
 * body: { operatorUserId, householdId, activityType, toYear }
 *
 * 沿用既有 registerItemsBatch＋普渡 createUniversalSalvationEntry（不建第二套）；
 * 依新年度單價重算、DRAFT、不帶付款/收據/交易/列印狀態/CONFIRMED。權限：register。
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertRitualRegistrationPermissionForOperator(operatorUserId, "register");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await readJsonBody(request);
  const householdId = typeof body?.householdId === "string" ? body.householdId : "";
  const activityType = typeof body?.activityType === "string" ? (body.activityType as ActivityType) : null;
  const toYear = Number(body?.toYear);
  if (!householdId || !activityType || !Number.isInteger(toYear)) {
    return NextResponse.json({ error: "缺少 householdId／activityType／toYear" }, { status: 400 });
  }

  const itemResult = await carryOverHouseholdRegistration(householdId, activityType, toYear, check.operator.name);
  if (!itemResult.ok) return NextResponse.json({ error: itemResult.error }, { status: itemResult.status });

  // 普渡：另 carry-over 牌位（含每筆自己的 tabletAddress）。
  let entriesCopied = 0;
  let fromYear = itemResult.fromYear;
  if (activityType === "UNIVERSAL_SALVATION") {
    const us = await carryOverUniversalSalvationEntries(householdId, toYear, check.operator.name);
    entriesCopied = us.copied;
    fromYear = fromYear ?? us.fromYear;
  }

  return NextResponse.json({
    ok: true,
    fromYear,
    itemsCreated: itemResult.itemsCreated,
    entriesCopied,
    message:
      fromYear != null
        ? `已沿用民國 ${fromYear} 年報名內容（依本年度單價重算，DRAFT，不含付款/收據/列印）。`
        : "查無去年可沿用的報名內容。",
  });
}
