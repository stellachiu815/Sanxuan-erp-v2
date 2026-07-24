import { NextResponse } from "next/server";
import { seedOfficialTemplates } from "@/lib/templates";
import { assertTemplatePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * 預先建立官方模板分類資料（需求「六、七」）。可以安全地重複呼叫
 * （upsert，不會產生重複資料，也不會動到已經上傳的版本）。
 *
 * POST /api/templates/seed —— V14.3：seed 屬高風險，僅 SUPER_ADMIN。
 */
export async function POST(request: Request) {
  const __op = await assertTemplatePermissionForOperator(await readOperatorUserId(request), "seed");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });
  const result = await seedOfficialTemplates();
  return NextResponse.json(result);
}
