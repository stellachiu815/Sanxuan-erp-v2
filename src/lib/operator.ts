/**
 * V11.1.1「全專案建置、權限與正式封版指令」新增。
 *
 * 這個檔案是收據中心 API 真正落實伺服器端權限檢查的入口：呼叫端
 * （畫面／API 呼叫）帶入使用者目前選擇的 userId，這裡會實際查詢既有的
 * User 資料表（prisma/schema.prisma 裡本來就存在、先前只是預留沒有真正
 * 使用的 model），確認這個 id 真的存在且 isActive，再依查到的角色檢查
 * src/lib/permissions.ts 的收據權限矩陣。
 *
 * ⚠️ 誠實的範圍說明（一定要讓使用者知道這個機制實際做到什麼程度）：
 * 這不是登入/驗證系統。User 沒有密碼，沒有 session，沒有任何機制證明
 * 「這個請求真的是這個 userId 對應的本人送出的」——任何知道或猜到某個
 * userId 的人，都可以在請求裡冒用它。這裡做到的、也僅止於：
 *   1. userId 必須對應資料庫裡真實存在、且未被停用的 User，不能隨便
 *      傳一個不存在的 id 或直接在前端宣稱「我是 SUPER_ADMIN」矇混過去
 *      （跟「client 直接送出 role 字串」比起來，這已經需要知道一個真實
 *      存在的 id，門檻更高）。
 *   2. 角色與權限的對應關係，由伺服器端查資料庫取得的角色決定，不信任
 *      任何 client 送來的 role 欄位。
 * 距離「真正安全」還缺：帳號密碼（或其他身分驗證方式）＋ session/token，
 * 證明這個請求真的是這個人本人發出的。這件事必須等系統做出真正的登入
 * 機制才能完成，本輪範圍明確限定在「收據相關 API 的伺服器端權限檢查」，
 * 不包含建置完整登入系統（那是明顯更大的獨立工程，需求也沒有要求本輪
 * 一併做出來）。
 */
import { prisma } from "@/lib/prisma";
import {
  canReceipt,
  canApproveReceiptVoidOrReissue,
  canSystem,
  canDevotee,
  type Role,
  type ReceiptAction,
  type SystemAction,
  type DevoteeAction,
} from "@/lib/permissions";

export type ResolvedOperator = {
  id: string;
  name: string;
  role: Role;
};

/** 依 userId 查詢真實存在、且未被停用的操作人員。找不到／已停用回傳 null。 */
export async function resolveOperator(userId: string | null | undefined): Promise<ResolvedOperator | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) return null;
  return { id: user.id, name: user.name, role: user.role as Role };
}

export type OperatorCheckResult =
  | { ok: true; operator: ResolvedOperator }
  | { ok: false; status: number; error: string };

/**
 * 收據中心 API route 的標準用法：
 *
 *   const check = await assertReceiptPermissionForOperator(body.operatorUserId, "issue");
 *   if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
 *   const operatorName = check.operator.name;
 *
 * 找不到／已停用的 userId 一律視為「尚未登入」，回傳 401；userId 存在但
 * 角色沒有這個操作的權限，回傳 403——兩種情況都明確拒絕執行，不會有
 * 「找不到使用者就當作有權限」這種預設開放的漏洞。
 */
export async function assertReceiptPermissionForOperator(
  userId: string | null | undefined,
  action: ReceiptAction
): Promise<OperatorCheckResult> {
  const operator = await resolveOperator(userId);
  if (!operator) {
    return { ok: false, status: 401, error: "找不到有效的操作人員身分，請重新選擇目前操作人員" };
  }
  if (!canReceipt(operator.role, action)) {
    return { ok: false, status: 403, error: `目前操作人員（${operator.name}）沒有權限執行這個操作` };
  }
  return { ok: true, operator };
}

export type ApproverCheckResult =
  | { ok: true; approver: ResolvedOperator }
  | { ok: false; status: number; error: string };

/**
 * 收據作廢／換開的「核准人」驗證（對應需求「四」）：核准人必須是真實存在
 * 且未被停用的授權管理人員（ADMIN 或 SUPER_ADMIN），不能隨便找一個
 * STAFF/READONLY 帳號當核准人。
 */
export async function resolveApprover(approverUserId: string | null | undefined): Promise<ApproverCheckResult> {
  const approver = await resolveOperator(approverUserId);
  if (!approver) {
    return { ok: false, status: 401, error: "找不到有效的核准人身分" };
  }
  if (!canApproveReceiptVoidOrReissue(approver.role)) {
    return { ok: false, status: 403, error: `核准人（${approver.name}）不是授權管理人員，無法核准這個操作` };
  }
  return { ok: true, approver };
}

/**
 * V11.2「系統管理中心」API route 的標準用法，跟
 * assertReceiptPermissionForOperator() 是同一種模式（對應指令
 * 「十四」：只有最高管理員可以操作備份/還原/Google Drive 連線，一般
 * 使用者不得看到）。
 */
export async function assertSystemPermissionForOperator(
  userId: string | null | undefined,
  action: SystemAction
): Promise<OperatorCheckResult> {
  const operator = await resolveOperator(userId);
  if (!operator) {
    return { ok: false, status: 401, error: "找不到有效的操作人員身分，請重新選擇目前操作人員" };
  }
  if (!canSystem(operator.role, action)) {
    return { ok: false, status: 403, error: `目前操作人員（${operator.name}）沒有權限執行這個操作` };
  }
  return { ok: true, operator };
}

/**
 * V12.0「信眾關係中心」API route 的標準用法，跟
 * assertReceiptPermissionForOperator()／assertSystemPermissionForOperator()
 * 是同一種模式（對應指令「十六」：所有後端 API 都必須重新驗證登入身分與
 * 角色，不能只靠前端隱藏按鈕）。刻意沿用這裡既有的 resolveOperator()／
 * ResolvedOperator／OperatorCheckResult，不另外重新設計一套權限驗證機制。
 */
export async function assertDevoteePermissionForOperator(
  userId: string | null | undefined,
  action: DevoteeAction
): Promise<OperatorCheckResult> {
  const operator = await resolveOperator(userId);
  if (!operator) {
    return { ok: false, status: 401, error: "找不到有效的操作人員身分，請重新選擇目前操作人員" };
  }
  if (!canDevotee(operator.role, action)) {
    return { ok: false, status: 403, error: `目前操作人員（${operator.name}）沒有權限執行這個操作` };
  }
  return { ok: true, operator };
}
