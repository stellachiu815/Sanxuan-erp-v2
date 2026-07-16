import { NextResponse } from "next/server";
import { listRecycleBin } from "@/lib/recycleBin";

/**
 * 回收區完整清單（V8.0「刪除保護」）。
 *
 * GET /api/recycle-bin
 */
export async function GET() {
  const items = await listRecycleBin();
  return NextResponse.json({ items });
}
