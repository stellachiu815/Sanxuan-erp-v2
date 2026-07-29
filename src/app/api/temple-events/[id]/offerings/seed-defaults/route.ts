import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { seedDefaultActivityOfferings } from "@/lib/activityOfferings";
import { assertActivityPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * V26.1「供品活動模板」：舊活動「建立預設供品」一次補齊按鈕。
 *
 * POST /api/temple-events/xxx/offerings/seed-defaults
 *   依活動類型的預設供品模板補上缺少的預設供品。已存在的供品一律略過
 *   （不重複建立、不影響既有供品/認捐/收款）。回傳
 *   { createdCount, skippedCount, missingOfferingNames }。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await prisma.templeEvent.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "找不到這個活動" }, { status: 404 });

  const __op = await assertActivityPermissionForOperator(await readOperatorUserId(request), "manageSettings");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });

  const result = await seedDefaultActivityOfferings(id, event.activityType, __op.operator.name);

  revalidatePath(`/offering-center/activity/${id}`);
  revalidatePath("/offering-center");
  return NextResponse.json(result);
}
