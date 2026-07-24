import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import {
  createMemberForHousehold,
  normalizeCreateMemberInput,
  findDuplicatesForExistingHousehold,
} from "@/lib/memberCreate";
import { toHouseholdApiError } from "@/lib/householdManagement";

/**
 * 新增家人 API —— **系統唯一的正式新增家戶成員（信眾）入口**
 * （V12.2 指令「三、統一新增 API 實作」裁決事項 2）。
 *
 * POST /api/households/F00009/members
 *
 * body 範例：
 * {
 *   "operatorUserId": "user_xxx",   // 必填，權限驗證用
 *   "name": "王小美",
 *   "gender": "女",
 *   "role": "DAUGHTER",
 *   "isPrimaryContact": false,
 *   "isDeceased": false,
 *   "notes": "備註",
 *   "mobile": "0912345678",        // V12.2 新增：個人手機 → DevoteeProfile.mobile
 *   "birthdayType": "solar",       // "solar" | "lunar" | "none"
 *   "solarBirthDate": "1990-05-10",
 *   // 或者
 *   "birthdayType": "lunar",
 *   "lunarBirthYear": 1990,
 *   "lunarBirthMonth": 4,
 *   "lunarBirthDay": 20,
 *   "lunarIsLeapMonth": false
 * }
 *
 * 實際的驗證與寫入邏輯全部在 src/lib/memberCreate.ts，這支 route 只負責
 * 「權限檢查 → 呼叫 service → 包裝回應」。V12.0 另外複製的
 * /api/devotee-center/[memberId]/household-members 已改為薄轉接同一個
 * service，兩支 route 不再各自持有 Prisma create。
 *
 * 權限（V12.1 補上、V12.2 維持不變）：沿用
 * assertDevoteePermissionForOperator(..., "updateProfile")，沒有帶
 * operatorUserId 回 401、角色不足回 403。版本紀錄的操作人一律採用伺服器端
 * 查到的真實姓名，不接受前端送來的自由文字。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: householdId } = await params;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "請求格式錯誤" }, { status: 400 });
    }

    const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "updateProfile");
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

    // ---- 建立前疑似重複比對（V12.2 最後一個缺口）----
    //
    // 這條「家戶詳情頁 →新增家人」流程原本完全沒有比對，等於可以繞過 V12.2
    // 的重複保護。現在跟 POST /api/devotee-center/create 走**完全相同**的三條
    // 規則與同一份實作（findDuplicatesForExistingHousehold → 既有的
    // findPreCreateDuplicates → 既有的 findDuplicateMatches），沒有第二套演算法。
    //
    // ⚠️ 嚴格布林：只有 `=== true` 才算已確認。字串 "false"／"0"／任何非空
    // 字串在 JS 都是 truthy，用 `!body.confirmedDuplicates` 會被整個跳過。
    const hasConfirmedDuplicates = body.confirmedDuplicates === true;

    if (!hasConfirmedDuplicates) {
      // 先做欄位正規化（含生日解析），比對要用正規化後的值才會跟既有資料
      // 的 birthdayKey 對得起來。這一步不會寫入任何資料。
      const normalized = normalizeCreateMemberInput(body);
      const duplicates = await findDuplicatesForExistingHousehold(householdId, normalized);

      if (duplicates.length > 0) {
        // 命中且未確認：立即 return，下方的 createMemberForHousehold() 完全
        // 不會執行——沒有建立成員、沒有修改家戶、沒有任何資料庫寫入。
        return NextResponse.json(
          {
            success: false,
            needsDuplicateConfirmation: true,
            duplicates,
            error: "偵測到疑似重複的信眾，請確認後再決定是否繼續建立",
          },
          { status: 409 }
        );
      }
    }

    const { member } = await createMemberForHousehold(
      householdId,
      body,
      check.operator.name,
      "家戶管理：新增家人"
    );

    revalidatePath(`/household/${householdId}`);

    return NextResponse.json({ success: true, data: { member } }, { status: 201 });
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ success: false, error }, { status });
  }
}
