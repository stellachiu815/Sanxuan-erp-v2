import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { submitPublicRegistration, type PublicPayload } from "@/lib/publicReg";

/**
 * V38 信眾公開報名送出（**免登入**）。POST /api/public-reg/[slug]/submit
 * 只寫入「待確認」，不建正式牌位。含必填檢查＋簡易防重複（同 IP+姓名 30 秒內擋）。
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "資料格式錯誤" }, { status: 400 });
  }

  // 簡易防灌水識別：IP ＋ 報名人姓名 的雜湊（不存明碼、不對外顯示）。
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const name = typeof (body as { registrant?: { name?: unknown } }).registrant?.name === "string" ? (body as { registrant: { name: string } }).registrant.name : "";
  const submitterHash = createHash("sha256").update(`${ip}|${name}`).digest("hex").slice(0, 32);

  const res = await submitPublicRegistration(slug, body as PublicPayload, submitterHash);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, id: res.id }, { status: 201 });
}
