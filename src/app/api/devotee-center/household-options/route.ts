import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { householdSearchOrConditions } from "@/lib/devoteeSearchFields";

/**
 * V12.2「信眾建立與查詢中心」指令「一.A」：建立信眾時，用來搜尋「要加入
 * 哪一個既有家戶」的選單資料來源。
 *
 * GET /api/devotee-center/household-options?operatorUserId=xxx&q=關鍵字
 *
 * 搜尋欄位沿用共用規格 householdSearchOrConditions()（家戶編號／戶名／
 * 主要聯絡人／電話／手機／地址／公司名稱），**不另外定義一套欄位清單**，
 * 對應指令「七、搜尋邏輯收斂」。
 *
 * 權限：沿用既有 DevoteeAction "view"（跟信眾名單／全宮搜尋同一個動作），
 * 不新增第二套權限或角色。回傳的是選家戶用的精簡欄位，另外附上目前的
 * 電話與地址，讓建立畫面可以「顯示目前值」，避免無提示覆蓋既有非空資料。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const check = await assertDevoteePermissionForOperator(searchParams.get("operatorUserId"), "view");
  if (!check.ok) {
    return NextResponse.json({ success: false, error: check.error }, { status: check.status });
  }

  const q = (searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ success: true, data: { households: [] } });

  const households = await prisma.household.findMany({
    where: { deletedAt: null, OR: householdSearchOrConditions(q) },
    select: {
      id: true,
      name: true,
      contactName: true,
      phone: true,
      address: true,
      _count: { select: { members: { where: { deletedAt: null } } } },
    },
    orderBy: { id: "asc" },
    take: 10,
  });

  return NextResponse.json({
    success: true,
    data: {
      households: households.map((h) => ({
        id: h.id,
        name: h.name,
        contactName: h.contactName,
        phone: h.phone,
        address: h.address,
        memberCount: h._count.members,
      })),
    },
  });
}
