import { ActivityType, Prisma, TempleEventStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";
import { formatTempleEventName } from "@/lib/templeEventNaming";
import { defaultChecklistLabels } from "@/lib/checklistDefaults";
import { solarToLunar, formatSolarDate } from "@/lib/lunar";
import {
  createPurificationYear,
  copyPurificationYearFromPrevious,
  type PurificationYearDiffItem,
} from "@/lib/purification";
import { copyActivityOfferingsForNewEvent } from "@/lib/activityOfferings";

import { DEFAULT_POCKET_UNIT_PRICE, resolvePocketUnitPrice } from "@/lib/pocketPricing";
import { upsertParticipantsInTransaction } from "@/lib/ritualParticipants";
/**
 * V8.1「宮務活動中心」核心邏輯：活動精靈（Step1～Step4）＋活動 Checklist＋
 * 活動支出容器。這裡是所有宮務活動（普渡、祭改、光明燈、太歲燈、全家燈、
 * 補庫、宮慶、其他）共用的「活動年度」層級邏輯——每一個活動類型各自的
 * 明細（例如祭改的報名者/編號/貼紙列印）繼續放在各自的 lib 檔案裡
 * （src/lib/purification.ts、src/lib/ritual.ts），這裡只負責：
 *
 * 1. 活動年度主檔（TempleEvent）的建立/沿用去年/清單/總覽；
 * 2. 活動 Checklist 自動建立與勾選；
 * 3. 活動支出容器（TempleEventExpense）；
 * 4. 光明燈/太歲燈/全家燈/補庫/宮慶/其他這 6 種目前還沒有專屬明細規格的
 *    活動類型，先提供最基本的「參加名單」（掛在 RitualRecord 底下，一戶
 *    一筆，備註/金額自由填寫）——之後要幫任何一種補上完整規格（像祭改
 *    那樣的編號/列印規則），都只需要在它專屬的 lib 檔案裡新增明細表，
 *    不需要重新設計這個檔案裡的活動年度架構。
 *
 * 祭改（PURIFICATION）刻意「委派」給 src/lib/purification.ts 既有、已經
 * 完整實作十六節規格的函式，不在這裡重新實作一次規則。
 */

export type TempleEventResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

// ============================================================
// 一、活動基本資料（Step2）／建立方式：空白建立、ERP 直接輸入（Step3①④）
// ============================================================

export type CreateTempleEventInput = {
  activityType: ActivityType;
  year: number;
  name?: string | null;
  lunarDateYear?: number | null;
  lunarDateMonth?: number | null;
  lunarDateDay?: number | null;
  lunarDateIsLeap?: boolean;
  solarDate?: Date | null;
  status?: TempleEventStatus;
  note?: string | null;
};

const ACTIVITY_TYPE_LABEL_FOR_NAME: Record<ActivityType, string> = {
  DRAGON_PHOENIX_LANTERN: "龍鳳燈",
  ANNUAL_LANTERN: "年度燈",
  UNIVERSAL_SALVATION: "中元普渡",
  TEMPLE_CELEBRATION: "宮慶",
  REPRINT: "補印",
  PURIFICATION: "祭改",
  GUANGMING_LANTERN: "光明燈",
  TAISUI_LANTERN: "太歲燈",
  FAMILY_LANTERN: "全家燈",
  STORAGE_REPAYMENT: "補庫",
  OTHER: "其他活動",
  // V10.1「供品認捐中心」新增：四位主祀神明聖誕。
  GUANDI_BIRTHDAY: "關聖帝君聖誕",
  XUANTIAN_BIRTHDAY: "玄天上帝聖誕",
  YAOCHI_BIRTHDAY: "瑤池金母聖誕",
  ZHONGTAN_BIRTHDAY: "中壇元帥聖誕",
};

/**
 * 活動精靈 Step2「建立活動基本資料」＋自動 cascade（需求「四」）。
 *
 * 祭改（PURIFICATION）委派給 createPurificationYear()（已經處理好唯一性
 * 檢查、名稱組字規則），其他活動類型走這裡的通用建立邏輯。建立完成後
 * 一律自動 seed 活動 Checklist（需求「十一」），活動首頁/統計資料本身
 * 不需要另外「建立」——首頁是查詢頁面，統計資料查詢當下即時計算，見
 * getTempleEventHome()。
 */
export async function createTempleEvent(
  input: CreateTempleEventInput,
  operatorName?: string | null
): Promise<TempleEventResult<{ id: string }>> {
  if (input.activityType === "PURIFICATION") {
    const result = await createPurificationYear(input.year, operatorName);
    if (!result.ok) return result;
    await seedChecklist(result.data.id, "PURIFICATION", operatorName);
    return result;
  }

  const existing = await prisma.templeEvent.findUnique({
    where: { activityType_year: { activityType: input.activityType, year: input.year } },
  });
  if (existing) {
    return { ok: false, status: 409, error: "這個年度、這種活動類型已經建立過活動了" };
  }

  const name = input.name?.trim() || formatTempleEventName(input.year, ACTIVITY_TYPE_LABEL_FOR_NAME[input.activityType]);

  const created = await prisma.$transaction(async (tx) => {
    const event = await tx.templeEvent.create({
      data: {
        activityType: input.activityType,
        year: input.year,
        name,
        lunarDateYear: input.lunarDateYear ?? null,
        lunarDateMonth: input.lunarDateMonth ?? null,
        lunarDateDay: input.lunarDateDay ?? null,
        lunarDateIsLeap: Boolean(input.lunarDateIsLeap),
        solarDate: input.solarDate ?? null,
        status: input.status ?? "PREPARING",
        note: input.note ?? null,
        /**
         * V13.3B：新建普渡活動時，寶袋預設單價一律帶入 300
         * （DEFAULT_POCKET_UNIT_PRICE，見 src/lib/pocketPricing.ts）。
         *
         * 只有普渡會用到寶袋，其他活動類型維持 null——它們的
         * AdditionalPrintItem 目前沒有收費需求，寫入價格只會造成誤解。
         */
        pocketUnitPrice:
          input.activityType === "UNIVERSAL_SALVATION" ? DEFAULT_POCKET_UNIT_PRICE : null,
      },
    });
    await recordVersion(
      { entityType: "TempleEvent", entityId: event.id, action: "CREATE", afterData: event, operatorName },
      tx
    );
    return event;
  });

  await seedChecklist(created.id, input.activityType, operatorName);

  return { ok: true, data: { id: created.id } };
}

// ============================================================
// 二、沿用去年活動（Step3②）
// ============================================================

export type CopyTempleEventOptions = {
  copyParticipants: boolean; // □ 去年參加名單
  copySettings: boolean; // □ 去年設定（目前只有祭改的活動年度額外禁用號碼會用到）
  copyFees: boolean; // □ 去年收費（是否沿用收款狀態/金額；預設不沿用，重設為未收）
};

export type CopyTempleEventResult = {
  id: string;
  diffs: PurificationYearDiffItem[]; // 只有祭改會回傳有意義的差異比對，其他活動類型固定回傳空陣列
};

/**
 * 活動精靈 Step3②「複製去年活動」，支援三個獨立勾選項目。祭改因為已經有
 * 完整、通過測試的沿用/差異比對邏輯，直接委派給 copyPurificationYearFromPrevious
 * （這支本來就會複製參加名單/設定，收費一律重設為未收——跟需求「收費」
 * 勾選關閉時的行為一致；若之後要讓祭改也支援「收費」勾選打開時沿用金額，
 * 需要另外調整 purification.ts，本輪先維持祭改既有行為不變）。
 *
 * 其他活動類型走通用複製邏輯：只複製「參加名單」（householdId + notes，
 * 且只在勾選「去年參加名單」時才複製；不勾選就只建立空白年度）。
 */
export async function copyTempleEventFromPrevious(
  activityType: ActivityType,
  newYear: number,
  sourceEventId: string,
  options: CopyTempleEventOptions,
  operatorName?: string | null
): Promise<TempleEventResult<CopyTempleEventResult>> {
  if (activityType === "PURIFICATION") {
    const result = await copyPurificationYearFromPrevious(newYear, sourceEventId, operatorName);
    if (!result.ok) return result;
    await seedChecklist(result.data.id, "PURIFICATION", operatorName);
    // V10.1「供品認捐中心」需求「十九」：複製去年活動時一併複製供品設定
    // （供品種類選用清單/預設數量/預設價格/名額規則/24次花果供品日期），
    // 不複製認捐人/福壽龜得主/收款/收據（那些資料表本來就不在複製範圍內）。
    await copyActivityOfferingsForNewEvent(sourceEventId, result.data.id);
    return { ok: true, data: { id: result.data.id, diffs: result.data.diffs } };
  }

  const existing = await prisma.templeEvent.findUnique({
    where: { activityType_year: { activityType, year: newYear } },
  });
  if (existing) {
    return { ok: false, status: 409, error: "這個年度、這種活動類型已經建立過活動了" };
  }
  const source = await prisma.templeEvent.findUnique({ where: { id: sourceEventId } });
  if (!source || source.activityType !== activityType) {
    return { ok: false, status: 404, error: "找不到來源活動年度" };
  }

  const name = formatTempleEventName(newYear, ACTIVITY_TYPE_LABEL_FOR_NAME[activityType]);

  const created = await prisma.$transaction(async (tx) => {
    const event = await tx.templeEvent.create({
      data: { activityType, year: newYear, name, copiedFromEventId: sourceEventId },
    });

    if (options.copyParticipants) {
      const sourceRecords = await tx.ritualRecord.findMany({
        where: { templeEventId: sourceEventId, activityType, deletedAt: null },
      });
      for (const record of sourceRecords) {
        const created = await tx.ritualRecord.create({
          data: {
            householdId: record.householdId,
            year: newYear,
            activityType,
            templeEventId: event.id,
            status: "DRAFT",
            notes: record.notes,
            registrationSource: "CARRY_OVER",
            copiedFromRitualRecordId: record.id,
          },
        });

        /**
         * V13.4 指令十八：沿用去年的參加名單時，成員也要一起帶過來。
         * ⚠️ 只複製「有哪些人」，不複製任何付款、收據、列印狀態
         * （那些欄位根本不在 RitualParticipant 上）。
         * 列印快照刻意不複製——新年度的虛歲不同，確認報名時才重新產生。
         */
        const sourceParticipants = await tx.ritualParticipant.findMany({
          where: { ritualRecordId: record.id, deletedAt: null },
          select: { memberId: true },
        });
        if (sourceParticipants.length > 0) {
          await upsertParticipantsInTransaction(
            tx,
            created.id,
            sourceParticipants.map((p) => p.memberId),
            operatorName
          );
        }
      }
    }

    await recordVersion(
      {
        entityType: "TempleEvent",
        entityId: event.id,
        action: "CREATE",
        afterData: event,
        changeNote: `沿用自 ${source.year} 年度`,
        operatorName,
      },
      tx
    );

    return event;
  });

  await seedChecklist(created.id, activityType, operatorName);

  // V10.1「供品認捐中心」需求「十九」：見上方 PURIFICATION 分支的相同說明。
  await copyActivityOfferingsForNewEvent(sourceEventId, created.id);

  return { ok: true, data: { id: created.id, diffs: [] } };
}

// ============================================================
// 三、活動清單／總覽（含通用參加名單、僅適用於還沒有專屬明細的活動類型）
// ============================================================

export async function listTempleEvents(activityType?: ActivityType) {
  return prisma.templeEvent.findMany({
    where: activityType ? { activityType } : undefined,
    orderBy: [{ year: "desc" }, { activityType: "asc" }],
  });
}

export type TodayTempleEventEntry = {
  id: string;
  activityType: ActivityType;
  year: number;
  name: string;
  status: TempleEventStatus;
  dateDisplay: string;
};

/**
 * 首頁 Dashboard（V11.2「下一個開發任務」需求「二、今日活動」）：找出「活動
 * 日期」（Step2 的國曆日期 solarDate、或農曆日期 lunarDateMonth/Day，兩者
 * 擇一填寫）換算後等於今天的活動年度。
 *
 * ⚠️ 誠實揭露：只有明確填寫了 solarDate 或完整農曆日期（lunarDateMonth＋
 * lunarDateDay）的活動年度，才有可能出現在這張卡片——普渡、祭改等活動
 * 類型本質上是「整個年度的登記期間」，不是單一一天的活動，通常不會填寫
 * 這兩個欄位，本來就不會出現在「今日活動」名單裡，這是資料本身的性質，
 * 不是這裡的邏輯遺漏。農曆換算沿用既有 solarToLunar()（見 src/lib/lunar.ts），
 * 不是另外寫的一套。
 */
export async function listTodayTempleEvents(now: Date = new Date()): Promise<TodayTempleEventEntry[]> {
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const todayLunar = solarToLunar(today);

  const events = await prisma.templeEvent.findMany({ where: { status: { not: "CANCELLED" } } });

  return events
    .filter((e) => {
      if (e.solarDate) {
        return (
          e.solarDate.getUTCFullYear() === today.getUTCFullYear() &&
          e.solarDate.getUTCMonth() === today.getUTCMonth() &&
          e.solarDate.getUTCDate() === today.getUTCDate()
        );
      }
      if (e.lunarDateMonth && e.lunarDateDay) {
        return (
          e.lunarDateMonth === todayLunar.month &&
          e.lunarDateDay === todayLunar.day &&
          Boolean(e.lunarDateIsLeap) === todayLunar.isLeapMonth
        );
      }
      return false;
    })
    .map((e) => ({
      id: e.id,
      activityType: e.activityType,
      year: e.year,
      name: e.name,
      status: e.status,
      dateDisplay: e.solarDate
        ? formatSolarDate(e.solarDate)
        : `農曆${e.lunarDateIsLeap ? "閏" : ""}${e.lunarDateMonth}月${e.lunarDateDay}日`,
    }));
}

export type TempleEventHome = {
  id: string;
  activityType: ActivityType;
  year: number;
  name: string;
  status: TempleEventStatus;
  note: string | null;
  participantCount: number;
  expenseTotal: string;
  checklist: { id: string; label: string; isDone: boolean; completedAt: Date | null; completedByName: string | null }[];
};

/** 活動首頁（需求「四」✓建立活動首頁 ✓建立統計資料）：統計資料即時查詢計算，不另外存欄位。 */
export async function getTempleEventHome(templeEventId: string): Promise<TempleEventHome | null> {
  const event = await prisma.templeEvent.findUnique({ where: { id: templeEventId } });
  if (!event) return null;

  const [participantCount, expenses, checklist] = await Promise.all([
    event.activityType === "PURIFICATION"
      ? prisma.purificationEntry.count({ where: { templeEventId, deletedAt: null, status: { not: "CANCELLED" } } })
      : prisma.ritualRecord.count({ where: { templeEventId, deletedAt: null } }),
    prisma.templeEventExpense.findMany({ where: { templeEventId } }),
    prisma.templeEventChecklistItem.findMany({ where: { templeEventId }, orderBy: { sortOrder: "asc" } }),
  ]);

  const expenseTotal = expenses.reduce((sum, e) => sum.plus(e.amount), new Prisma.Decimal(0));

  return {
    id: event.id,
    activityType: event.activityType,
    year: event.year,
    name: event.name,
    status: event.status,
    note: event.note,
    participantCount,
    expenseTotal: expenseTotal.toString(),
    checklist: checklist.map((c) => ({
      id: c.id,
      label: c.label,
      isDone: c.isDone,
      completedAt: c.completedAt,
      completedByName: c.completedByName,
    })),
  };
}

// ============================================================
// 四、通用參加名單（光明燈/太歲燈/全家燈/補庫/宮慶/其他——目前還沒有專屬
// 明細規格，先用最基本的「一戶一筆、備註自由填寫」）
// ============================================================

export type GenericParticipant = {
  id: string;
  householdId: string;
  householdName: string;
  contactName: string | null;
  notes: string | null;
  status: string;
  createdAt: Date;
};

export async function listGenericParticipants(templeEventId: string): Promise<GenericParticipant[]> {
  const records = await prisma.ritualRecord.findMany({
    where: { templeEventId, deletedAt: null },
    include: { household: true },
    orderBy: { createdAt: "asc" },
  });
  return records.map((r) => ({
    id: r.id,
    householdId: r.householdId,
    householdName: r.household.name,
    contactName: r.household.contactName,
    notes: r.notes,
    status: r.status,
    createdAt: r.createdAt,
  }));
}

export async function addGenericParticipant(
  templeEventId: string,
  householdId: string,
  notes: string | null,
  operatorName?: string | null,
  /** V13.4：本次納入的成員。未指定時預設納入戶長 */
  memberIds?: string[]
): Promise<TempleEventResult<{ id: string }>> {
  const event = await prisma.templeEvent.findUnique({ where: { id: templeEventId } });
  if (!event) return { ok: false, status: 404, error: "找不到這個活動" };

  const existing = await prisma.ritualRecord.findUnique({
    where: { householdId_year_activityType: { householdId, year: event.year, activityType: event.activityType } },
  });
  // 只有「有效」（非取消、非回收區）的既有資料才算真的重複；曾經被移除
  // （CANCELLED）的參加名單允許重新加入，見下方 update 會一併清掉 deletedAt。
  if (existing && existing.status !== "CANCELLED" && !existing.deletedAt) {
    return { ok: false, status: 409, error: "這一戶今年已經參加過這個活動了" };
  }

  const record = await prisma.$transaction(async (tx) => {
    const r = existing
      ? await tx.ritualRecord.update({
          where: { id: existing.id },
          data: { notes, templeEventId, status: "CONFIRMED", deletedAt: null },
        })
      : await tx.ritualRecord.create({
          data: {
            householdId,
            year: event.year,
            activityType: event.activityType,
            templeEventId,
            notes,
            status: "CONFIRMED",
            registrationSource: "ACTIVITY_PAGE",
          },
        });
    await recordVersion(
      { entityType: "RitualRecord", entityId: r.id, action: existing ? "UPDATE" : "CREATE", afterData: r, operatorName },
      tx
    );

    /**
     * V13.4 指令十八：所有建立 RitualRecord 的入口都必須同步寫入
     * RitualParticipant——上線後不得再產生「沒有 participant」的新資料。
     *
     * 活動頁參加名單原本只選家戶、不選成員。這裡的相容做法：
     *   有指定 memberIds → 寫入指定成員
     *   沒指定           → 預設納入戶長；沒有戶長就納入第一位成員
     * 使用者之後可在共用報名編輯器 /registration/[id] 調整成員。
     */
    let targetMemberIds = memberIds ?? [];
    if (targetMemberIds.length === 0) {
      const members = await tx.member.findMany({
        where: { householdId, deletedAt: null },
        select: { id: true, role: true },
        orderBy: { createdAt: "asc" },
      });
      const head = members.find((m) => m.role === "HOUSEHOLD_HEAD") ?? members[0];
      if (head) targetMemberIds = [head.id];
    }
    if (targetMemberIds.length > 0) {
      await upsertParticipantsInTransaction(tx, r.id, targetMemberIds, operatorName);
    }

    return r;
  });

  return { ok: true, data: { id: record.id } };
}

export async function removeGenericParticipant(
  id: string,
  operatorName?: string | null
): Promise<TempleEventResult<{ id: string }>> {
  const existing = await prisma.ritualRecord.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return { ok: false, status: 404, error: "找不到這筆參加資料" };

  await prisma.$transaction(async (tx) => {
    const updated = await tx.ritualRecord.update({ where: { id }, data: { status: "CANCELLED" } });
    await recordVersion(
      { entityType: "RitualRecord", entityId: id, action: "UPDATE", beforeData: existing, afterData: updated, changeNote: "移除參加名單", operatorName },
      tx
    );
  });

  return { ok: true, data: { id } };
}

// ============================================================
// 五、活動支出（TempleEventExpense，需求「四」✓建立支出）
// ============================================================

export type TempleEventExpenseInput = {
  category?: string | null;
  amount: number;
  occurredOn: Date;
  description?: string | null;
};

export async function listTempleEventExpenses(templeEventId: string) {
  return prisma.templeEventExpense.findMany({ where: { templeEventId }, orderBy: { occurredOn: "desc" } });
}

export async function addTempleEventExpense(
  templeEventId: string,
  input: TempleEventExpenseInput
): Promise<TempleEventResult<{ id: string }>> {
  const event = await prisma.templeEvent.findUnique({ where: { id: templeEventId } });
  if (!event) return { ok: false, status: 404, error: "找不到這個活動" };
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, status: 400, error: "請輸入正確的支出金額" };
  }

  const created = await prisma.templeEventExpense.create({
    data: {
      templeEventId,
      category: input.category ?? null,
      amount: input.amount,
      occurredOn: input.occurredOn,
      description: input.description ?? null,
    },
  });
  return { ok: true, data: { id: created.id } };
}

