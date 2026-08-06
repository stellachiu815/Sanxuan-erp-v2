import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { cleanupWorshipDuplicates } from "@/lib/cleanupWorshipDuplicates";
import { alignHouseholdAddress } from "@/lib/alignHouseholdAddress";
import { backfillEntryAddress } from "@/lib/backfillEntryAddress";
import { checkImportMerges } from "@/lib/checkImportMerges";
import { auditTabletAddresses } from "@/lib/auditTabletAddresses";
import { ensurePublicRegTables } from "@/lib/ensurePublicRegTables";

/**
 * V36.14 家戶資料整理 API（瀏覽器可觸發，權限 purgeRecycleBin）。
 *   POST body: { action, commit?, confirm?, year? }
 *   action：worship-dedup／household-address／backfill-address／import-merge-check
 *   commit 省略／false → 預覽（不寫入）。commit=true 需 confirm=true 才執行。import-merge-check 純唯讀。
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request), "purgeRecycleBin");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  let body: { action?: string; commit?: boolean; confirm?: boolean; year?: number; keepIds?: string[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 }); }

  const commit = body?.commit === true;
  if (commit && body?.confirm !== true) return NextResponse.json({ error: "請先確認，才會執行。" }, { status: 400 });
  const year = Number.isInteger(body?.year) ? (body!.year as number) : new Date().getFullYear() - 1911;

  try {
    if (body?.action === "worship-dedup") {
      const report = await cleanupWorshipDuplicates({ commit, keepIds: body?.keepIds });
      return NextResponse.json({ ok: true, report });
    }
    if (body?.action === "household-address") {
      const report = await alignHouseholdAddress({ commit });
      return NextResponse.json({ ok: true, report });
    }
    if (body?.action === "backfill-address") {
      const report = await backfillEntryAddress(year, { commit });
      return NextResponse.json({ ok: true, report });
    }
    if (body?.action === "import-merge-check") {
      const report = await checkImportMerges(year);
      return NextResponse.json({ ok: true, report });
    }
    if (body?.action === "address-audit") {
      const report = await auditTabletAddresses(year);
      return NextResponse.json({ ok: true, report });
    }
    if (body?.action === "init-public-reg-tables") {
      const report = await ensurePublicRegTables();
      return NextResponse.json({ ok: report.ok, report });
    }
    return NextResponse.json({ error: "未知的整理動作" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "整理時發生錯誤" }, { status: 500 });
  }
}
