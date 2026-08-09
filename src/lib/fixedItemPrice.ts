import { prisma } from "@/lib/prisma";

/**
 * 「贊普型」報名項目的固定單價存取（補庫、宮燈等共用）。
 *
 * 設計：單價存在該報名項目本身（RegistrationItemType.defaultUnitPrice）＋ feeMode=FIXED。
 * 種子是 create-only（見 registrationItems.ts ensureRegistrationItemTypesSeeded），
 * 所以宮方手動設定的單價**不會被部署覆蓋**——因此不需要任何資料庫欄位變更(migration)。
 *
 * 語意：這是「目前單價」，宮方每年設定一次；改了只影響**之後**建立的報名，
 * 既有報名建立當下即鎖價（RitualRegistrationItem.amountDue 已寫入），不受影響。
 * 報名金額＝單價 × 份數（feeMode FIXED，見 registrationItemRegistration 計價）。
 */

/** 允許用此機制設定固定單價的項目 key（贊普型）。避免誤改其他項目。 */
const FIXED_PRICE_ITEM_KEYS = new Set(["STORAGE_TROUSERS", "PALACE_LANTERN"]);

export type FixedItemPrice = { ok: true; key: string; name: string; unitPrice: number | null } | { ok: false; status: number; error: string };

export async function getFixedItemPrice(key: string): Promise<FixedItemPrice> {
  if (!FIXED_PRICE_ITEM_KEYS.has(key)) return { ok: false, status: 400, error: "不支援此項目的單價設定" };
  const it = await prisma.registrationItemType.findUnique({ where: { key }, select: { key: true, name: true, defaultUnitPrice: true } });
  if (!it) return { ok: false, status: 404, error: "找不到這個報名項目設定" };
  return { ok: true, key: it.key, name: it.name, unitPrice: it.defaultUnitPrice === null ? null : Number(it.defaultUnitPrice) };
}

export async function setFixedItemPrice(key: string, unitPrice: number): Promise<FixedItemPrice> {
  if (!FIXED_PRICE_ITEM_KEYS.has(key)) return { ok: false, status: 400, error: "不支援此項目的單價設定" };
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return { ok: false, status: 400, error: "單價必須是 0 以上的數字" };
  const it = await prisma.registrationItemType.findUnique({ where: { key }, select: { id: true } });
  if (!it) return { ok: false, status: 404, error: "找不到這個報名項目設定" };
  // 設為固定價：feeMode=FIXED＋單價。之後報名勾此項目時金額＝單價×份數。
  const updated = await prisma.registrationItemType.update({
    where: { key },
    data: { feeMode: "FIXED", defaultUnitPrice: unitPrice },
    select: { key: true, name: true, defaultUnitPrice: true },
  });
  return { ok: true, key: updated.key, name: updated.name, unitPrice: updated.defaultUnitPrice === null ? null : Number(updated.defaultUnitPrice) };
}
