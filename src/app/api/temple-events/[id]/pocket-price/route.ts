import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { updateTempleEventPocketUnitPrice } from "@/lib/templeEvents";
import { resolvePocketUnitPrice } from "@/lib/pocketPricing";

/**
 * V13.3B：活動的寶袋年度預設單價。
 *
 * GET   /api/temple-events/[id]/pocket-price?operatorUserId=xxx
 * PATCH /api/temple-events/[id]/pocket-price   { operatorUserId, pocketUnitPrice }
 *
 * ── 為什麼是獨立端點而不是改 /temple-events/[id] ──────────────
 * 既有的 /api/temple-events/[id] **只有 GET**，沒有 PATCH——活動的其他
 * 欄位目前是透過活動精靈（建立時）設定的，沒有通用的更新端點。
 * 與其為了一個欄位新造一支通用 PATCH（會需要決定哪些欄位可改、各自的
 * 權限與驗證，範圍遠超本輪），這裡開一支**語意明確、只管一件事**的端點。
 *
 * 這不是「第二套活動設定頁」——UI 仍在既有的活動畫面內，只是後端多一支
 * 專用端點。
 *
 * 權限沿用 V13.3A 的普渡權限（寶袋屬普渡報名內容），operatorName 一律
 * 由伺服器查證，不信任前端。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const operatorUserId = new URL(request.url).searchParams.get("operatorUserId");
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "view");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const { id } = await params;
  const event = await prisma.templeEvent.findUnique({
    where: { id },
    select: { id: true, year: true, name: true, activityType: true, pocketUnitPrice: true },
  });
  if (!event) return NextResponse.json({ error: "找不到這個活動" }, { status: 404 });

  const raw = event.pocketUnitPrice ? Number(event.pocketUnitPrice) : null;
  return NextResponse.json({
    ok: true,
    activityId: event.id,
    year: event.year,
    name: event.name,
    activityType: event.activityType,
    /** 資料庫實際值。null 代表這個活動沒有設定過 */
    pocketUnitPrice: raw,
    /** 畫面應顯示的有效單價（null 時 fallback 300） */
    effectivePocketUnitPrice: resolvePocketUnitPrice(raw),
    /** 這個值是不是 fallback 來的，供畫面標示「使用系統預設」 */
    isFallback: raw === null,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "update");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });

  /**
   * 伺服器端再次驗證（指令第六階段之 8、9）：
   * 防止負數、空值與非數字。null 代表明確清除設定。
   */
  const rawValue = body.pocketUnitPrice;
  let pocketUnitPrice: number | null;
  if (rawValue === null) {
    pocketUnitPrice = null;
  } else if (typeof rawValue === "number") {
    pocketUnitPrice = rawValue;
  } else if (typeof rawValue === "string" && rawValue.trim() !== "") {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return NextResponse.json({ error: "寶袋單價必須是數字" }, { status: 400 });
    }
    pocketUnitPrice = parsed;
  } else {
    return NextResponse.json({ error: "請輸入寶袋單價，或明確清除設定" }, { status: 400 });
  }

  const { id } = await params;
  const result = await updateTempleEventPocketUnitPrice(id, pocketUnitPrice, check.operator.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    ...result.data,
    message: "已更新寶袋預設單價。這只影響之後新增的寶袋，既有寶袋金額不變。",
  });
}