export async function removeTempleEventExpense(id: string): Promise<TempleEventResult<{ id: string }>> {
  const existing = await prisma.templeEventExpense.findUnique({ where: { id } });
  if (!existing) return { ok: false, status: 404, error: "找不到這筆支出資料" };
  await prisma.templeEventExpense.delete({ where: { id } });
  return { ok: true, data: { id } };
}

// ============================================================
// 六、活動 Checklist（需求「十一」）
// ============================================================

export async function seedChecklist(
  templeEventId: string,
  activityType: ActivityType,
  operatorName?: string | null
): Promise<void> {
  const existing = await prisma.templeEventChecklistItem.count({ where: { templeEventId } });
  if (existing > 0) return; // 已經 seed 過，不重複建立（例如重新整理頁面或重試呼叫）

  const labels = defaultChecklistLabels(activityType);
  await prisma.templeEventChecklistItem.createMany({
    data: labels.map((label, i) => ({ templeEventId, label, sortOrder: i })),
  });
  void operatorName; // Checklist 項目建立目前不寫入 RecordVersion（純粹是待辦清單，非正式業務資料）
}

export async function toggleChecklistItem(
  id: string,
  isDone: boolean,
  completedByName?: string | null
): Promise<TempleEventResult<{ id: string }>> {
  const existing = await prisma.templeEventChecklistItem.findUnique({ where: { id } });
  if (!existing) return { ok: false, status: 404, error: "找不到這個待辦項目" };

  await prisma.templeEventChecklistItem.update({
    where: { id },
    data: {
      isDone,
      completedAt: isDone ? new Date() : null,
      completedByName: isDone ? completedByName ?? null : null,
    },
  });
  return { ok: true, data: { id } };
}


