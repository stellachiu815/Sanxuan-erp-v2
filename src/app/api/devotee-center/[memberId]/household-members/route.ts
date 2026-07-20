import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { createMemberForHousehold } from "@/lib/memberCreate";
import { toHouseholdApiError } from "@/lib/householdManagement";

/**
 * POST /api/devotee-center/xxx/household-members
 *
 * 對應指令「四、其他資料：家戶成員」——在信眾完整資料編輯頁，直接為目前
 * 這位信眾所屬的家戶新增一位新成員，不需要跳去 /household/[id] 頁面。
 *
 * ⚠️ V12.2「信眾建立與查詢中心」指令「三」＋裁決事項 3：**這支 route 已經
 * 改成薄轉接。**
 *
 * 歷史背景（保留說明，避免之後又有人重複同樣的判斷）：V12.0 建立這支
 * route 的原因，是當時 POST /api/households/[id]/members 完全沒有權限檢查，
 * 而信眾資料中心需要權限把關，又不想「順便修改其他模組」，因此複製了一份
 * 幾乎一樣的新增邏輯。V12.1 已經幫那支正式 API 補上完全相同的權限檢查，
 * 這份複製品存在的理由就消失了，而且兩者已經開始分歧（生日解析方式不同、
 * 回應格式不同），是後續 bug 的來源。
 *
 * 現在的作法：**這裡不再有任何 Prisma create**，唯一的建立邏輯集中在
 * src/lib/memberCreate.ts，跟 /api/households/[id]/members 共用同一個
 * service。依裁決事項 3，這個路由本身**保留不刪除**，既有呼叫端
 * （信眾完整資料編輯頁）完全不受影響。
 *
 * 這支跟正式 API 的唯一差別，只是「目標家戶怎麼決定」：這裡是用網址上的
 * memberId 反查他所屬的家戶，正式 API 則是直接指定家戶編號。
 *
 * body 同既有格式，另外多帶 operatorUserId。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  try {
    const { memberId } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
    }

    const check = await assertDevoteePermissionForOperator(body.operatorUserId, "updateProfile");
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    // 以這位信眾為錨點，找出要新增成員的目標家戶。
    const anchor = await prisma.member.findUnique({
      where: { id: memberId },
      select: { householdId: true, deletedAt: true },
    });
    if (!anchor || anchor.deletedAt) {
      return NextResponse.json({ error: "找不到這位信眾，無法為其家戶新增成員" }, { status: 404 });
    }

    const { member } = await createMemberForHousehold(
      anchor.householdId,
      body,
      check.operator.name,
      "信眾資料中心：透過信眾完整資料編輯頁新增家戶成員"
    );

    revalidatePath(`/household/${anchor.householdId}`);
    revalidatePath(`/devotee-center/${memberId}`);

    // ⚠️ 回應格式刻意維持既有的 { member }（不是 V12.1 的 { success, data }
    // 信封）——這支是既有呼叫端正在使用的路由，改信封會直接讓信眾完整資料
    // 編輯頁壞掉，而本次指令是「不得破壞既有呼叫端」。錯誤格式同樣維持
    // 既有的 { error }。
    return NextResponse.json({ member }, { status: 201 });
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ error }, { status });
  }
}
