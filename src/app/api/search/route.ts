import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * 搜尋 API（V1.1）
 *
 * GET /api/search?q=王昆郎
 *
 * 支援搜尋：姓名、電話、地址、家戶編號、公司名稱（預留欄位）。
 *
 * 規則（依需求）：搜尋結果畫面「只顯示姓名 + 家戶編號」，不顯示地址、電話、
 * 公司名稱等其他資訊——不管是用哪個欄位搜尋到的，結果列表看起來都一樣。
 * 用電話/地址/家戶編號/公司名稱搜到的，用該戶的「主要聯絡人」姓名代表這一戶。
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (!q) {
    return NextResponse.json({ results: [] });
  }

  const [nameMatches, householdMatches] = await Promise.all([
    // V8.0「刪除保護」：移入回收區的成員/家戶不應該還能被搜尋到。
    prisma.member.findMany({
      where: { name: { contains: q }, deletedAt: null, household: { deletedAt: null } },
      select: { id: true, name: true, householdId: true },
      take: 20,
      orderBy: { name: "asc" },
    }),
    prisma.household.findMany({
      where: {
        deletedAt: null,
        OR: [
          { id: { contains: q } },
          { phone: { contains: q } },
          { address: { contains: q } },
          { companyName: { contains: q } },
        ],
      },
      select: { id: true, name: true, contactName: true },
      take: 20,
    }),
  ]);

  type Result = { memberId: string | null; name: string; householdId: string };

  const results: Result[] = [];
  const seen = new Set<string>();

  for (const m of nameMatches) {
    const key = `${m.householdId}::${m.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ memberId: m.id, name: m.name, householdId: m.householdId });
  }

  for (const h of householdMatches) {
    // 用電話/地址/家戶編號/公司名稱搜到的，沒有對應的「單一成員」，
    // 用主要聯絡人（沒有就用家戶名稱）當作這一列顯示的姓名。
    const displayName = h.contactName || h.name;
    const key = `${h.id}::${displayName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ memberId: null, name: displayName, householdId: h.id });
  }

  return NextResponse.json({ results: results.slice(0, 20) });
}
