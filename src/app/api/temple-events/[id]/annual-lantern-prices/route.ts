import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertActivityPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { getAnnualLanternPrices, updateAnnualLanternPrices } from "@/lib/annualLanternPricing";

/**
 * V15R5：年度燈活動的年度**祭改單價／全家燈單價**（宮方每年設定一次）。
 *
 * GET   /api/temple-events/[id]/annual-lantern-prices?operatorUserId=xxx
 * PATCH /api/temple-events/[id]/annual-lantern-prices { operatorUserId, purificationUnitPrice?, familyLanternUnitPrice? }
 *
 * 與 sponsorUnitPrice 同一套 per-year 模式：未設定＝null，報名該項應收為 0（不寫死金額）。
 * 收款走既有金流：祭改→PurificationEntry；全家燈→RitualRegistrationItem 自身計價。
 */
export const dynamic = "force-dynamic";

function parsePrice(raw: unknown): number | null | "invalid" {
  if (raw === null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 && raw <= 9_999_999 ? raw : "invalid";
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 9_999_999 ? n : "invalid";
  }
  return "invalid";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertActivityPermissionForOperator(operatorUserId, "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { id } = await params;
  const event = await prisma.templeEvent.findUnique({
    where: { id },
    select: { id: true, year: true, name: true, activityType: true },
  });
  if (!event) return NextResponse.json({ error: "找不到這個活動" }, { status: 404 });

  const prices = await getAnnualLanternPrices(event.year);

  // V15R5.1：migration 不 backfill。年度欄位仍為 NULL 時，回傳各項目 RegistrationItemType
  // .defaultUnitPrice 作為「建議預設值」，供設定畫面首次開啟時預帶顯示（**尚未寫入 DB**）；
  // 只有使用者按「儲存單價」才真正寫入 TempleEvent，避免覆蓋既有不同年度價格。
  const defaultRows = await prisma.registrationItemType.findMany({
    where: { key: { in: ["LANTERN_GUANGMING", "LANTERN_TAISUI", "LANTERN_FAMILY", "LANTERN_PURIFICATION"] } },
    select: { key: true, defaultUnitPrice: true },
  });
  const byKey = new Map(defaultRows.map((r) => [r.key, r.defaultUnitPrice != null ? Number(r.defaultUnitPrice) : null]));
  const defaults = {
    brightLightUnitPrice: byKey.get("LANTERN_GUANGMING") ?? null,
    taisuiLightUnitPrice: byKey.get("LANTERN_TAISUI") ?? null,
    familyLanternUnitPrice: byKey.get("LANTERN_FAMILY") ?? null,
    purificationUnitPrice: byKey.get("LANTERN_PURIFICATION") ?? null,
  };
  return NextResponse.json({ ok: true, activityId: event.id, year: event.year, name: event.name, ...prices, defaults });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertActivityPermissionForOperator(operatorUserId, "update");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });

  const patch: {
    brightLightUnitPrice?: number | null;
    taisuiLightUnitPrice?: number | null;
    familyLanternUnitPrice?: number | null;
    purificationUnitPrice?: number | null;
  } = {};
  if ("brightLightUnitPrice" in body) {
    const v = parsePrice(body.brightLightUnitPrice);
    if (v === "invalid") return NextResponse.json({ error: "光明燈單價必須是 0～9999999 的數字" }, { status: 400 });
    patch.brightLightUnitPrice = v;
  }
  if ("taisuiLightUnitPrice" in body) {
    const v = parsePrice(body.taisuiLightUnitPrice);
    if (v === "invalid") return NextResponse.json({ error: "太歲燈單價必須是 0～9999999 的數字" }, { status: 400 });
    patch.taisuiLightUnitPrice = v;
  }
  if ("familyLanternUnitPrice" in body) {
    const v = parsePrice(body.familyLanternUnitPrice);
    if (v === "invalid") return NextResponse.json({ error: "全家燈單價必須是 0～9999999 的數字" }, { status: 400 });
    patch.familyLanternUnitPrice = v;
  }
  if ("purificationUnitPrice" in body) {
    const v = parsePrice(body.purificationUnitPrice);
    if (v === "invalid") return NextResponse.json({ error: "祭改單價必須是 0～9999999 的數字" }, { status: 400 });
    patch.purificationUnitPrice = v;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "沒有要更新的單價欄位" }, { status: 400 });
  }

  const { id } = await params;
  const event = await prisma.templeEvent.findUnique({ where: { id }, select: { id: true } });
  if (!event) return NextResponse.json({ error: "找不到這個活動" }, { status: 404 });

  await updateAnnualLanternPrices(id, patch);
  return NextResponse.json({
    ok: true,
    message: "已更新年度燈單價（光明燈／太歲燈／全家燈／祭改）。報名時伺服器一律以該年度單價重算應收；祭改收款走 PurificationEntry、其餘走項目自身計價，皆不重複應收。",
  });
}
