import { NextRequest, NextResponse } from "next/server";
import { recordDevoteeCareContact } from "@/lib/devoteeCare";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * POST /api/devotee-center/xxx/care/contact
 *   body: { operatorUserId, contactedAt?, nextContactDate?, note? }
 * 對應指令「十一」：記錄一次關懷聯絡，不改變 careFlag 本身
 * （manageCareList，SUPER_ADMIN 專屬——見權限矩陣，本輪把整個關懷名單的
 * 寫入動作都歸在同一個 action 底下，沒有再細分「記錄聯絡」跟「正式標記」
 * 的權限層級）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  const body = await request.json().catch(() => ({}));

  const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "manageCareList");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const profile = await recordDevoteeCareContact(
    memberId,
    {
      contactedAt: body?.contactedAt ? new Date(body.contactedAt) : new Date(),
      nextContactDate: body?.nextContactDate !== undefined ? (body.nextContactDate ? new Date(body.nextContactDate) : null) : undefined,
      note: typeof body?.note === "string" ? body.note : undefined,
    },
    check.operator.name
  );
  return NextResponse.json({ profile });
}
