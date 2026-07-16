import { NextResponse } from "next/server";
import { seedOfficialTemplates } from "@/lib/templates";

/**
 * 預先建立官方模板分類資料（需求「六、七」）。可以安全地重複呼叫
 * （upsert，不會產生重複資料，也不會動到已經上傳的版本）。
 *
 * POST /api/templates/seed
 */
export async function POST() {
  const result = await seedOfficialTemplates();
  return NextResponse.json(result);
}
