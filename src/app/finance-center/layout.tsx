import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { canFinance } from "@/lib/permissions";

/**
 * V23.1 財務中心伺服器端守門。
 *
 * 財務中心（含首頁、流水帳、收支、轉移、盤點、報表、列印預覽）一律只開放
 * 給 SUPER_ADMIN 與 ADMIN。此 layout 在伺服器端以 session 角色（由 DB 查得，
 * 非前端宣稱）判斷 canFinance(role, "view")；不通過者連子頁面內容都不會渲染，
 * 不是只做前端隱藏。每支財務 API 另有 assertFinancePermissionForOperator 二次把關。
 */
export default async function FinanceCenterLayout({ children }: { children: React.ReactNode }) {
  const me = await getSessionUser();
  const role = me?.role ?? null;

  if (!role || !canFinance(role, "view")) {
    return (
      <div className="min-h-screen">
        <main className="mx-auto max-w-lg px-6 py-16">
          <div className="rounded-3xl bg-white/70 p-8 text-center shadow-card">
            <h1 className="text-lg text-ink">沒有權限</h1>
            <p className="mt-2 text-sm text-ink-soft">財務中心僅限最高管理員與管理員使用。</p>
            <Link href="/" className="mt-4 inline-block rounded-full bg-cream-200 px-5 py-2 text-sm text-ink-soft hover:bg-cream-300">
              返回首頁
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return <>{children}</>;
}
