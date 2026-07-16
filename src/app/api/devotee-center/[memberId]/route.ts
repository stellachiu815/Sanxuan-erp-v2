import { NextRequest, NextResponse } from "next/server";
import { getDevotee360Overview } from "@/lib/devotee360";
import { assertDevoteePermissionForOperator } from "@/lib/operator";

/**
 * GET /api/devotee-center/xxx?operatorUserId=xxx
 * 對應指令「六、360°信眾總覽」——單一信眾的完整整合資料，見
 * src/lib/devotee360.ts（含捐款統計資料可用性誠實揭露）。
 *
 * ⚠️ 這裡的權限只檢查「view」（基本查看）。指令「十六」ADMIN 只能看
 * 「活動及收款摘要」、SUPER_ADMIN 才能看「完整收款與捐款統計」——
 * donationStats 裡的完整逐年金額目前一律回傳，畫面端（前端頁面）依照
 * check.operator.role 決定要不要把 donationStats 的完整明細顯示給
 * ADMIN／READONLY（只顯示摘要層級），這是本輪的實作分工：API 回傳完整
 * 資料、由前端依角色決定顯示深度，避免每個 360 總覽的子欄位都要各自呼叫
 * 一次 API 檢查更細的 action，之後如果要收緊成「後端也依角色裁切欄位」，
 * 可以在這裡加一段依 check.operator.role 過濾 donationStats 的邏輯。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  const { searchParams } = new URL(request.url);
  const check = await assertDevoteePermissionForOperator(searchParams.get("operatorUserId"), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const overview = await getDevotee360Overview(memberId);
  if (!overview) return NextResponse.json({ error: "找不到這位信眾" }, { status: 404 });

  return NextResponse.json({ overview });
}
