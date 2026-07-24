import { NextRequest, NextResponse } from "next/server";
import { getActiveAccessToken, downloadFile } from "@/lib/googleDrive";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * GET /api/system-center/backup/download?operatorUserId=xxx&fileId=xxx&fileName=xxx
 * 需求「十、下載備份」：管理員可以把任何一份備份下載到自己的電腦
 * （方便另存 Mac／USB／外接硬碟／NAS）。
 *
 * 因為 Google Drive 的憑證只存在伺服器端（使用者的瀏覽器完全不知道這組
 * 憑證），下載一定要「經過伺服器代理轉手」——伺服器用自己的 access
 * token 向 Google Drive 要檔案內容，再原封不動回傳給瀏覽器，瀏覽器端
 * 不會、也不需要直接碰到 Google 的憑證。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request), "downloadBackup");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const fileId = searchParams.get("fileId");
  const fileName = searchParams.get("fileName") ?? "backup.zip";
  if (!fileId) return NextResponse.json({ error: "請提供 fileId" }, { status: 400 });

  try {
    const accessToken = await getActiveAccessToken();
    const buffer = await downloadFile(accessToken, fileId);
    // 修正：Node Buffer 的型別是 Buffer<ArrayBufferLike>，較新版 @types/node 底下
    // 跟 DOM lib 的 BodyInit（要求較嚴格的 ArrayBuffer，不接受 ArrayBufferLike／
    // SharedArrayBuffer）對不起來，會在 Render 的 Next.js Build 出現 TypeScript
    // 型別錯誤。用 `new Uint8Array(buffer)` 複製出一份型別乾淨的 Uint8Array<ArrayBuffer>
    // 再傳給 NextResponse，內容位元組完全相同，不影響任何下載行為與檔案內容。
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
        "Content-Length": String(buffer.byteLength),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "下載失敗" }, { status: 502 });
  }
}
