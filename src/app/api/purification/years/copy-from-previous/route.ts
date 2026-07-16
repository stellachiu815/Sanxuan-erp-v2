import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { copyPurificationYearFromPrevious } from "@/lib/purification";

/**
 * 「沿用去年祭改資料」API（需求「十四」）。
 *
 * POST /api/purification/years/copy-from-previous
 * body: {
 *   "newYear": 115,          // 必填：要建立的新年度
 *   "sourceYearId": "xxx",   // 必填：來源年度的 id（不一定是 newYear - 1，
 *                            //        由使用者在畫面上選擇來源年度）
 *   "operatorName": "操作人姓名"
 * }
 *
 * 只複製來源年度「仍然有效」（ACTIVE／SUPPLEMENTARY）的報名者的參加者/
 * 個人地址/備註/家戶關係；不沿用歲數/編號/收款狀態/列印紀錄——這些在
 * 新年度會被重設或重新計算（見 src/lib/purification.ts 的詳細說明）。
 *
 * 回傳 diffs：新增/去年已取消（不會複製過來）/地址或生日可能異動（信眾
 * 主資料在去年報名之後有被修改過，請人工核對）/性別資料待確認。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const newYear = Number(body.newYear);
  if (!Number.isInteger(newYear) || newYear < 1) {
    return NextResponse.json({ error: "請提供正確的新年度（newYear）" }, { status: 400 });
  }

  const sourceYearId = typeof body.sourceYearId === "string" ? body.sourceYearId : "";
  if (!sourceYearId) {
    return NextResponse.json({ error: "請提供來源年度（sourceYearId）" }, { status: 400 });
  }

  const operatorName = typeof body.operatorName === "string" ? body.operatorName : null;

  const result = await copyPurificationYearFromPrevious(newYear, sourceYearId, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath("/purification");

  return NextResponse.json(
    { id: result.data.id, diffs: result.data.diffs },
    { status: 201 }
  );
}
