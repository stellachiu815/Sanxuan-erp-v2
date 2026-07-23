import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * 單一陽上人姓名正規化：trim。回空字串代表不建立。
 * （字庫只存單一姓名；多位以「、」分隔的來源由 splitNames 先拆開。）
 */
function normalizeOne(raw: string): string {
  return (raw ?? "").trim();
}

/** 把可能含「、」的來源字串拆成多個單一姓名（Excel 陽上姓名可能一格多位）。 */
function splitNames(raw: string): string[] {
  return (raw ?? "")
    .split(/[、,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * V14.2：家戶固定陽上人名單 service。
 *
 * 「本戶固定陽上人」＝每一戶自己的一份可重複使用的陽上人字庫（HouseholdYangshang）。
 * 來源：Excel 匯入的陽上姓名 ＋ 建牌位時人工新增並勾選「同時加入本戶固定名單」。
 *
 * 設計原則（對齊指令）：
 *   - 不建立第二套資料：牌位自己的陽上人仍存在各明細 yangshangNames；這裡只是字庫。
 *   - 同一位不重複：靠 @@unique([householdId, name]) + upsert 去重（trim 後比對）。
 *   - 純附加、可空、向下相容：舊家戶一律空名單，不影響既有流程。
 */

export type HouseholdYangshangSource = "IMPORT" | "MANUAL";

/** 讀本戶固定陽上人姓名清單（依建立順序；已 trim、去重由唯一鍵保證）。 */
export async function listHouseholdYangshang(householdId: string): Promise<string[]> {
  const rows = await prisma.householdYangshang.findMany({
    where: { householdId },
    orderBy: { createdAt: "asc" },
    select: { name: true },
  });
  return rows.map((r) => r.name);
}

/**
 * 新增一位本戶固定陽上人（去重）。回傳最新完整名單。
 * 名稱經 normalizeYangshangName 正規化；空字串直接略過（不報錯、不建立）。
 * 已存在同名（同戶）時 upsert 不會重複建立，也不覆寫既有 source。
 */
export async function addHouseholdYangshang(
  householdId: string,
  rawName: string,
  source: HouseholdYangshangSource = "MANUAL"
): Promise<{ ok: true; names: string[] } | { ok: false; status: number; error: string }> {
  const name = normalizeOne(rawName ?? "");
  if (!name) {
    // 空白不建立，但把現有名單回傳，讓前端狀態一致。
    return { ok: true, names: await listHouseholdYangshang(householdId) };
  }

  const household = await prisma.household.findUnique({
    where: { id: householdId },
    select: { id: true, deletedAt: true },
  });
  if (!household || household.deletedAt) {
    return { ok: false, status: 404, error: "找不到這一戶，或該戶已在回收區" };
  }

  await prisma.householdYangshang.upsert({
    where: { householdId_name: { householdId, name } },
    create: { householdId, name, source },
    update: {}, // 已存在＝維持原狀（含原 source），達成「同一位不重複建立」。
  });

  return { ok: true, names: await listHouseholdYangshang(householdId) };
}

/**
 * 批次加入本戶固定陽上人（供 Excel 匯入使用；一律 source=IMPORT）。
 * 可傳入交易 client（匯入 commit 在 $transaction 內呼叫，保持原子性）；
 * 每個名稱各自去重、含「、」的來源會拆成多位。已存在者維持原狀。
 */
export async function addHouseholdYangshangBatch(
  householdId: string,
  rawNames: string[],
  source: HouseholdYangshangSource = "IMPORT",
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  const seen = new Set<string>();
  for (const raw of rawNames) {
    for (const name of splitNames(raw ?? "")) {
      if (seen.has(name)) continue;
      seen.add(name);
      await client.householdYangshang.upsert({
        where: { householdId_name: { householdId, name } },
        create: { householdId, name, source },
        update: {},
      });
    }
  }
}
