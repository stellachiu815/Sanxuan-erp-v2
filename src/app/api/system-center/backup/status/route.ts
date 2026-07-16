import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertSystemPermissionForOperator } from "@/lib/operator";

/** 下一次 02:00 每日自動備份的時間（需求「十一」首頁顯示用）。 */
function nextDailyRunAt(now: Date): Date {
  const next = new Date(now);
  next.setHours(2, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

/**
 * GET /api/system-center/backup/status?operatorUserId=xxx
 * 需求「十一、首頁顯示備份狀態」：最後成功備份時間、Google Drive 綁定
 * 帳號、下一次排程時間、狀態燈號（24小時內🟢／24~48小時🟡／超過48小時🔴）。
 */
export async function GET(request: NextRequest) {
  const check = await assertSystemPermissionForOperator(
    request.nextUrl.searchParams.get("operatorUserId"),
    "viewSystemCenter"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const [lastSuccess, connection] = await Promise.all([
    prisma.backupLog.findFirst({ where: { status: "SUCCESS" }, orderBy: { finishedAt: "desc" } }),
    prisma.googleDriveConnection.findUnique({ where: { id: "SINGLETON" } }),
  ]);

  const now = new Date();
  const hoursSinceLastSuccess = lastSuccess?.finishedAt
    ? (now.getTime() - lastSuccess.finishedAt.getTime()) / (1000 * 60 * 60)
    : null;

  const statusColor =
    hoursSinceLastSuccess === null ? "red" : hoursSinceLastSuccess > 48 ? "red" : hoursSinceLastSuccess > 24 ? "yellow" : "green";

  return NextResponse.json({
    lastSuccessAt: lastSuccess?.finishedAt?.toISOString() ?? null,
    googleDriveEmail: connection?.boundEmail ?? null,
    googleDriveStatus: connection?.status ?? "DISCONNECTED",
    nextScheduledAt: nextDailyRunAt(now).toISOString(),
    statusColor,
  });
}
