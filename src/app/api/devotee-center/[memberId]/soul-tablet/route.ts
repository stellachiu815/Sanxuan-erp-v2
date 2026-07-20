import { NextResponse } from "next/server";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import {
  buildSoulTabletPreview,
  createSoulTablet,
  buildUniversalSalvationJoinPreview,
  joinUniversalSalvation,
} from "@/lib/soulTabletFlow";
import { markSoulTabletPrompted } from "@/lib/devoteeBaseEdit";

/**
 * V13.1 指令五／九：辭世後的兩段式流程 API。
 *
 * GET    ?operatorUserId=xxx            → 建立乙位正魂的預覽資料（含重複檢查）
 * POST   { action: "create", ... }      → 建立乙位正魂
 * POST   { action: "defer" }            → 「暫不處理」，之後不再自動詢問
 * POST   { action: "salvation-preview", worshipRecordId }
 *                                       → 詢問②：預設普渡年度與確認文案
 * POST   { action: "join-salvation", worshipRecordId, year }
 *                                       → 加入指定年度的中元普渡
 *
 * ⚠️ 每一個動作都由使用者明確觸發。系統**不會**在信眾被標記為已辭世時
 * 自動建立乙位正魂，也不會自動加入普渡（指令五、九）。
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> }
) {
  const { searchParams } = new URL(request.url);
  const check = await assertDevoteePermissionForOperator(
    searchParams.get("operatorUserId"),
    "view"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { memberId } = await params;
  const preview = await buildSoulTabletPreview(memberId, check.operator.name);
  if (!preview) {
    return NextResponse.json({ error: "找不到這位信眾" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, preview });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> }
) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "資料格式錯誤" }, { status: 400 });
  }

  const check = await assertDevoteePermissionForOperator(body.operatorUserId, "updateProfile");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { memberId } = await params;
  const action = typeof body.action === "string" ? body.action : "";

  // ── 「暫不處理」：只記錄，不建立任何資料 ──
  if (action === "defer") {
    await markSoulTabletPrompted(memberId);
    return NextResponse.json({
      ok: true,
      message: "已記錄「暫不處理」。信眾詳情頁仍保留「建立乙位正魂」按鈕，日後可隨時建立。",
    });
  }

  // ── 建立乙位正魂 ──
  if (action === "create") {
    const result = await createSoulTablet({
      memberId,
      displayName: typeof body.displayName === "string" ? body.displayName : "",
      location: typeof body.location === "string" ? body.location : null,
      yangshangName: typeof body.yangshangName === "string" ? body.yangshangName : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      operatorName: check.operator.name,
    });

    if (!result.ok) {
      // 已有乙位正魂 → 回 409 並附上既有 id，讓畫面提供「查看既有資料」
      return NextResponse.json(
        { error: result.error, existingId: result.existingId ?? null },
        { status: result.existingId ? 409 : 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      worshipRecordId: result.worshipRecordId,
      warnings: result.warnings,
    });
  }

  // ── 詢問②：普渡年度預覽 ──
  if (action === "salvation-preview") {
    const worshipRecordId = typeof body.worshipRecordId === "string" ? body.worshipRecordId : "";
    if (!worshipRecordId) {
      return NextResponse.json({ error: "請指定牌位" }, { status: 400 });
    }
    const preview = await buildUniversalSalvationJoinPreview(worshipRecordId);
    if (!preview) return NextResponse.json({ error: "找不到這筆牌位資料" }, { status: 404 });
    return NextResponse.json({ ok: true, preview });
  }

  // ── 加入中元普渡 ──
  if (action === "join-salvation") {
    const worshipRecordId = typeof body.worshipRecordId === "string" ? body.worshipRecordId : "";
    const year = Number(body.year);
    if (!worshipRecordId) {
      return NextResponse.json({ error: "請指定牌位" }, { status: 400 });
    }
    if (!Number.isInteger(year) || year < 1) {
      return NextResponse.json({ error: "請指定正確的活動年度" }, { status: 400 });
    }

    const result = await joinUniversalSalvation({
      worshipRecordId,
      year,
      operatorName: check.operator.name,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      ritualRecordId: result.ritualRecordId,
      entryId: result.entryId,
      year: result.year,
      message: `已加入民國 ${result.year} 年中元普渡`,
    });
  }

  return NextResponse.json({ error: "不支援的操作" }, { status: 400 });
}
