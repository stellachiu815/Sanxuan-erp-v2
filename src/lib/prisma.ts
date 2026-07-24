import { PrismaClient, Prisma } from "@prisma/client";

/**
 * V14.4：可共用的資料庫 client 型別。既有 service 可加 optional `db?: DbClient`
 * 參數，不傳時用全域 prisma（行為不變）；傳入 transaction client 時，該 service
 * 的寫入即納入呼叫端的同一個 transaction（Excel 匯入單列 confirm 用來達成
 * 「任一步失敗整列 rollback、不留半套正式資料」）。
 */
export type DbClient = PrismaClient | Prisma.TransactionClient;

// Next.js 開發模式下會重新載入模組，這個寫法避免每次都建立新的
// PrismaClient、把資料庫連線用光。正式環境（production）則單純建立一個。
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
