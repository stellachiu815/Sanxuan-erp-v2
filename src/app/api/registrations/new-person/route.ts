import { NextRequest, NextResponse } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { createHousehold } from "@/lib/householdManagement";
import { createMemberForHousehold } from "@/lib/memberCreate";

/**
 * V38「新增活動報名」支援新信眾：查無此人時當場建家戶＋信眾，回 memberId 供接續報名。
 * 戶名沿用規格「{姓}家」；聯絡人＝本人全名；個人地址寫入 Member.address。
 * 權限＝ritual registration「register」（這是報名流程的一步）。
 * POST { name, address? } → { memberId, householdId }
 */
export async function POST(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "register");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await readJsonBody(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const address = typeof body?.address === "string" && body.address.trim() ? body.address.trim() : null;
  if (!name) return NextResponse.json({ error: "請輸入信眾姓名" }, { status: 400 });

  try {
    const surname = name.charAt(0);
    const householdName = surname ? `${surname}家` : name;
    const hh = await createHousehold({ name: householdName, contactName: name, address }, check.operator.name);
    const mem = await createMemberForHousehold(
      hh.household.id,
      { name, isPrimaryContact: true, personalAddress: address },
      check.operator.name,
      "新增活動報名：當場建立新信眾"
    );
    return NextResponse.json({ ok: true, memberId: mem.member.id, householdId: hh.household.id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "建立新信眾時發生錯誤" }, { status: 500 });
  }
}
