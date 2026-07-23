import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { updateTempleEventSponsorUnitPrice } from "@/lib/templeEvents";

/**
 * V14.1：中元普渡活動的年度**贊普單價**（宮方每年設定一次）。
 *
 * GET   /api/temple-events/[id]/sponsor-price?operatorUserId=xxx
 * PATCH /api/temple-events/[id]/sponsor-price   { operatorUserId, sponsorUnitPrice }
 *
 * 與寶袋單價同一套模式，但**沒有 fallback 預設**——未設定就是 null，
 * 報名時保留數量、擋住確認、顯示「尚未設定贊普單價」。
 * 權限沿用普渡權限；operatorName 一律由伺服器查證，不信任前端。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const operatorUserId = new URL(request.url).searchParams.get("operatorUserId");
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { id } = await params;
  const event = await prisma.templeEvent.findUnique({
    where: { id },
    select: { id: true, year: true, name: true, activityType: true, sponsorUnitPrice: true },
  });
  if (!event) return NextResponse.json({ error: "找不到這個活動" }, { status: 404 });

  const raw = event.sponsorUnitPrice ? Number(event.sponsorUnitPrice) : null;
  return NextResponse.json({
    ok: true,
    activityId: event.id,
    year: event.year,
    name: event.name,
    activityType: event.activityType,
    /** 資料庫實際值。null 代表尚未設定（無 fallback；報名時擋住確認）。 */
    sponsorUnitPrice: raw,
    isSet: raw !== null,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "update");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });

  const rawValue = body.sponsorUnitPrice;
  let sponsorUnitPrice: number | null;
  if (rawValue === null) {
    sponsorUnitPrice = null;
  } else if (typeof rawValue === "number") {
    sponsorUnitPrice = rawValue;
  } else if (typeof rawValue === "string" && rawValue.trim() !== "") {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return NextResponse.json({ error: "贊普單價必須是數字" }, { status: 400 });
    }
    sponsorUnitPrice = parsed;
  } else {
    return NextResponse.json({ error: "請輸入贊普單價，或明確清除設定" }, { status: 400 });
  }

  const { id } = await params;
  const result = await updateTempleEventSponsorUnitPrice(id, sponsorUnitPrice, check.operator.name);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({
    ok: true,
    ...result.data,
    message: "已更新贊普年度單價。建立普渡報名勾選贊普時，會以此單價 × 數量計算應收。",
  });
}
