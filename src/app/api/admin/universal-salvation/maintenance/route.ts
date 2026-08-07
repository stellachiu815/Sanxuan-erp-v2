import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { cleanupWorshipDuplicates } from "@/lib/cleanupWorshipDuplicates";
import { alignHouseholdAddress } from "@/lib/alignHouseholdAddress";
import { backfillEntryAddress } from "@/lib/backfillEntryAddress";
import { backfillCreditorUnbornAddress } from "@/lib/backfillCreditorUnbornAddress";
import { backfillCreditorUnbornYangshang } from "@/lib/backfillCreditorUnbornYangshang";
import { dedupCreditorUnbornTablets } from "@/lib/dedupCreditorUnbornTablets";
import { purgeArchivedHouseholdUsRecords } from "@/lib/purgeArchivedHouseholdUsRecords";
import { auditIndividualSoulNames, convertSoulToAncestor } from "@/lib/auditIndividualSoulNames";
import { batchConfirmUniversalSalvation } from "@/lib/batchConfirmUniversalSalvation";
import { checkImportMerges } from "@/lib/checkImportMerges";
import { auditTabletAddresses } from "@/lib/auditTabletAddresses";
import { ensurePublicRegTables } from "@/lib/ensurePublicRegTables";
import { archiveHouseholdsByCode } from "@/lib/archiveHouseholdsByCode";
import { auditSponsorItems, restoreSponsorItem } from "@/lib/sponsorAudit";
import { clearAllRice } from "@/lib/whiteRiceService";

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

  let body: { action?: string; commit?: boolean; confirm?: boolean; year?: number; keepIds?: string[]; codes?: string[]; id?: string; source?: string; query?: string; itemId?: string };
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
    if (body?.action === "backfill-creditor-unborn-address") {
      const report = await backfillCreditorUnbornAddress(year, { commit });
      return NextResponse.json({ ok: true, report });
    }
    if (body?.action === "backfill-creditor-unborn-yangshang") {
      const report = await backfillCreditorUnbornYangshang(year, { commit });
      return NextResponse.json({ ok: true, report });
    }
    if (body?.action === "dedup-creditor-unborn") {
      const report = await dedupCreditorUnbornTablets(year, { commit, operatorName: check.operator.name });
      return NextResponse.json({ ok: true, report });
    }
    if (body?.action === "purge-archived-us-records") {
      const report = await purgeArchivedHouseholdUsRecords({ year, commit, operatorName: check.operator.name });
      return NextResponse.json({ ok: true, report });
    }
    if (body?.action === "import-merge-check") {
      const report = await checkImportMerges(year);
      return NextResponse.json({ ok: true, report });
    }
    if (body?.action === "batch-confirm-us") {
      const report = await batchConfirmUniversalSalvation(year, { commit, operatorName: check.operator.name });
      return NextResponse.json({ ok: true, report });
    }
    if (body?.action === "soul-name-audit") {
      const report = await auditIndividualSoulNames(year);
      return NextResponse.json({ ok: true, report });
    }
    if (body?.action === "convert-soul-to-ancestor") {
      const id = typeof body?.id === "string" ? body.id : "";
      const src = body?.source === "本年度報名" ? "本年度報名" : "永久牌位";
      if (!id) return NextResponse.json({ error: "缺少牌位 id" }, { status: 400 });
      const res = await convertSoulToAncestor(id, src, check.operator.name);
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    if (body?.action === "address-audit") {
      const report = await auditTabletAddresses(year);
      return NextResponse.json({ ok: true, report });
    }
    if (body?.action === "init-public-reg-tables") {
      const report = await ensurePublicRegTables();
      return NextResponse.json({ ok: report.ok, report });
    }
    if (body?.action === "archive-households") {
      const report = await archiveHouseholdsByCode(body?.codes ?? [], { commit, operatorName: "系統管理（依編號封存）" });
      return NextResponse.json({ ok: report.ok, report });
    }
    if (body?.action === "sponsor-audit") {
      const report = await auditSponsorItems(year, typeof body?.query === "string" ? body.query : "");
      return NextResponse.json({ ok: true, report });
    }
    if (body?.action === "restore-sponsor-item") {
      const itemId = typeof body?.itemId === "string" ? body.itemId : "";
      if (!itemId) return NextResponse.json({ error: "缺少贊普項目 id" }, { status: 400 });
      const res = await restoreSponsorItem(itemId, check.operator.name);
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    if (body?.action === "clear-all-rice") {
      const report = await clearAllRice(year, { commit, operatorName: check.operator.name });
      return NextResponse.json({ ok: true, report });
    }
    return NextResponse.json({ error: "未知的整理動作" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "整理時發生錯誤" }, { status: 500 });
  }
}
