import { NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { parseSpreadsheetBuffer, suggestColumnMapping, saveFieldMapping } from "@/lib/smartImport";
import { analyzeOfferingClaimImport, commitOfferingClaimImport } from "@/lib/offeringImport";
import { assertActivityPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * V10.1「供品認捐中心」需求「八」——第二步：確認匯入，真正寫入資料。
 * 只有 analyze 階段判定為 OK 的列會被寫入；ERROR／NEEDS_CONFIRMATION 的列
 * 一律略過，不會被直接匯入（需求「八」：找不到對應資料的列需要人工檢視）。
 *
 * POST /api/temple-events/xxx/offering-claims/import/commit （multipart/form-data）
 *   file: 跟 analyze 那一步同一個檔案（無狀態設計，比照既有慣例）
 *   mapping（JSON 字串）: 使用者確認/調整過的完整欄位對應
 *   operatorName（選填）
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const __op = await assertActivityPermissionForOperator(await readOperatorUserId(request), "import");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "請選擇要上傳的 Excel／CSV 檔案" }, { status: 400 });
  }

  const mappingRaw = formData?.get("mapping");
  let mapping: Record<string, string | null> = {};
  if (typeof mappingRaw === "string" && mappingRaw) {
    try {
      mapping = JSON.parse(mappingRaw);
    } catch {
      return NextResponse.json({ error: "欄位對應格式錯誤" }, { status: 400 });
    }
  }

  const operatorName = __op.operator.name;

  let columns: string[];
  let rows: Record<string, unknown>[];
  try {
    const buffer = Buffer.from(await (file as File).arrayBuffer());
    ({ columns, rows } = parseSpreadsheetBuffer(buffer));
  } catch (err) {
    console.error("供品認捐匯入：讀取檔案失敗", err);
    return NextResponse.json({ error: "無法讀取這個檔案，請確認是有效的 Excel/CSV 檔" }, { status: 400 });
  }

  for (const col of columns) {
    const target = mapping[col];
    if (target) await saveFieldMapping("OFFERING_CLAIM", col, target);
  }

  const suggested = await suggestColumnMapping("OFFERING_CLAIM", columns);
  const fullMapping = { ...suggested, ...mapping };

  const analyzedRows = await analyzeOfferingClaimImport(id, rows, fullMapping);
  const result = await commitOfferingClaimImport(analyzedRows, operatorName);

  return NextResponse.json(result);
}
