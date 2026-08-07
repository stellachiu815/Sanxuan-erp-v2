import { NextRequest, NextResponse } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import {
  upsertPublicRegForm, listPublicRegistrations, confirmPublicRegistration, rejectPublicRegistration,
  DEFAULT_PRICES, type PublicRegFieldKey,
} from "@/lib/publicReg";

/**
 * V38 信眾公開報名「後台」API。
 * GET  ?templeEventId= → { form, rows(PENDING) }
 * POST { action: "save-form" | "confirm" | "reject", ... }
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const templeEventId = request.nextUrl.searchParams.get("templeEventId") ?? "";
  const status = request.nextUrl.searchParams.get("status") ?? "PENDING";
  if (!templeEventId) return NextResponse.json({ error: "缺少活動" }, { status: 400 });
  const { form, rows } = await listPublicRegistrations({ templeEventId, status });
  return NextResponse.json({ ok: true, form, rows });
}

export async function POST(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "register");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });

  if (body.action === "save-form") {
    const templeEventId = typeof body.templeEventId === "string" ? body.templeEventId : "";
    const slug = typeof body.slug === "string" ? body.slug : "";
    if (!templeEventId) return NextResponse.json({ error: "缺少活動" }, { status: 400 });
    const fields = Array.isArray(body.fields)
      ? (body.fields.filter((f: unknown) => f === "phone" || f === "address" || f === "birthday") as PublicRegFieldKey[])
      : [];
    const pr = (body.prices && typeof body.prices === "object" ? body.prices : {}) as Record<string, unknown>;
    const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
    const res = await upsertPublicRegForm({
      templeEventId, slug,
      config: {
        fields,
        prices: {
          tablet: num(pr.tablet, DEFAULT_PRICES.tablet),
          ricePerJin: num(pr.ricePerJin, DEFAULT_PRICES.ricePerJin),
          sponsorPerUnit: num(pr.sponsorPerUnit, DEFAULT_PRICES.sponsorPerUnit),
        },
      },
      headerNote: typeof body.headerNote === "string" ? body.headerNote : null,
      isOpen: body.isOpen === undefined ? true : body.isOpen === true,
      createdByName: check.operator.name,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ ok: true, form: res.form });
  }

  if (body.action === "confirm") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "缺少報名 id" }, { status: 400 });
    const res = await confirmPublicRegistration(id, { id: check.operator.id, name: check.operator.name, role: check.operator.role });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ ok: true, ritualRecordId: res.ritualRecordId });
  }

  if (body.action === "reject") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "缺少報名 id" }, { status: 400 });
    await rejectPublicRegistration(id, check.operator.name);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "未知的動作" }, { status: 400 });
}
