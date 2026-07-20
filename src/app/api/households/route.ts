import { NextRequest, NextResponse } from "next/server";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import {
  createHousehold,
  searchHouseholds,
  toHouseholdApiError,
} from "@/lib/householdManagement";

/**
 * V12.1「家戶管理中心」指令「六、家戶列表」「七、家戶搜尋」「八、新增家戶」。
 *
 * GET  /api/households?query=xxx&page=1&pageSize=20
 * POST /api/households  body: { operatorUserId, householdCode, householdName, primaryContact, address, phone, mobile, companyName, notes }
 *
 * 查詢（GET）不需要權限檢查——沿用既有信眾中心/家戶頁「查看」不設防的
 * 一貫作法（見 src/lib/operator.ts 說明：系統目前沒有登入/session，
 * 「查看」層級的資料本來就沒有伺服器端門檻，只有會寫入資料的操作才檢查
 * DevoteeAction.updateProfile）。新增家戶會寫入資料，一律要求權限。
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query") ?? searchParams.get("q") ?? undefined;
    const page = searchParams.get("page") ? Number(searchParams.get("page")) : undefined;
    const pageSize = searchParams.get("pageSize") ? Number(searchParams.get("pageSize")) : undefined;
    const includeArchived = searchParams.get("includeArchived") === "true";

    const result = await searchHouseholds({ query, page, pageSize, includeArchived });
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ success: false, error }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "請求格式錯誤" }, { status: 400 });
    }

    const check = await assertDevoteePermissionForOperator(body.operatorUserId, "updateProfile");
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

    const { household } = await createHousehold(
      {
        id: typeof body.householdCode === "string" ? body.householdCode : undefined,
        name: typeof body.householdName === "string" ? body.householdName : undefined,
        contactName: body.primaryContact,
        address: body.address,
        phone: body.phone,
        mobile: body.mobile,
        companyName: body.companyName,
        notes: body.notes,
      },
      check.operator.name
    );

    return NextResponse.json({ success: true, data: { household } }, { status: 201 });
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ success: false, error }, { status });
  }
}
