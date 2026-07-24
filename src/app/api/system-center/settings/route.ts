import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * GET /api/system-center/settings?operatorUserId=xxx
 * 需求「系統設定」子頁面：目前的備份保留政策。
 */
export async function GET(request: NextRequest) {
  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request),
    "viewSystemCenter"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const settings = await prisma.systemSetting.upsert({
    where: { id: "SINGLETON" },
    create: { id: "SINGLETON" },
    update: {},
  });
  return NextResponse.json({
    dailyRetentionDays: settings.dailyRetentionDays,
    weeklyRetentionWeeks: settings.weeklyRetentionWeeks,
    updatedAt: settings.updatedAt.toISOString(),
    updatedByName: settings.updatedByName,
  });
}

/**
 * PUT /api/system-center/settings
 *   body: { operatorUserId, dailyRetentionDays, weeklyRetentionWeeks }
 * 需求「十四」：只有最高管理員可以「修改排程」（這裡先開放調整保留天數/
 * 週數；每日/週/月的執行時間目前是程式碼常數＋外部排程觸發，尚未做成
 * 可調整設定，見交付報告「尚未完成項目」）。
 */
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "請提供設定資料" }, { status: 400 });

  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request), "manageBackupSchedule");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const dailyRetentionDays = Number(body.dailyRetentionDays);
  const weeklyRetentionWeeks = Number(body.weeklyRetentionWeeks);
  if (!Number.isInteger(dailyRetentionDays) || dailyRetentionDays < 1) {
    return NextResponse.json({ error: "每日備份保留天數必須是大於等於 1 的整數" }, { status: 400 });
  }
  if (!Number.isInteger(weeklyRetentionWeeks) || weeklyRetentionWeeks < 1) {
    return NextResponse.json({ error: "每週備份保留週數必須是大於等於 1 的整數" }, { status: 400 });
  }

  const updated = await prisma.systemSetting.upsert({
    where: { id: "SINGLETON" },
    create: { id: "SINGLETON", dailyRetentionDays, weeklyRetentionWeeks, updatedByName: check.operator.name },
    update: { dailyRetentionDays, weeklyRetentionWeeks, updatedByName: check.operator.name },
  });

  return NextResponse.json({
    dailyRetentionDays: updated.dailyRetentionDays,
    weeklyRetentionWeeks: updated.weeklyRetentionWeeks,
  });
}
