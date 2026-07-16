import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getReceiptNumberingConfig, updateReceiptNumberingConfig, previewNextReceiptNumber } from "@/lib/receipt";
import { previewReceiptNumberFormat } from "@/lib/receiptRules";
import { assertReceiptPermissionForOperator } from "@/lib/operator";

/**
 * GET /api/receipt-center/numbering-config?operatorUserId=xxx
 * 需求「七」設定畫面用：目前規則＋預覽格式＋下一張實際號碼。
 * V11.1.1 新增：查看設定本身視為「管理收據設定」的一部分，需要
 * operatorUserId 並通過「view」權限檢查（一般工作人員也能看，
 * 但只有 SUPER_ADMIN 能實際送出下方 PUT 修改）。
 */
export async function GET(request: NextRequest) {
  const check = await assertReceiptPermissionForOperator(
    request.nextUrl.searchParams.get("operatorUserId"),
    "view"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const config = await getReceiptNumberingConfig();
  const preview = previewReceiptNumberFormat(config, new Date());
  const nextNumber = await previewNextReceiptNumber();
  return NextResponse.json({ config, preview, nextNumber });
}

/**
 * PUT /api/receipt-center/numbering-config
 *   body: { prefix, yearMode, digits, resetPolicy, startNumber, operatorUserId }
 *
 * V11.1.1 新增（對應指令「二、只有最高管理員可以：修改收據號碼規則、修改
 * 起始號碼、重設流水號設定」）：operatorUserId 必填，實際權限驗證
 * （manageNumbering，目前僅 SUPER_ADMIN 擁有）在 updateReceiptNumberingConfig()
 * 內部真的查資料庫完成，不是只在畫面隱藏按鈕；未授權呼叫一律 401/403。
 */
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "請提供設定資料" }, { status: 400 });
  if (typeof body.operatorUserId !== "string" || !body.operatorUserId) {
    return NextResponse.json({ error: "請提供操作人員身分" }, { status: 400 });
  }
  const result = await updateReceiptNumberingConfig({
    prefix: body.prefix,
    yearMode: body.yearMode,
    digits: body.digits,
    resetPolicy: body.resetPolicy,
    startNumber: body.startNumber,
    operatorUserId: body.operatorUserId,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  revalidatePath("/receipt-center/settings");
  return NextResponse.json(result.data);
}
