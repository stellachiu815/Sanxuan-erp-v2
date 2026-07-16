import { PrismaClient } from "@prisma/client";

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
