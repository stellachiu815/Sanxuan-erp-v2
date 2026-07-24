/**
 * V14.3 一次性 bootstrap：設定初始最高管理員（SUPER_ADMIN）的登入帳號與密碼。
 *
 * 沒有這一步，正式登入上線後沒有任何帳號有密碼、所有人都無法登入。請執行一次：
 *
 *   ADMIN_LOGIN=admin ADMIN_PASSWORD='你的強密碼' ADMIN_NAME='系統管理員' \
 *     npx tsx scripts/setInitialAdmin.ts
 *
 * 行為：若已有同 loginId 或既有 SUPER_ADMIN 則更新其密碼；否則建立一個新的
 * SUPER_ADMIN。密碼用 Node 內建 scrypt 雜湊（與 src/lib/auth.ts 相同格式
 * "salt:hash"），此腳本刻意自帶雜湊、不 import next/headers，方便在 CLI 執行。
 */
import { randomBytes, scryptSync } from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

async function main() {
  const loginId = process.env.ADMIN_LOGIN?.trim() || process.argv[2];
  const password = process.env.ADMIN_PASSWORD || process.argv[3];
  const name = process.env.ADMIN_NAME?.trim() || "系統管理員";

  if (!loginId || !password) {
    console.error("用法：ADMIN_LOGIN=admin ADMIN_PASSWORD=... [ADMIN_NAME=...] npx tsx scripts/setInitialAdmin.ts");
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("密碼至少 6 碼。");
    process.exit(1);
  }

  const passwordHash = hashPassword(password);

  const existing =
    (await prisma.user.findUnique({ where: { loginId } })) ??
    (await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } }));

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { loginId, passwordHash, role: "SUPER_ADMIN", isActive: true },
    });
    console.log(`已更新最高管理員帳號：${existing.name}（loginId=${loginId}）`);
  } else {
    const created = await prisma.user.create({
      data: { name, loginId, passwordHash, role: "SUPER_ADMIN", isActive: true },
    });
    console.log(`已建立最高管理員帳號：${created.name}（loginId=${loginId}）`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