/**
 * V13.3B：更新活動的寶袋預設單價。
 *
 * ⚠️ 只影響**之後新增**的寶袋——既有 AdditionalPrintItem 的 unitPrice
 * 是建立當下的快照，這裡絕不回頭重算（指令第六階段之 5、6）。
 *
 * 伺服器端再次驗證金額，不信任前端：
 *   - 必須是有限數字
 *   - 不得為負
 *   - 上限 999999，避免誤植
 * null 代表清除設定，讀取時會 fallback 到 DEFAULT_POCKET_UNIT_PRICE。
 */
export async function updateTempleEventPocketUnitPrice(
  eventId: string,
  pocketUnitPrice: number | null,
  operatorName?: string | null
): Promise<TempleEventResult<{ id: string; pocketUnitPrice: number }>> {
  const existing = await prisma.templeEvent.findUnique({ where: { id: eventId } });
  if (!existing) return { ok: false, status: 404, error: "找不到這個活動" };

  if (pocketUnitPrice !== null) {
    if (!Number.isFinite(pocketUnitPrice)) {
      return { ok: false, status: 400, error: "寶袋單價必須是數字" };
    }
    if (pocketUnitPrice < 0) {
      return { ok: false, status: 400, error: "寶袋單價不得小於 0" };
    }
    if (pocketUnitPrice > 999999) {
      return { ok: false, status: 400, error: "寶袋單價超出合理範圍，請確認是否輸入錯誤" };
    }
  }

  const before = existing.pocketUnitPrice ? Number(existing.pocketUnitPrice) : null;

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.templeEvent.update({
      where: { id: eventId },
      data: { pocketUnitPrice },
    });
    await recordVersion(
      {
        entityType: "TempleEvent",
        entityId: eventId,
        action: "UPDATE",
        beforeData: { pocketUnitPrice: before },
        afterData: { pocketUnitPrice },
        operatorName,
        changeNote:
          `修改寶袋年度預設單價：${before ?? "未設定"} → ${pocketUnitPrice ?? "未設定"} 元` +
          `（只影響之後新增的寶袋，既有寶袋金額不變）`,
      },
      tx
    );
    return after;
  });

  return {
    ok: true,
    data: {
      id: updated.id,
      pocketUnitPrice: resolvePocketUnitPrice(
        updated.pocketUnitPrice ? Number(updated.pocketUnitPrice) : null
      ),
    },
  };
}

