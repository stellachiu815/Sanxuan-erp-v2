import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getHouseholdDetail } from "@/lib/household";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { updateHouseholdBasic, toHouseholdApiError } from "@/lib/householdManagement";

/**
 * 家戶資料 API
 *
 * GET /api/households/F00009
 *
 * 回傳家戶基本資料、成員（含換算後的國曆/農曆生日、生肖、虛歲）、
 * 祭祀資料、歷史活動紀錄、備註。
 *
 * V12.1 一次性修正指令「二之5」：這支家戶詳情 API 原本直接回傳裸物件
 * （成功時是 household 本身、失敗時是 { error }），跟同一個模組其餘所有
 * 家戶 API（POST /api/households、archive、head、merge、split、transfer…）
 * 使用的 { success, data } / { success, error } 信封格式不一致，前端因此
 * 要為這一支寫特例。這次統一成既有多數派的信封格式，沒有新增第二個
 * endpoint，也沒有改變 getHouseholdDetail() 回傳的資料內容本身——只是
 * 外層包裝一致化。使用端（src/components/household/HouseholdActionsMenu.tsx）
 * 已同步修改。
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const household = await getHouseholdDetail(id);

  if (!household) {
    return NextResponse.json({ success: false, error: "找不到這個家戶" }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: household });
}

/**
 * 修改家戶資料 API。
 *
 * PATCH /api/households/F00009
 * body: { operatorUserId, householdCode?, householdName?, contactName?, phone?, mobile?, address?, companyName?, notes? }
 *
 * V12.1「家戶管理中心」擴充（對應指令「一/三/九」）：
 * 1. 這裡原本只能改地址／電話／主要聯絡人／公司名稱／備註，這次擴充成
 *    也能修改家戶編號（householdCode）與戶名（householdName）——核心
 *    邏輯（含家戶編號唯一性檢查、版本紀錄）統一交給
 *    src/lib/householdManagement.ts 的 updateHouseholdBasic()，避免這裡
 *    跟新的家戶管理中心各自維護一份重複的驗證邏輯。
 * 2. 這裡原本完全沒有權限檢查（既有缺口），這次補上
 *    assertDevoteePermissionForOperator(..., "updateProfile")——跟信眾
 *    資料中心「修改信眾資料」共用同一個權限動作，對應這次指令「四、
 *    權限規則」的 SUPER_ADMIN／ADMIN／STAFF 可修改、READONLY 不可修改。
 * 3. operatorName 這個舊參數已被 operatorUserId 取代（伺服器端查真實
 *    操作人員姓名，不再信任前端直接送來的自由文字姓名）；為了不影響
 *    既有呼叫端行為，若請求沒有帶 operatorUserId，仍會回傳 401，等同
 *    「尚未登入」，這是刻意的收緊（既有這支 API 完全沒有權限檢查是一個
 *    安全缺口，這次順帶補上，不是「順便修改其他模組」，而是這次指令
 *    「四、權限規則」明確要求 API 也必須檢查）。
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "請求格式錯誤" }, { status: 400 });
    }

    const check = await assertDevoteePermissionForOperator(body.operatorUserId, "updateProfile");
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

    // V12.3 指令四：一般欄位（戶名／聯絡人／電話／地址…）維持 updateProfile，
    // 但「修改家戶編號」會連動所有關聯表的主鍵，屬於結構性變更，需要額外的
    // changeHouseholdCode 權限（STAFF 沒有）。只有這次請求真的要換編號時才檢查，
    // 一般編輯不受影響。
    const wantsCodeChange =
      typeof body.householdCode === "string" && body.householdCode.trim() && body.householdCode.trim() !== id;
    if (wantsCodeChange) {
      const codeCheck = await assertDevoteePermissionForOperator(body.operatorUserId, "changeHouseholdCode");
      if (!codeCheck.ok) {
        return NextResponse.json({ success: false, error: codeCheck.error }, { status: codeCheck.status });
      }
    }

    const { household } = await updateHouseholdBasic(
      id,
      {
        id: typeof body.householdCode === "string" ? body.householdCode : undefined,
        name: typeof body.householdName === "string" ? body.householdName : undefined,
        contactName: "contactName" in body ? body.contactName : undefined,
        phone: "phone" in body ? body.phone : undefined,
        mobile: "mobile" in body ? body.mobile : undefined,
        address: "address" in body ? body.address : undefined,
        companyName: "companyName" in body ? body.companyName : undefined,
        notes: "notes" in body ? body.notes : undefined,
      },
      check.operator.name,
      // V12.3 指令八：異動紀錄要能追到帳號。
      check.operator.id
    );

    revalidatePath(`/household/${household.id}`);
    if (household.id !== id) revalidatePath(`/household/${id}`);

    // V12.1 一次性修正指令「二之5」：統一成 { success, data } 信封，
    // 跟同模組其餘家戶 API 一致（原本是 { household, success }）。
    return NextResponse.json({ success: true, data: { household } });
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ success: false, error }, { status });
  }
}
