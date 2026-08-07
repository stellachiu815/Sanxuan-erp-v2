import { NextRequest, NextResponse } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import {
  listWorkOrderRows, listWorkOrderRowsForBatch, saveWorkOrders, proposeInitialFromRegistrationOrder,
  isWorkOrderLocked, setWorkOrderLock, templeEventIdForYear, itemTypeIdForKey,
  type WorkOrderBatchKey,
} from "@/lib/workOrderRepo";

const BATCH_KEYS = ["ancestor-soul", "creditor"] as const;
const isBatch = (v: string): v is WorkOrderBatchKey => (BATCH_KEYS as readonly string[]).includes(v);

/**
 * V32 正式作業編號 workOrder 管理 API。
 * GET  /api/universal-salvation/[year]/work-orders?itemKey=US_ANCESTOR → { rows, locked }
 * POST body: { itemKey, updates:[{id,workOrder|null}], lock?:boolean }
 *   - 儲存 workOrder（transaction、重號整批 rollback）。
 *   - lock=true/false → 設定/解除鎖定。鎖定中且送出 updates → 擋（需先解除）。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ year: string }> }) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const { year: yp } = await params;
  const year = Number(yp);
  const batch = request.nextUrl.searchParams.get("batch") ?? "";
  const itemKey = request.nextUrl.searchParams.get("itemKey") ?? "";
  if (!Number.isInteger(year)) return NextResponse.json({ error: "缺少年度" }, { status: 400 });

  // V38：批次模式（祖先組／冤親組）——整批一起編號；暫不套用「鎖定」（鎖定仍走既有單項目模式）。
  if (batch) {
    if (!isBatch(batch)) return NextResponse.json({ error: "批次不正確" }, { status: 400 });
    const rows = await listWorkOrderRowsForBatch(year, batch);
    return NextResponse.json({ ok: true, rows, locked: false });
  }
  if (!itemKey) return NextResponse.json({ error: "缺少項目" }, { status: 400 });

  const rows = await listWorkOrderRows(year, itemKey);
  const ev = await templeEventIdForYear(year);
  const typeId = await itemTypeIdForKey(itemKey);
  const locked = ev && typeId ? await isWorkOrderLocked(ev, typeId) : false;
  return NextResponse.json({ ok: true, rows, locked });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ year: string }> }) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "register");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const { year: yp } = await params;
  const year = Number(yp);
  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  const batch = typeof body.batch === "string" ? body.batch : "";
  const itemKey = typeof body.itemKey === "string" ? body.itemKey : "";
  if (!Number.isInteger(year)) return NextResponse.json({ error: "缺少年度" }, { status: 400 });

  // V38：批次模式儲存——updates 逐筆存 workOrder（同項目唯一性照樣檢查；整批號碼全域唯一故通過）。
  if (batch) {
    if (!isBatch(batch)) return NextResponse.json({ error: "批次不正確" }, { status: 400 });
    const updates = Array.isArray(body.updates)
      ? body.updates.filter((u: unknown): u is { id: string; workOrder: number | null } => !!u && typeof (u as { id?: unknown }).id === "string")
      : [];
    if (updates.length > 0) {
      const res = await saveWorkOrders(updates);
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    }
    const rows = await listWorkOrderRowsForBatch(year, batch);
    return NextResponse.json({ ok: true, rows, locked: false });
  }

  if (!itemKey) return NextResponse.json({ error: "缺少項目" }, { status: 400 });
  const ev = await templeEventIdForYear(year);
  const typeId = await itemTypeIdForKey(itemKey);
  const locked = ev && typeId ? await isWorkOrderLocked(ev, typeId) : false;

  const updates = Array.isArray(body.updates)
    ? body.updates.filter((u: unknown): u is { id: string; workOrder: number | null } => !!u && typeof (u as { id?: unknown }).id === "string")
    : [];

  // 鎖定切換（可與儲存分開；解除鎖定需明確 lock=false）。
  if (typeof body.lock === "boolean" && ev && typeId) {
    const r = await setWorkOrderLock(ev, typeId, body.lock, check.operator.name);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  }

  if (updates.length > 0) {
    if (locked && body.lock !== false) {
      return NextResponse.json({ error: "此項目正式作業編號已鎖定，請先解除鎖定再修改。" }, { status: 409 });
    }
    const res = await saveWorkOrders(updates);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  }

  // 回傳最新列表（UI 立即刷新用）。
  const rows = await listWorkOrderRows(year, itemKey);
  const nowLocked = ev && typeId ? await isWorkOrderLocked(ev, typeId) : false;
  return NextResponse.json({ ok: true, rows, locked: nowLocked });
}

// 依 registrationOrder 產生初始號碼（預覽用；回傳建議 updates，不自動寫入）。
export async function PUT(request: NextRequest, { params }: { params: Promise<{ year: string }> }) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const { year: yp } = await params;
  const year = Number(yp);
  const itemKey = request.nextUrl.searchParams.get("itemKey") ?? "";
  if (!Number.isInteger(year) || !itemKey) return NextResponse.json({ error: "缺少年度或項目" }, { status: 400 });
  const proposed = await proposeInitialFromRegistrationOrder(year, itemKey);
  return NextResponse.json({ ok: true, proposed });
}
