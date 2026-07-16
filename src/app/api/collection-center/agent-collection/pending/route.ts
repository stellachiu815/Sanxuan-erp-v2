import { NextRequest, NextResponse } from "next/server";
import { getAgentPendingSummary, listAgentPendingTransactions } from "@/lib/collectionCenter";

/**
 * GET /api/collection-center/agent-collection/pending
 *   query: ?agentName=xxx（帶了就回傳該代收人明細，沒帶回傳依代收人分組的彙總）
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const agentName = searchParams.get("agentName");
  if (agentName) {
    const rows = await listAgentPendingTransactions(agentName);
    return NextResponse.json({ rows });
  }
  const summary = await getAgentPendingSummary();
  return NextResponse.json({ summary });
}
