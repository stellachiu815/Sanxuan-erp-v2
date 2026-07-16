import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/system/users — 列出目前可以被選為「操作人員」的使用者。
 *
 * V11.1.1 新增。這是整個最小可用身分機制的「起點」：畫面上的
 * 「目前操作人員」選單（src/components/system/OperatorBar.tsx）要先知道
 * 系統裡有哪些人可以選，才能讓使用者選出自己是誰。
 *
 * ⚠️ 誠實揭露：這支 API 刻意「沒有」權限檢查——因為在還沒選出操作人員之前，
 * 根本不會有 operatorUserId 可以拿來檢查權限（雞生蛋問題）。也就是說，任何
 * 打得到這個系統的人都能看到「有哪些人員、各自是什麼角色」，並且可以在畫面上
 * 假冒任何一個人選（因為本輪明確要求的是「最小可用的內部操作人員身分機制」，
 * 不是真正的登入/密碼系統）。這一點會在交付報告中明確列為已知限制，
 * 而不是被這支程式掩蓋。真正要防止「冒名」，未來需要一套真正的登入機制
 * （帳號密碼或 SSO＋伺服器端 session），屬於下一輪才需要決定的重大修改。
 *
 * 回傳欄位刻意只有 id/name/role，不包含 email 等其他個資。
 */
export async function GET() {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ users });
}
