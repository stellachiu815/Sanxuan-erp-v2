import { NextRequest, NextResponse } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { annualLanternRosterRegister, type AnnualLanternRegInput } from "@/lib/annualLanternRegister";

/**
 * 年度燈（光明／太歲燈）「現場快速報名」內部入口。
 * POST body: { templeEventId, people: [{ name, address, phone, solarBirthDate, lanterns:[{itemKey,quantity}] }], confirm? }
 * 走共用引擎 annualLanternRosterRegister（選人→建報名→可確認）。權限：報名(register)。
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "register");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await readJsonBody(request);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  const b = body as Partial<AnnualLanternRegInput>;
  if (typeof b.templeEventId !== "string" || !b.templeEventId) {
    return NextResponse.json({ error: "缺少活動" }, { status: 400 });
  }
  if (!Array.isArray(b.people) || b.people.length === 0) {
    return NextResponse.json({ error: "請至少填一位報名者" }, { status: 400 });
  }

  const result = await annualLanternRosterRegister(
    { templeEventId: b.templeEventId, people: b.people, family: b.family ?? null, confirm: b.confirm === true },
    { id: check.operator.id, name: check.operator.name, role: check.operator.role }
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({
    ok: true,
    created: result.created,
    ritualRecordIds: result.ritualRecordIds,
    confirmed: result.confirmed,
    confirmErrors: result.confirmErrors,
    message: `已建立 ${result.created} 筆點燈${result.confirmed > 0 ? `，其中 ${result.confirmed} 筆已確認為正式` : "（草稿，可到報名管理確認）"}。`,
  });
}
