import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { registerPurificationEntrant, type RegisterPurificationEntrantInput } from "@/lib/purification";

/**
 * 祭改報名。
 *
 * POST /api/purification/years/xxx/registrations
 * body: {
 *   "memberId": "M00001",           // 一般報名：從信眾主資料選人
 *   // 或者：
 *   "isTemporaryName": true,        // 臨時報名（尚未建立信眾主資料）
 *   "manualDisplayName": "王小明",
 *   "manualGender": "男",
 *   "manualSolarBirthDate": "1975-07-07",
 *   "manualAddress": "台北市士林區...",
 *   "manualPhone": "0912345678",
 *
 *   "householdId": "F00009",        // 必填（V8.1 起）：這位報名者掛在哪一戶
 *                                    // 的當年度祭改主檔底下；一般報名選信眾
 *                                    // 時前端會自動帶出，臨時報名需另外搜尋選擇
 *   "paymentStatus": "PAID",        // 選填，預設 UNPAID
 *   "paymentAmount": 300,           // 選填
 *   "notes": "備註",                 // 選填
 *   "operatorName": "操作人姓名"
 * }
 *
 * 編號由系統自動編列（需求「六」），不接受呼叫端指定編號。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ yearId: string }> }
) {
  const { yearId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const toNullableString = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed ? trimmed : null;
  };
  const toDate = (v: unknown): Date | null => {
    if (typeof v !== "string" || !v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const toNullableInt = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
  };
  const toNullableAmount = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const input: RegisterPurificationEntrantInput = {
    memberId: toNullableString(body.memberId),
    householdId: toNullableString(body.householdId),
    isTemporaryName: Boolean(body.isTemporaryName),
    manualDisplayName: toNullableString(body.manualDisplayName),
    manualGender: toNullableString(body.manualGender),
    manualSolarBirthDate: toDate(body.manualSolarBirthDate),
    manualLunarBirthYear: toNullableInt(body.manualLunarBirthYear),
    manualLunarBirthMonth: toNullableInt(body.manualLunarBirthMonth),
    manualLunarBirthDay: toNullableInt(body.manualLunarBirthDay),
    manualLunarIsLeapMonth: Boolean(body.manualLunarIsLeapMonth),
    manualAddress: toNullableString(body.manualAddress),
    manualPhone: toNullableString(body.manualPhone),
    paymentStatus: body.paymentStatus === "PAID" || body.paymentStatus === "PARTIAL" ? body.paymentStatus : "UNPAID",
    paymentAmount: toNullableAmount(body.paymentAmount),
    notes: toNullableString(body.notes),
  };

  const operatorName = toNullableString(body.operatorName);

  const result = await registerPurificationEntrant(yearId, input, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/purification/${yearId}`);

  return NextResponse.json({ id: result.data.id, number: result.data.number }, { status: 201 });
}
