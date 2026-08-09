import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertActivityPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";

/**
 * 活動年度設定編輯（日期／開放開關）。建立活動後可隨時修改,不動報名資料。
 * GET   → 讀目前設定。
 * PATCH → 更新 registrationStartAt／registrationEndAt／isRegistrationOpen／isPrintOpen。
 * 權限：讀＝活動 view；改＝活動 manageSettings。
 * 日期以 yyyy-mm-dd 傳入(空字串/null＝清除該日期，代表「不以日期控管」)。
 */
export const dynamic = "force-dynamic";

function parseDate(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined; // 未提供 → 不更動
  if (v === null || v === "") return null; // 清除
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await assertActivityPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const { id } = await params;
  const ev = await prisma.templeEvent.findUnique({
    where: { id },
    select: { id: true, name: true, year: true, registrationStartAt: true, registrationEndAt: true, isRegistrationOpen: true, isPrintOpen: true },
  });
  if (!ev) return NextResponse.json({ error: "找不到這個活動" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    name: ev.name,
    year: ev.year,
    registrationStartAt: ev.registrationStartAt ? ev.registrationStartAt.toISOString().slice(0, 10) : null,
    registrationEndAt: ev.registrationEndAt ? ev.registrationEndAt.toISOString().slice(0, 10) : null,
    isRegistrationOpen: ev.isRegistrationOpen,
    isPrintOpen: ev.isPrintOpen,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await assertActivityPermissionForOperator(await readOperatorUserId(request), "manageSettings");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await readJsonBody(request);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  const b = body as Record<string, unknown>;

  const data: {
    registrationStartAt?: Date | null;
    registrationEndAt?: Date | null;
    isRegistrationOpen?: boolean;
    isPrintOpen?: boolean;
  } = {};
  const start = parseDate(b.registrationStartAt);
  const end = parseDate(b.registrationEndAt);
  if (start !== undefined) data.registrationStartAt = start;
  if (end !== undefined) data.registrationEndAt = end;
  if ("isRegistrationOpen" in b) data.isRegistrationOpen = Boolean(b.isRegistrationOpen);
  if ("isPrintOpen" in b) data.isPrintOpen = Boolean(b.isPrintOpen);

  const { id } = await params;
  const ev = await prisma.templeEvent.findUnique({ where: { id }, select: { id: true } });
  if (!ev) return NextResponse.json({ error: "找不到這個活動" }, { status: 404 });

  await prisma.templeEvent.update({ where: { id }, data });
  return NextResponse.json({ ok: true, message: "已更新活動設定（不影響任何已建立的報名資料）。" });
}
