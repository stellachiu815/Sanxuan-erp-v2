import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { addBannedNumber, listBannedNumbers } from "@/lib/purification";
import { assertPurificationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * 禁用編號清單：查詢／新增。
 *
 * GET  /api/purification/banned-numbers
 * POST /api/purification/banned-numbers
 *   body: { "number": 250, "reason": "備註", "operatorName": "操作人姓名" }
 *
 * 系統預設就會擋下所有「包含連續 44」的號碼（44/144/244/344/440-449/1440
 * 等等），那條規則是寫死在 src/lib/purificationNumbering.ts 裡的程式邏輯，
 * 不會出現在這張表——這裡管理的是「額外」禁用的號碼（需求「六」：
 * 「管理者未來可新增其他禁用號碼」）。
 *
 * ⚠️ 需求「六」要求「一般工作人員不可修改」這張表。跟這個專案其他
 * SUPER_ADMIN 限定的動作（例如回收區還原/永久刪除，見
 * src/app/api/recycle-bin/restore/route.ts 的說明）採用同樣的處理方式：
 * 系統目前沒有登入/session 機制（src/lib/permissions.ts 的
 * getCurrentUser() 永遠回傳 null），後端暫時真的無法驗證操作者身份，
 * 所以這裡「還不能」在後端擋下一般工作人員——這是已經記錄在案的已知風險，
 * 等登入機制做出來之後，必須在這支 API 補上
 * assertPurificationPermission(user.role, "manageBannedNumbers") 的真正檢查
 * （規則定義已經寫在 src/lib/permissions.ts，屆時直接接上即可）。目前只能
 * 靠前端把「禁用編號設定」畫面隱藏成只有管理者身分才看得到的入口。
 */
export async function GET() {
  const bannedNumbers = await listBannedNumbers();
  return NextResponse.json({ bannedNumbers });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const number = Number(body.number);
  if (!Number.isInteger(number) || number < 0) {
    return NextResponse.json({ error: "請提供正確的禁用號碼（number）" }, { status: 400 });
  }

  // V14.3：登入系統上線後補上原本待辦的後端檢查。管理禁用編號屬
  // manageBannedNumbers（僅 SUPER_ADMIN／ADMIN），操作人取自登入 session。
  const __op = await assertPurificationPermissionForOperator(await readOperatorUserId(request), "manageBannedNumbers");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });

  const reason = typeof body.reason === "string" ? body.reason : null;
  const operatorName = __op.operator.name;

  const result = await addBannedNumber(number, reason, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath("/purification/settings/banned-numbers");

  return NextResponse.json({ id: result.data.id }, { status: 201 });
}
