import { NextRequest, NextResponse } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import {
  getAllTabletTemplateSettings,
  saveTabletTemplateSetting,
  resetTabletTemplateSetting,
  type TabletTemplateDocType,
} from "@/lib/tabletTemplateSettings";

/**
 * V32 §4 列印模板管理 API。
 * GET  → { settings: TabletTemplateSetting[] }（缺列回系統預設）
 * POST body: { documentType, action?: "save"|"reset", ...settingFields }
 *   - save（預設）：upsert；先夾安全範圍、檢查 Safe Area，成功回新設定。
 *   - reset：恢復系統預設（刪除該列）。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const settings = await getAllTabletTemplateSettings();
  return NextResponse.json({ ok: true, settings });
}

export async function POST(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "register");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await readJsonBody(request);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });

  const documentType = typeof body.documentType === "string" ? (body.documentType as TabletTemplateDocType) : null;
  if (!documentType) return NextResponse.json({ error: "缺少模板類型 documentType" }, { status: 400 });

  const action = body.action === "reset" ? "reset" : "save";
  const byName = check.operator.name;

  const result =
    action === "reset"
      ? await resetTabletTemplateSetting(documentType)
      : await saveTabletTemplateSetting(
          documentType,
          {
            density: body.density as "standard" | "economy" | undefined,
            offsetXmm: body.offsetXmm as number | undefined,
            offsetYmm: body.offsetYmm as number | undefined,
            fontFamily: body.fontFamily as string | undefined,
            fontWeight: body.fontWeight as string | undefined,
            letterSpacingPx: body.letterSpacingPx as number | undefined,
            lineHeight: body.lineHeight as number | undefined,
            defaultMainText: body.defaultMainText as string | undefined,
            showCalibrationBox: body.showCalibrationBox as boolean | undefined,
            showCropMarks: body.showCropMarks as boolean | undefined,
            showWorkNumber: body.showWorkNumber as boolean | undefined,
            maximize: body.maximize as boolean | undefined,
          },
          byName
        );

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, setting: result.setting });
}
