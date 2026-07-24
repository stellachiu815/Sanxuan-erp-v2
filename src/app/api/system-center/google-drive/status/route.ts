import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { folderWebViewLink } from "@/lib/googleDrive";

/**
 * GET /api/system-center/google-drive/status?operatorUserId=xxx
 * 需求「二」：管理員可以「查看目前綁定帳號」。
 *
 * V11.2.1 補強（對應指令「三」）：補上最近一次成功驗證時間、最近一次
 * 成功上傳時間（來自 BackupLog，不在 GoogleDriveConnection 重複存一份，
 * 避免兩個資料來源不同步）、備份根資料夾名稱與連結、Token 狀態。
 */
export async function GET(request: NextRequest) {
  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request),
    "viewSystemCenter"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const [conn, lastSuccessfulUpload] = await Promise.all([
    prisma.googleDriveConnection.findUnique({ where: { id: "SINGLETON" } }),
    prisma.backupLog.findFirst({ where: { status: "SUCCESS" }, orderBy: { finishedAt: "desc" } }),
  ]);

  return NextResponse.json({
    status: conn?.status ?? "DISCONNECTED",
    // 需求「三」：Token 狀態只顯示狀態文字，不洩漏任何憑證內容。
    tokenStatus: !conn || conn.status === "DISCONNECTED" ? "尚未連結" : conn.status === "CONNECTED" ? "有效" : "異常，需要重新連結",
    boundEmail: conn?.boundEmail ?? null,
    connectedAt: conn?.connectedAt?.toISOString() ?? null,
    connectedByName: conn?.connectedByName ?? null,
    lastVerifiedAt: conn?.lastVerifiedAt?.toISOString() ?? null,
    lastUploadAt: lastSuccessfulUpload?.finishedAt?.toISOString() ?? null,
    lastError: conn?.lastError ?? null,
    rootFolderName: conn?.rootFolderId ? "三玄宮ERP_Backup" : null,
    rootFolderWebViewLink: conn?.rootFolderId ? folderWebViewLink(conn.rootFolderId) : null,
    folders: {
      root: !!conn?.rootFolderId,
      daily: !!conn?.dailyFolderId,
      weekly: !!conn?.weeklyFolderId,
      monthly: !!conn?.monthlyFolderId,
      beforeUpdate: !!conn?.beforeUpdateFolderId,
    },
    lastTestResult: conn?.lastTestResult ? JSON.parse(conn.lastTestResult) : null,
  });
}
