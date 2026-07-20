import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { recordVersion } from "@/lib/recordVersion";

/**
 * V12「信眾資料中心正式建置」指令「九、其他使用者帳號」。
 *
 * 這裡是「使用者帳號管理」頁面用的 API，跟既有的 GET /api/system/users
 * （src/app/api/system/users/route.ts）是兩支不同的 API，刻意分開：
 * - GET /api/system/users：給「目前操作人員」下拉選單用，刻意沒有權限
 *   檢查（雞生蛋問題，見該檔案開頭說明），只回傳 isActive 的使用者、
 *   只回傳 id/name/role 三個欄位，不能改動這支既有 API 的行為。
 * - 這裡（/api/system-center/users）：給「使用者帳號管理」頁面用，需要
 *   看到全部使用者（含已停用）、需要建立/修改，所以需要驗證操作人員
 *   權限（manageUsers），不能沿用上面那支公開的 API。
 *
 * ⚠️ 依照這次明確的指令：不新增 password／passwordHash／session／token
 * 任何欄位或流程，這裡完全沒有涉及密碼——「建立操作人員」只需要姓名跟
 * 角色，跟真正的登入帳號無關。
 */

const VALID_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "STAFF", "READONLY", "FINANCE_CLERK"];

/** GET /api/system-center/users?operatorUserId=xxx — 列出全部使用者（含已停用）。 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const check = await assertSystemPermissionForOperator(searchParams.get("operatorUserId"), "manageUsers");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ users });
}

/**
 * POST /api/system-center/users
 * body: { operatorUserId, name, role }
 * 對應指令「九、1、建立操作人員」。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const check = await assertSystemPermissionForOperator(body.operatorUserId, "manageUsers");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "請輸入姓名" }, { status: 400 });
  }

  const role = typeof body.role === "string" ? body.role : "";
  if (!VALID_ROLES.includes(role as Role)) {
    return NextResponse.json({ error: "角色選項不正確" }, { status: 400 });
  }
  // V12 指令「九」明確只開放指定 ADMIN／STAFF／READONLY 三種角色——
  // SUPER_ADMIN／FINANCE_CLERK 不開放透過這個新畫面建立，避免一般管理員
  // 誤操作就能建立出另一個最高管理員帳號（FINANCE_CLERK 是尚未真正啟用
  // 的預留角色，同樣不開放）。
  if (role === "SUPER_ADMIN" || role === "FINANCE_CLERK") {
    return NextResponse.json({ error: "這個角色不開放從此畫面建立" }, { status: 400 });
  }

  const user = await prisma.user.create({
    data: { name, role: role as Role, isActive: true },
  });

  await recordVersion({
    entityType: "User",
    entityId: user.id,
    action: "CREATE",
    afterData: user,
    operatorName: check.operator.name,
    changeNote: "使用者帳號管理：建立操作人員",
  });

  return NextResponse.json({ user }, { status: 201 });
}