/**
 * V14.1：中元普渡活動層的**贊普單價**（宮方每年設定一次）。
 *
 * 與寶袋單價（pocketUnitPrice）同一套模式，但**沒有 fallback 預設值**——
 * 贊普不得寫死金額；未設定時報名保留數量、擋住確認並顯示「尚未設定贊普單價」。
 * null 代表明確清除設定。回傳資料庫實際值（可為 null）。
 */
export async function updateTempleEventSponsorUnitPrice(
  eventId: string,
  sponsorUnitPrice: number | null,
  operatorName?: string | null
): Promise<TempleEventResult<{ id: string; sponsorUnitPrice: number | null }>> {
  const existing = await prisma.templeEvent.findUnique({ where: { id: eventId } });
  if (!existing) return { ok: false, status: 404, error: "找不到這個活動" };

  if (sponsorUnitPrice !== null) {
    if (!Number.isFinite(sponsorUnitPrice)) {
      return { ok: false, status: 400, error: "贊普單價必須是數字" };
    }
    if (sponsorUnitPrice < 0) {
      return { ok: false, status: 400, error: "贊普單價不得小於 0" };
    }
    if (sponsorUnitPrice > 999999) {
      return { ok: false, status: 400, error: "贊普單價超出合理範圍，請確認是否輸入錯誤" };
    }
  }

  const before = existing.sponsorUnitPrice ? Number(existing.sponsorUnitPrice) : null;

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.templeEvent.update({
      where: { id: eventId },
      data: { sponsorUnitPrice },
    });
    await recordVersion(
      {
        entityType: "TempleEvent",
        entityId: eventId,
        action: "UPDATE",
        beforeData: { sponsorUnitPrice: before },
        afterData: { sponsorUnitPrice },
        operatorName,
        changeNote: `修改贊普年度單價：${before ?? "未設定"} → ${sponsorUnitPrice ?? "未設定"} 元`,
      },
      tx
    );
    return after;
  });

  return {
    ok: true,
    data: {
      id: updated.id,
      sponsorUnitPrice: updated.sponsorUnitPrice ? Number(updated.sponsorUnitPrice) : null,
    },
  };
}

