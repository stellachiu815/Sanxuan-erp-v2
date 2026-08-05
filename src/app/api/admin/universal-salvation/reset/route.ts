import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { resetUniversalSalvation } from "@/lib/resetUniversalSalvation";

/**
 * V36.13 中元普渡「範圍化重置」API（瀏覽器可觸發，不需終端機）。
 *
 * POST /api/admin/universal-salvation/reset
 *   body: { year: number, commit?: boolean, confirmText?: string }
 *
 * 權限：purgeRecycleBin（等同永久刪除等級，僅最高管理員）。
 * commit 省略／false → Dry-Run：只回各表預計刪除筆數，不寫入。
 * commit=true → 必須帶 confirmText＝「清空<年>普渡」才執行硬刪（財務保護：有收款一律跳過）。
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request), "purgeRecycleBin");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  let body: { year?: number; commit?: boolean; confirmText?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const year = Number(body?.year);
  if (!Number.isInteger(year)) return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });

  const commit = body?.commit === true;
  if (commit) {
    const expected = `清空${year}普渡`;
    if ((body?.confirmText ?? "").trim() !== expected) {
      return NextResponse.json({ error: `正式清空需在確認欄輸入「${expected}」，才會執行。` }, { status: 400 });
    }
  }

  try {
    const report = await resetUniversalSalvation(year, { commit });
    if (!report.ok) return NextResponse.json({ error: report.error ?? "重置失敗" }, { status: 400 });
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "重置時發生錯誤" }, { status: 500 });
  }
}
