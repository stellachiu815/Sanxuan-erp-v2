import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { runUniversalSalvationPreLaunchCheck, summarizePreLaunch } from "@/lib/universalSalvationPreLaunchCheck";

/**
 * V30.6：中元普渡上線前檢查（唯讀）。JSON 供管理頁；?format=xlsx 匯出。僅具檢視權限者可看。
 * GET /api/universal-salvation/[year]/pre-launch-check?operatorUserId=xxx[&format=xlsx]
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ year: string }> }) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const { year: yearParam } = await params;
  const year = Number(yearParam);
  if (!Number.isInteger(year)) return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });

  const findings = await runUniversalSalvationPreLaunchCheck(year);

  if (request.nextUrl.searchParams.get("format") === "xlsx") {
    const header = ["問題類型", "家戶", "對象", "record id", "entry id", "item id", "建立時間", "問題原因", "建議處理"];
    const body = findings.map((f) => [f.category, f.household, f.subject, f.recordId ?? "", f.entryId ?? "", f.itemId ?? "", f.createdAt ?? "", f.reason, f.action]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "上線前檢查");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const filename = encodeURIComponent(`民國${year}年中元普渡上線前檢查.xlsx`);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      },
    });
  }

  return NextResponse.json({ ok: true, year, summary: summarizePreLaunch(findings), findings });
}
