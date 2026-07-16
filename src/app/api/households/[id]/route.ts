import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getHouseholdDetail } from "@/lib/household";
import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";

/**
 * 家戶資料 API
 *
 * GET /api/households/F00009
 *
 * 回傳家戶基本資料、成員（含換算後的國曆/農曆生日、生肖、虛歲）、
 * 祭祀資料、歷史活動紀錄、備註。
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const household = await getHouseholdDetail(id);

  if (!household) {
    return NextResponse.json({ error: "找不到這個家戶" }, { status: 404 });
  }

  return NextResponse.json(household);
}

/**
 * 修改家戶資料 API（只能改地址／電話／主要聯絡人／公司名稱／備註，
 * 家戶編號與家戶名稱不開放從這裡修改）
 *
 * PATCH /api/households/F00009
 * body: { contactName?, phone?, address?, companyName?, notes?, operatorName? }
 *
 * V8.0「資料版本紀錄」：修改前後的完整快照會寫入一筆 RecordVersion。
 * operatorName 是選填的自由文字（系統目前沒有登入功能，見
 * src/lib/recordVersion.ts 開頭的說明），畫面上可以留空。
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const existing = await prisma.household.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ error: "找不到這個家戶" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const toNullableString = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed ? trimmed : null;
  };

  const data: Record<string, string | null> = {};
  if ("contactName" in body) data.contactName = toNullableString(body.contactName);
  if ("phone" in body) data.phone = toNullableString(body.phone);
  if ("address" in body) data.address = toNullableString(body.address);
  if ("companyName" in body) data.companyName = toNullableString(body.companyName);
  if ("notes" in body) data.notes = toNullableString(body.notes);

  const operatorName = toNullableString(body.operatorName);

  const household = await prisma.$transaction(async (tx) => {
    const updated = await tx.household.update({ where: { id }, data });

    await recordVersion(
      {
        entityType: "Household",
        entityId: id,
        action: "UPDATE",
        beforeData: existing,
        afterData: updated,
        operatorName,
      },
      tx
    );

    return updated;
  });

  revalidatePath(`/household/${id}`);

  return NextResponse.json({ household });
}
