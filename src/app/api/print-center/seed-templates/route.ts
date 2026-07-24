import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { ensurePrintTemplatesSeeded } from "@/lib/printTemplates";
import { ensureRegistrationItemTypesSeeded } from "@/lib/registrationItems";

/**
 * V14：冪等建立報名項目與列印模板種子（管理端手動觸發）。
 * POST /api/print-center/seed-templates?operatorUserId=xxx
 *
 * 冪等：已存在者略過，不覆蓋既有資料。權限：register。
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request),
    "register"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const items = await ensureRegistrationItemTypesSeeded();
  const templates = await ensurePrintTemplatesSeeded();
  return NextResponse.json({ ok: true, items, templates });
}
