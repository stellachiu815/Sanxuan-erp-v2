import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import {
  listTestCleanupData,
  deleteTestEvent,
  deleteTestReceipt,
  archiveTestHousehold,
} from "@/lib/testCleanup";

/**
 * V40「測試資料清理」API（瀏覽器可觸發，權限 purgeRecycleBin）。
 *   POST body: { action, id?, commit?, confirm? }
 *   action：list（唯讀清單）／delete-event／delete-receipt／archive-household
 *   commit 省略／false → 預覽（不寫入）。commit=true 需 confirm=true 才會真的執行。
 *   刪除前務必先到「系統管理→備份」按「立即備份」，那是唯一的還原保險。
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request), "purgeRecycleBin");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  let body: { action?: string; id?: string; commit?: boolean; confirm?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const commit = body?.commit === true;
  if (commit && body?.confirm !== true) {
    return NextResponse.json({ error: "請先確認，才會執行。" }, { status: 400 });
  }

  try {
    if (body?.action === "list") {
      const data = await listTestCleanupData();
      return NextResponse.json({ ok: true, data });
    }
    if (body?.action === "delete-event") {
      if (!body?.id) return NextResponse.json({ error: "缺少活動 id" }, { status: 400 });
      const report = await deleteTestEvent(body.id, commit);
      return NextResponse.json({ ok: true, report });
    }
    if (body?.action === "delete-receipt") {
      if (!body?.id) return NextResponse.json({ error: "缺少感謝狀 id" }, { status: 400 });
      const report = await deleteTestReceipt(body.id, commit);
      return NextResponse.json({ ok: true, report });
    }
    if (body?.action === "archive-household") {
      if (!body?.id) return NextResponse.json({ error: "缺少家戶 id" }, { status: 400 });
      const report = await archiveTestHousehold(body.id, commit, check.operator.name);
      return NextResponse.json({ ok: true, report });
    }
    return NextResponse.json({ error: "不支援的動作" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "執行失敗" }, { status: 400 });
  }
}
