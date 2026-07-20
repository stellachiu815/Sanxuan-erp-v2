import { NextResponse } from "next/server";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { createAncestorLine } from "@/lib/soulTabletFlow";
import { findWorshipDuplicates, getYangshangSuggestions } from "@/lib/worshipRecordCreate";
import { prisma } from "@/lib/prisma";

/**
 * V13.1 指令六／七：牌位建立（歷代祖先）與建立前的預覽資料。
 *
 * GET  /api/worship-records?householdId=F00009&operatorUserId=xxx
 *        → 陽上人快速帶入選項、家戶地址、既有牌位（供重複提示）
 * POST /api/worship-records
 *        → 建立歷代祖先牌位
 *
 * ⚠️ 乙位正魂**不從這裡建立**——它有自己的辭世流程與硬性重複阻擋，
 * 走 /api/devotee-center/[memberId]/soul-tablet。刻意分開，避免
 * 「乙位正魂可以被繞過重複檢查建立」。
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const householdId = searchParams.get("householdId");
  const operatorUserId = searchParams.get("operatorUserId");

  const check = await assertDevoteePermissionForOperator(operatorUserId, "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  if (!householdId) {
    return NextResponse.json({ error: "請指定家戶" }, { status: 400 });
  }

  const household = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
    select: { id: true, name: true, address: true },
  });
  if (!household) {
    return NextResponse.json({ error: "找不到這個家戶" }, { status: 404 });
  }

  const [suggestions, existing] = await Promise.all([
    getYangshangSuggestions(householdId),
    prisma.worshipRecord.findMany({
      where: { householdId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        displayName: true,
        location: true,
        yangshangName: true,
        createdAt: true,
        createdByName: true,
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    household,
    /** 陽上人快速帶入。⚠️ 只是快捷，使用者可自由輸入清單外的姓名 */
    yangshangSuggestions: suggestions,
    /** 家戶地址，供「帶入家戶地址」按鈕使用（不強制） */
    householdAddress: household.address,
    existing,
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "資料格式錯誤" }, { status: 400 });
  }

  const check = await assertDevoteePermissionForOperator(body.operatorUserId, "updateProfile");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const householdId = typeof body.householdId === "string" ? body.householdId : "";
  const displayName = typeof body.displayName === "string" ? body.displayName : "";

  if (!householdId) return NextResponse.json({ error: "請指定家戶" }, { status: 400 });

  // 重複檢查（指令十四）。只提醒不阻擋——除非前端明確送 confirmedDuplicate。
  const duplicates = await findWorshipDuplicates({
    householdId,
    type: "ANCESTOR_LINE",
    displayName,
  });

  // ⚠️ 必須用 === true 嚴格比較：JSON 傳來的字串 "false" 是 truthy，
  // 用 `!body.confirmedDuplicate` 會讓檢查整個被跳過。
  if (duplicates.length > 0 && body.confirmedDuplicate !== true) {
    return NextResponse.json(
      {
        ok: false,
        needsDuplicateConfirmation: true,
        duplicates,
        message: "這一戶已有相似的歷代祖先牌位，請確認是否仍要新增",
      },
      { status: 409 }
    );
  }

  const result = await createAncestorLine({
    householdId,
    displayName,
    location: typeof body.location === "string" ? body.location : null,
    yangshangName: typeof body.yangshangName === "string" ? body.yangshangName : null,
    notes: typeof body.notes === "string" ? body.notes : null,
    operatorName: check.operator.name,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    worshipRecordId: result.worshipRecordId,
    /** 例如「牌位地址尚未填寫，將標示為待補資料」——提醒，不是錯誤 */
    warnings: result.warnings,
  });
}
