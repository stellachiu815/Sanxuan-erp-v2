import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/permissions";
import { SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/authConstants";

export { SESSION_COOKIE, SESSION_TTL_MS };

/**
 * V14.3 正式登入系統（含密碼）。
 *
 * 沿用既有權限架構（permissions.ts 的角色矩陣、operator.ts 的
 * ResolvedOperator），只補上「證明請求真的是本人」這一層：密碼 + session。
 * 密碼雜湊用 Node 內建 crypto scrypt（不引入任何新套件）；session 存資料庫，
 * 以 httpOnly cookie 帶 token 對應。
 */

const scrypt = promisify(scryptCb);

// SESSION_COOKIE／SESSION_TTL_MS 一律以 authConstants.ts 為單一來源
// （middleware 在 edge runtime 也 import 同一份，避免把 Prisma 打包進 edge）。
// 這裡只 re-export（見檔頭 import），不再本地重複宣告。

const SCRYPT_KEYLEN = 64;

/** 雜湊密碼 → "salt:hash"（皆 hex）。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

/** 驗證密碼（timing-safe）。stored 為 hashPassword 的輸出。 */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const derived = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

/** 產生 session token（隨機、不可猜）。 */
export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export type SessionUser = { id: string; name: string; role: Role };

/** 建立 session（寫 DB），回傳 token 與到期時間。 */
export async function createSession(
  userId: string,
  ipAddress?: string | null,
  userAgent?: string | null
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { token, userId, ipAddress: ipAddress ?? null, userAgent: userAgent ?? null, expiresAt },
  });
  return { token, expiresAt };
}

/** 刪除 session（登出）。 */
export async function destroySession(token: string | null | undefined): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({ where: { token } });
}

/** 依 token 查目前登入使用者（驗證未過期、帳號未停用）。過期/停用/查無回 null。 */
export async function getSessionUserByToken(token: string | null | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.deleteMany({ where: { token } });
    return null;
  }
  if (!session.user || !session.user.isActive) return null;
  return { id: session.user.id, name: session.user.name, role: session.user.role as Role };
}

/** 從目前請求的 cookie 取得登入使用者（伺服器端；未登入回 null）。 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? null;
  return getSessionUserByToken(token);
}

/** 取目前請求 cookie 的 session token（供登出等使用）。 */
export async function getCurrentSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}
