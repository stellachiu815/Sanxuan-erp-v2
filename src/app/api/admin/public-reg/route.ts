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

/** 資料表未建立時給明確指引（而非一般 500）。 */
function tablesMissing(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /public_reg_forms|public_registrations|does not exist|relation .* does not exist|42P01/i.test(m);
}
const BUILD_TABLES_HINT = "『信眾報名』資料表尚未建立，請先到「系統管理 → 家戶資料整理 →『建立信眾報名資料表』」按一下再回來。";

export async function GET(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const templeEventId = request.nextUrl.searchParams.get("templeEventId") ?? "";
  const status = request.nextUrl.searchParams.get("status") ?? "PENDING";
  if (!templeEventId) return NextResponse.json({ error: "缺少活動" }, { status: 400 });
  try {
    const { form, rows } = await listPublicRegistrations({ templeEventId, status });
    return NextResponse.json({ ok: true, form, rows });
  } catch (e) {
    if (tablesMissing(e)) return NextResponse.json({ error: BUILD_TABLES_HINT }, { status: 409 });
    return NextResponse.json({ error: "讀取失敗，請稍後再試" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "register");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  try {
    return await handlePost(body, check.operator);
  } catch (e) {
    if (tablesMissing(e)) return NextResponse.json({ error: BUILD_TABLES_HINT }, { status: 409 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "操作失敗" }, { status: 500 });
  }
}

async function handlePost(body: Record<string, unknown>, operator: { id: string; name: string; role: import("@/lib/permissions").Role }) {
  const check = { operator };
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
          pocket: num(pr.pocket, DEFAULT_PRICES.pocket),
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
