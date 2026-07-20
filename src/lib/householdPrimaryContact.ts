import type { Prisma } from "@prisma/client";

/**
 * V12.3「家戶管理完整強化」指令三：主要聯絡人一致性。
 *
 * ── 問題背景 ──
 * 系統用兩個地方表示「主要聯絡人」，而且在 V12.3 之前完全沒有互相同步：
 *
 *   Household.contactName   String?   純文字姓名
 *   Member.isPrimaryContact Boolean   成員身上的旗標
 *
 * 造成的實際問題：
 *   1. 主要聯絡人被轉移／拆分出去後，原戶的 contactName 文字原樣留著，
 *      變成指向「已經不在這一戶的人」的孤兒文字。
 *   2. 同一戶可能有多位成員 isPrimaryContact = true。
 *   3. contactName 可能根本不是這戶任何一位成員的姓名。
 *
 * ── 本版作法 ──
 * 依指令三，**先不新增 Household.contactMemberId 欄位**（避免這次 migration
 * 過大），改用程式碼層強制同步：所有會影響主要聯絡人的路徑，一律呼叫這裡的
 * 函式，不各自改 contactName 或 isPrimaryContact。
 *
 * 規則（指令三逐條對應）：
 *   1. 一戶最多一位 isPrimaryContact = true    → setPrimaryContact()
 *   2. 指定時必須屬於該戶、同步 contactName、其他人改 false → setPrimaryContact()
 *   3. 被移出時原戶不留孤兒 contactName        → resolvePrimaryContactAfterRemoval()
 *   4. 合併時兩戶都有主要聯絡人須由使用者選擇   → 呼叫端在 preview 強制
 *   5. 不可只改 contactName 不處理 isPrimaryContact → 兩者一律一起寫
 */

/**
 * 指定某位成員為家戶的主要聯絡人（規則 1、2、5）。
 *
 * 必須在交易內呼叫。會同時：
 *   - 把同戶其他成員的 isPrimaryContact 一律設為 false
 *   - 把指定成員設為 true
 *   - 把 Household.contactName 同步成該成員姓名
 *
 * @returns 實際被設為主要聯絡人的成員姓名
 */
export async function setPrimaryContact(
  tx: Prisma.TransactionClient,
  householdId: string,
  memberId: string
): Promise<string> {
  const member = await tx.member.findFirst({
    where: { id: memberId, householdId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!member) {
    // 規則 2：必須屬於目前家戶。丟一般 Error，由呼叫端轉成 HouseholdManagementError
    // 或直接讓交易 rollback。
    throw new Error("指定的主要聯絡人不屬於這個家戶");
  }

  await tx.member.updateMany({
    where: { householdId, isPrimaryContact: true, NOT: { id: memberId } },
    data: { isPrimaryContact: false },
  });
  await tx.member.update({ where: { id: memberId }, data: { isPrimaryContact: true } });
  await tx.household.update({ where: { id: householdId }, data: { contactName: member.name } });

  return member.name;
}

/**
 * 明確設定為「暫時不指定主要聯絡人」（規則 3 的其中一個選項）。
 * 會清掉該戶所有成員的 isPrimaryContact 與 Household.contactName，
 * 不留下任何孤兒文字。
 */
export async function clearPrimaryContact(
  tx: Prisma.TransactionClient,
  householdId: string
): Promise<void> {
  await tx.member.updateMany({
    where: { householdId, isPrimaryContact: true },
    data: { isPrimaryContact: false },
  });
  await tx.household.update({ where: { id: householdId }, data: { contactName: null } });
}

/**
 * 成員離開某一戶（轉移／拆分／合併）之後，處理原家戶的主要聯絡人（規則 3）。
 *
 * 只有在「被移走的人裡面包含目前的主要聯絡人」時才需要動作：
 *   - 原戶已經沒有成員 → 直接清空，不留孤兒 contactName
 *   - 原戶還有成員     → 依呼叫端從 preview 收集到的使用者決定：
 *       newPrimaryContactMemberId 有值 → 指定為新的主要聯絡人
 *       明確選擇不指定（undefined）    → 清空
 *
 * ⚠️ 呼叫端必須先在 preview 讓使用者做出選擇；這裡不會自作主張挑一位成員
 * 遞補，避免系統擅自決定誰是這一戶的對外窗口。
 */
export async function resolvePrimaryContactAfterRemoval(
  tx: Prisma.TransactionClient,
  householdId: string,
  removedMemberIds: string[],
  newPrimaryContactMemberId?: string | null
): Promise<{ changed: boolean; newContactName: string | null }> {
  const removedPrimary = await tx.member.findFirst({
    where: { id: { in: removedMemberIds }, isPrimaryContact: true },
    select: { id: true },
  });

  // 也涵蓋「contactName 指向被移走的人，但旗標沒設好」這種既有的不一致資料：
  // 若原戶已經沒有任何 isPrimaryContact 成員，contactName 也不該繼續留著。
  const stillHasPrimary = await tx.member.findFirst({
    where: { householdId, isPrimaryContact: true, deletedAt: null, NOT: { id: { in: removedMemberIds } } },
    select: { id: true, name: true },
  });

  if (!removedPrimary && stillHasPrimary) {
    // 主要聯絡人沒被移走，但順手校正 contactName 與實際成員姓名一致（規則 5）。
    await tx.household.update({ where: { id: householdId }, data: { contactName: stillHasPrimary.name } });
    return { changed: false, newContactName: stillHasPrimary.name };
  }

  if (!removedPrimary && !stillHasPrimary) {
    // 這一戶本來就沒有設定主要聯絡人旗標；若 contactName 有殘留文字且原戶
    // 已無成員，一併清掉。
    const remainingCount = await tx.member.count({
      where: { householdId, deletedAt: null, NOT: { id: { in: removedMemberIds } } },
    });
    if (remainingCount === 0) {
      await tx.household.update({ where: { id: householdId }, data: { contactName: null } });
      return { changed: true, newContactName: null };
    }
    return { changed: false, newContactName: null };
  }

  // 主要聯絡人確實被移走了。
  if (newPrimaryContactMemberId) {
    const name = await setPrimaryContact(tx, householdId, newPrimaryContactMemberId);
    return { changed: true, newContactName: name };
  }

  await clearPrimaryContact(tx, householdId);
  return { changed: true, newContactName: null };
}

/**
 * 成員加入新家戶後，若該成員身上還帶著舊戶的 isPrimaryContact = true 旗標，
 * 必須清掉——否則新戶會突然多出一位（甚至兩位）主要聯絡人（規則 1）。
 *
 * 目標戶的主要聯絡人由呼叫端依使用者選擇另行 setPrimaryContact()。
 */
export async function clearIncomingPrimaryContactFlags(
  tx: Prisma.TransactionClient,
  memberIds: string[]
): Promise<void> {
  if (memberIds.length === 0) return;
  await tx.member.updateMany({
    where: { id: { in: memberIds }, isPrimaryContact: true },
    data: { isPrimaryContact: false },
  });
}

/** preview 用：這一戶目前的主要聯絡人（旗標優先，其次 contactName 文字）。 */
export async function describePrimaryContact(
  client: Prisma.TransactionClient,
  householdId: string
): Promise<{ memberId: string | null; name: string | null }> {
  const flagged = await client.member.findFirst({
    where: { householdId, isPrimaryContact: true, deletedAt: null },
    select: { id: true, name: true },
  });
  if (flagged) return { memberId: flagged.id, name: flagged.name };

  const household = await client.household.findUnique({
    where: { id: householdId },
    select: { contactName: true },
  });
  return { memberId: null, name: household?.contactName ?? null };
}
