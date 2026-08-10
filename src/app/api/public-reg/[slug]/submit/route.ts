import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { submitPublicRegistration, submitPublicRosterRegistration, submitPublicLanternRegistration, type PublicPayload, type PublicRosterPayload, type PublicLanternPayload } from "@/lib/publicReg";

/**
 * 信眾公開報名送出（**免登入**）。POST /api/public-reg/[slug]/submit
 * 只寫入「待確認（PENDING）」，不建正式資料。含必填檢查＋簡易防重複（同 IP+姓名 30 秒內擋）。
 * 依 body.kind 分流：普渡（預設）走 submitPublicRegistration；名單型（"ROSTER"，補庫/宮燈）走 roster 版。
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "資料格式錯誤" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";

  // 名單型（補庫/宮燈）與年度燈（光明/太歲燈）公開報名——都用 people[0].name 做防重複雜湊。
  if (b.kind === "ROSTER" || b.kind === "LANTERN") {
    const firstName = Array.isArray(b.people) && b.people.length > 0 && typeof (b.people[0] as { name?: unknown })?.name === "string"
      ? (b.people[0] as { name: string }).name
      : "";
    const submitterHash = createHash("sha256").update(`${ip}|${firstName}`).digest("hex").slice(0, 32);
    const res = b.kind === "LANTERN"
      ? await submitPublicLanternRegistration(slug, body as PublicLanternPayload, submitterHash)
      : await submitPublicRosterRegistration(slug, body as PublicRosterPayload, submitterHash);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ ok: true, id: res.id }, { status: 201 });
  }

  // 普渡公開報名（既有）。
  const name = typeof (b as { registrant?: { name?: unknown } }).registrant?.name === "string" ? (b as { registrant: { name: string } }).registrant.name : "";
  const submitterHash = createHash("sha256").update(`${ip}|${name}`).digest("hex").slice(0, 32);
  const res = await submitPublicRegistration(slug, body as PublicPayload, submitterHash);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, id: res.id }, { status: 201 });
}
