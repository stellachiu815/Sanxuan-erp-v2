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
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const household = await getHouseholdDetail(id);

  if (!household) {
    return NextResponse.json({ error: "找不到這個家戶" }, { status: 404 });
  }

  return NextResponse.json(household);
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
      return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
    }

    const check = await assertDevoteePermissionForOperator(body.operatorUserId, "updateProfile");
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

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
      check.operator.name
    );

    revalidatePath(`/household/${household.id}`);
    if (household.id !== id) revalidatePath(`/household/${id}`);

    return NextResponse.json({ household, success: true });
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ error, success: false }, { status });
  }
}
