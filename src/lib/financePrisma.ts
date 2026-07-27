import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * V22 財務中心資料存取邊界。
 *
 * FinanceRecord 於 V22 新增多個欄位、並新增 FinanceReconciliation model。
 * 在 `prisma generate` 於部署機（Mac）重新產生 Client 之前，這裡以最小型別介面
 * 對應資料庫實際欄位，讓型別檢查與服務層維持乾淨；正式執行時（產生後的 Client）
 * 欄位與 model 皆存在，行為一致。此檔為唯一集中處理未生成型別的地方。
 */

export type FinanceAccountT = "BANK" | "CASH";
export type FinanceEntryKindT =
  | "OPENING"
  | "INCOME"
  | "EXPENSE"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "ADJUSTMENT";
export type FinanceDirectionT = "IN" | "OUT";
export type FinanceStatusT = "DRAFT" | "CONFIRMED" | "VOID";
export type FinanceTypeT = "INCOME" | "EXPENSE";

export interface FinanceRecordRow {
  id: string;
  type: FinanceTypeT;
  category: string | null;
  amount: Prisma.Decimal;
  occurredOn: Date;
  description: string | null;
  status: FinanceStatusT;
  account: FinanceAccountT | null;
  entryKind: FinanceEntryKindT | null;
  direction: FinanceDirectionT | null;
  year: number | null;
  templeEventId: string | null;
  transferGroupId: string | null;
  reconciliationId: string | null;
  correctsRecordId: string | null;
  isHistorical: boolean;
  createdById: string | null;
  createdByName: string | null;
  voidedById: string | null;
  voidedByName: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FinanceReconciliationRow {
  id: string;
  account: FinanceAccountT;
  occurredOn: Date;
  systemAmount: Prisma.Decimal;
  countedAmount: Prisma.Decimal;
  difference: Prisma.Decimal;
  note: string | null;
  adjustmentRecordId: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdAt: Date;
}

type Where = Record<string, unknown>;

export interface FinanceRecordDelegate {
  findMany(args?: { where?: Where; orderBy?: unknown; take?: number; skip?: number }): Promise<FinanceRecordRow[]>;
  findUnique(args: { where: { id: string } }): Promise<FinanceRecordRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<FinanceRecordRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<FinanceRecordRow>;
  count(args?: { where?: Where }): Promise<number>;
}

export interface FinanceReconciliationDelegate {
  findMany(args?: { where?: Where; orderBy?: unknown; take?: number }): Promise<FinanceReconciliationRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<FinanceReconciliationRow>;
}

/** FinanceRecord delegate（含 V22 欄位）。 */
export function financeRecords(): FinanceRecordDelegate {
  return prisma.financeRecord as unknown as FinanceRecordDelegate;
}

/** FinanceReconciliation delegate（V22 新增 model）。 */
export function financeReconciliations(): FinanceReconciliationDelegate {
  return (prisma as unknown as { financeReconciliation: FinanceReconciliationDelegate }).financeReconciliation;
}

/** 交易內取得 FinanceRecord delegate。 */
export function financeRecordsTx(tx: unknown): FinanceRecordDelegate {
  return (tx as { financeRecord: FinanceRecordDelegate }).financeRecord;
}
export function financeReconciliationsTx(tx: unknown): FinanceReconciliationDelegate {
  return (tx as { financeReconciliation: FinanceReconciliationDelegate }).financeReconciliation;
}

// accountForPaymentMethod 移至純計算層 financeCalc.ts（無 Prisma 相依，便於單元測試）。
export { accountForPaymentMethod } from "@/lib/financeCalc";
