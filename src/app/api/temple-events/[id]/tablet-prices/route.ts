import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { updateTempleEventTabletPrices, type TabletUnitPriceInput } from "@/lib/templeEvents";

/**
 * V14.2：中元普渡「四類牌位」年度單價（宮方每年設定一次）。
 *
 * GET   /api/temple-events/[id]/tablet-prices?operatorUserId=xxx
 * PATCH /api/temple-events/[id]/tablet-prices
 *        { operatorUserId, ancestorUnitPrice?, zhenghunUnitPrice?, yuanqinUnitPrice?, wuyuanUnitPrice? }
 *
 * 與贊普單價同一套 per-year 結構；null 代表清除該欄位。權限沿用普渡權限，
 * operatorName 一律伺服器查證。
 */
export const dynamic = "force-dynamic";

const FIELDS = [
  "ancestorUnitPrice",
  "zhenghunUnitPrice",
  "yuanqinUnitPrice",
  "wuyuanUnitPrice",
] as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const operatorUserId = new URL(request.url).searchParams.get("operatorUserId");
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { id } = await params;
  const event = await prisma.templeEvent.findUnique({
    where: { id },
    select: {
      id: true,
      year: true,
      name: true,
      activityType: true,
      ancestorUnitPrice: true,
      zhenghunUnitPrice: true,
      yuanqinUnitPrice: true,
      wuyuanUnitPrice: true,
    },
  });
  if (!event) return NextResponse.json({ error: "找不到這個活動" }, { status: 404 });

  return NextResponse.json({
    ok: true,
    activityId: event.id,
    year: event.year,
    name: event.name,
    activityType: event.activityType,
    ancestorUnitPrice: event.ancestorUnitPrice ? Number(event.ancestorUnitPrice) : null,
    zhenghunUnitPrice: event.zhenghunUnitPrice ? Number(event.zhenghunUnitPrice) : null,
    yuanqinUnitPrice: event.yuanqinUnitPrice ? Number(event.yuanqinUnitPrice) : null,
    wuyuanUnitPrice: event.wuyuanUnitPrice ? Number(event.wuyuanUnitPrice) : null,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "update");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });

  // 只挑四個已知欄位；每欄允許 number（單價）、null（清除）或字串數字。未帶的不動。
  const input: TabletUnitPriceInput = {};
  for (const field of FIELDS) {
    if (!(field in body)) continue;
    const raw = body[field];
    if (raw === null) {
      input[field] = null;
    } else if (typeof raw === "number") {
      input[field] = raw;
    } else if (typeof raw === "string" && raw.trim() !== "") {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        return NextResponse.json({ error: `${field} 必須是數字` }, { status: 400 });
      }
      input[field] = parsed;
    } else if (typeof raw === "string") {
      input[field] = null; // 空字串＝清除
    } else {
      return NextResponse.json({ error: `${field} 格式錯誤` }, { status: 400 });
    }
  }

  const { id } = await params;
  const result = await updateTempleEventTabletPrices(id, input, check.operator.name);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({
    ok: true,
    ...result.data,
    message: "已更新中元普渡四類牌位年度單價。建立報名時會以各項單價 × 數量計算應收。",
  });
}
