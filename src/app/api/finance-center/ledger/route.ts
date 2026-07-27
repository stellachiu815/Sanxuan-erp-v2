import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertFinancePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { listLedger } from "@/lib/financeCenter";
import type { FinanceAccountT, FinanceEntryKindT } from "@/lib/financePrisma";

/** V22 流水帳查詢（union：FinanceRecord + 活動收款）。 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const check = await assertFinancePermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const u = request.nextUrl.searchParams;
  const entries = await listLedger({
    from: u.get("from") || undefined,
    to: u.get("to") || undefined,
    year: u.get("year") ? Number(u.get("year")) : undefined,
    account: (u.get("account") as FinanceAccountT) || undefined,
    entryKind: (u.get("entryKind") as FinanceEntryKindT) || undefined,
    templeEventId: u.get("templeEventId") || undefined,
    includeVoid: u.get("includeVoid") === "1",
  });
  return NextResponse.json({ ok: true, entries });
}