/**
 * V14.2：中元普渡「四類牌位」年度單價（宮方每年設定一次）。
 *
 * 與 sponsorUnitPrice 同一套 per-year 結構（都是 TempleEvent 上的可空 Decimal），
 * 不是第二套價格表。四個欄位分別對應超拔祖先／乙位正魂／累世冤親債主／無緣子女。
 * 每個欄位：null=清除（未設定），否則需為 0~999999 的數字。只影響之後新增或
 * 重新計算的 DRAFT 未收款項目；已確認／已收款是快照，不回頭改。
 */
export type TabletUnitPriceInput = {
  ancestorUnitPrice?: number | null;
  zhenghunUnitPrice?: number | null;
  yuanqinUnitPrice?: number | null;
  wuyuanUnitPrice?: number | null;
};

const TABLET_PRICE_LABELS: Record<keyof TabletUnitPriceInput, string> = {
  ancestorUnitPrice: "超拔祖先單價",
  zhenghunUnitPrice: "乙位正魂單價",
  yuanqinUnitPrice: "累世冤親債主單價",
  wuyuanUnitPrice: "無緣子女單價",
};

export async function updateTempleEventTabletPrices(
  eventId: string,
  input: TabletUnitPriceInput,
  operatorName?: string | null
): Promise<TempleEventResult<{ id: string } & TabletUnitPriceInput>> {
  const existing = await prisma.templeEvent.findUnique({ where: { id: eventId } });
  if (!existing) return { ok: false, status: 404, error: "找不到這個活動" };

  const data: TabletUnitPriceInput = {};
  for (const key of Object.keys(TABLET_PRICE_LABELS) as (keyof TabletUnitPriceInput)[]) {
    if (!(key in input)) continue; // 未帶的欄位不動
    const value = input[key];
    if (value !== null) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { ok: false, status: 400, error: `${TABLET_PRICE_LABELS[key]}必須是數字` };
      }
      if (value < 0) return { ok: false, status: 400, error: `${TABLET_PRICE_LABELS[key]}不得小於 0` };
      if (value > 999999) {
        return { ok: false, status: 400, error: `${TABLET_PRICE_LABELS[key]}超出合理範圍，請確認是否輸入錯誤` };
      }
    }
    data[key] = value;
  }
  if (Object.keys(data).length === 0) {
    return { ok: false, status: 400, error: "沒有要更新的單價欄位" };
  }

  const before: TabletUnitPriceInput = {
    ancestorUnitPrice: existing.ancestorUnitPrice ? Number(existing.ancestorUnitPrice) : null,
    zhenghunUnitPrice: existing.zhenghunUnitPrice ? Number(existing.zhenghunUnitPrice) : null,
    yuanqinUnitPrice: existing.yuanqinUnitPrice ? Number(existing.yuanqinUnitPrice) : null,
    wuyuanUnitPrice: existing.wuyuanUnitPrice ? Number(existing.wuyuanUnitPrice) : null,
  };

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.templeEvent.update({ where: { id: eventId }, data });
    await recordVersion(
      {
        entityType: "TempleEvent",
        entityId: eventId,
        action: "UPDATE",
        beforeData: before,
        afterData: data,
        operatorName,
        changeNote: "修改中元普渡四類牌位年度單價",
      },
      tx
    );
    return after;
  });

  return {
    ok: true,
    data: {
      id: updated.id,
      ancestorUnitPrice: updated.ancestorUnitPrice ? Number(updated.ancestorUnitPrice) : null,
      zhenghunUnitPrice: updated.zhenghunUnitPrice ? Number(updated.zhenghunUnitPrice) : null,
      yuanqinUnitPrice: updated.yuanqinUnitPrice ? Number(updated.yuanqinUnitPrice) : null,
      wuyuanUnitPrice: updated.wuyuanUnitPrice ? Number(updated.wuyuanUnitPrice) : null,
    },
  };
}
