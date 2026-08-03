import { prisma } from "@/lib/prisma";
export { mergePrintMainText } from "@/lib/entryPrintMainTextPure";

/**
 * V32 §一 printMainText 重載回填：
 *
 * printMainText 是 V32 新增欄位，沙盒無法 `prisma generate`，且為了「不依賴
 * 隱式 scalar 帶出」的脆弱假設，這裡用 raw SQL 明確把每筆 entry 的 printMainText
 * 併回記錄物件。GET（頁面載入回填）與 entry PATCH（儲存後即時回填）都呼叫，
 * 確保信眾明細／編輯器欄位一律看到已保存的值；清空後為 null → 編輯器空白、
 * 正式列印回到系統預設主文。純資料合併不改分類/收款/registrationOrder。
 */

type RecordLike = {
  universalSalvation?: { entries?: { id: string }[] } | null;
} | null;

/**
 * 對一筆普渡記錄，raw SQL 讀取其所有 entry 的 printMainText 並就地併回。
 * record 為 null 或無 entries 時原樣回傳。永不丟例外阻斷主流程（欄位不存在時容錯）。
 */
export async function attachPrintMainTextToRecord<R extends RecordLike>(record: R): Promise<R> {
  const entries = record?.universalSalvation?.entries;
  if (!record || !entries || entries.length === 0) return record;
  const ids = entries.map((e) => e.id);
  try {
    const rows = await prisma.$queryRaw<{ id: string; pmt: string | null }[]>`
      SELECT "id", "printMainText" AS pmt FROM "universal_salvation_entries" WHERE "id" = ANY(${ids})`;
    const byId = new Map(rows.map((r) => [r.id, r.pmt]));
    for (const e of entries) {
      (e as { printMainText?: string | null }).printMainText = byId.has(e.id) ? byId.get(e.id) ?? null : null;
    }
  } catch {
    // 欄位尚未部署等情況：不阻斷主流程，維持既有行為。
  }
  return record;
}
