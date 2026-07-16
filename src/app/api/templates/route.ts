import { NextRequest, NextResponse } from "next/server";
import { TemplateCategory } from "@prisma/client";
import { listTemplates } from "@/lib/templates";

/**
 * 台北三玄宮模板中心：模板清單（需求「五」六大分類）。
 *
 * GET /api/templates?category=PRINT（category 選填，不帶就回傳全部分類）
 */
export async function GET(request: NextRequest) {
  const categoryParam = request.nextUrl.searchParams.get("category");
  const category =
    categoryParam && (Object.values(TemplateCategory) as string[]).includes(categoryParam)
      ? (categoryParam as TemplateCategory)
      : undefined;
  const templates = await listTemplates(category);
  return NextResponse.json({ templates });
}
