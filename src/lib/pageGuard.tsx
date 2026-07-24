import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import type { Role } from "@/lib/permissions";

/**
 * V14.3【前端角色顯示與操作收斂】：Server Component 頁面的伺服器端守門。
 *
 * 用於「直接輸入網址」也必須擋下的受限管理頁。因為 V14.3 之後登入者是存在
 * httpOnly session cookie，Server Component 在渲染當下就能用 getSessionUser()
 * 得知是誰——所以這些頁面可以在「還沒查任何資料、還沒渲染表單」之前就先
 * 擋掉未登入／無權限者，符合指令「不得先顯示完整表單再等送出才報錯」。
 *
 * ⚠️ 這仍不是唯一安全防線（API 的 assertXForOperator 才是）；沿用同一份
 * permissions.ts 的 canX 判斷，不建立第二套權限。
 *
 * 用法（在 async 頁面最上方）：
 *   const guard = await requirePagePermission((r) => canOffering(r, "manageOfferingTypes"), "/offering-center/settings");
 *   if (guard.denied) return guard.deniedView;
 *   // ...接著才查資料、渲染
 */
export async function requirePagePermission(
  check: (role: Role) => boolean,
  loginNext: string
): Promise<{ denied: false; role: Role } | { denied: true; deniedView: React.ReactElement }> {
  const user = await getSessionUser();
  if (!user) {
    // 未登入 → 導回登入頁（middleware 通常已擋，這是伺服器端雙保險）。
    redirect(`/login?next=${encodeURIComponent(loginNext)}`);
  }
  if (!check(user.role)) {
    return { denied: true, deniedView: <NoPermissionView /> };
  }
  return { denied: false, role: user.role };
}

/** 無權限畫面（403 體驗，不洩漏受限內容）。 */
export function NoPermissionView({
  title = "沒有權限",
  message = "您沒有使用這個功能的權限，若有需要請聯繫系統管理員。",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="min-h-screen">
      <main className="mx-auto mt-24 max-w-md rounded-3xl bg-white/70 p-8 text-center shadow-card">
        <p className="text-base font-medium text-ink-soft">{title}</p>
        <p className="mt-2 text-sm text-ink-faint">{message}</p>
        <a
          href="/"
          className="mt-6 inline-block rounded-full bg-butter-100 px-5 py-2 text-sm text-ink-soft hover:bg-butter-200"
        >
          回首頁
        </a>
      </main>
    </div>
  );
}
