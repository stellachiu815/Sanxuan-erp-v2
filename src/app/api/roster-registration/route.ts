import { NextRequest, NextResponse } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { rosterRegister, type RosterRegInput } from "@/lib/rosterRegister";

/**
 * 名單型（贊普型）報名 API——補庫／宮燈／年度燈的「現場快速報名」內部入口。
 * POST body: { templeEventId, itemKey?, people: [...], confirm? }
 * 選人（新／舊信眾）、一人一份 × 固定單價;新信眾當場建檔。走共用引擎 rosterRegister。
 * 權限：報名(register)。公開報名頁另有專屬入口(建草稿、人工確認)。
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "register");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await readJsonBody(request);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  const b = body as Partial<RosterRegInput>;
  if (typeof b.templeEventId !== "string" || !b.templeEventId) {
    return NextResponse.json({ error: "缺少活動" }, { status: 400 });
  }
  if (!Array.isArray(b.people) || b.people.length === 0) {
    return NextResponse.json({ error: "請至少填一位報名者" }, { status: 400 });
  }

  const result = await rosterRegister(
    { templeEventId: b.templeEventId, itemKey: b.itemKey ?? null, people: b.people, confirm: b.confirm === true },
    { id: check.operator.id, name: check.operator.name, role: check.operator.role }
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({
    ok: true,
    created: result.created,
    ritualRecordIds: result.ritualRecordIds,
    confirmed: result.confirmed,
    confirmErrors: result.confirmErrors,
    message: `已建立 ${result.created} 筆報名${result.confirmed > 0 ? `，其中 ${result.confirmed} 筆已確認為正式` : "（草稿，可到報名管理確認）"}。`,
  });
}
