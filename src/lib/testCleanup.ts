// V40「測試資料清理」後端（src/app/system-center/test-cleanup）。
//
// 目的：把「測試期間」建立的資料，透過瀏覽器一頁清乾淨，操作者不需要動終端機、
// 也不需要我直接連正式資料庫。三種清理都採「先預覽、確認後才寫入」，且盡量用
// 交易（$transaction）包起來——任何一步出錯就整筆回滾，不會清一半。清理前請務必
// 先在「系統管理→備份」按「立即備份」，那是唯一的還原保險。
//
// 三個工具：
//   1. 測試活動刪除 deleteTestEvent：硬刪一個 TempleEvent，連同它底下所有報名紀錄
//      （RitualRecord 及其子資料：參加者／報名項目／祭改／全家燈成員／加印／普渡明細／
//      燈別登記）、公開報名表與其填單、供品/清單/支出等一併清掉。因為 RitualRecord→
//      活動是 SetNull（刪活動只會斷開不會刪紀錄）、祭改是必填會擋刪、公開報名表沒建
//      FK，所以這裡照順序手動清，最後才刪活動。刪掉後該「活動類型＋年度」的名額會
//      釋放，可以重新建立。
//   2. 測試感謝狀刪除 deleteTestReceipt：硬刪一張收據鏈（收據→收款交易→其連動的人工
//      應收 ManualReceivable），讓測試的感謝狀連同它的收款、應收數字一起消失。
//   3. 家戶封存沿用既有 archiveHousehold（軟刪除、可還原），不在這支檔案重寫。

import { prisma } from "@/lib/prisma";
import { previewHouseholdArchive } from "@/lib/householdManagement";

// ── 型別 ─────────────────────────────────────────────
export type CleanupEventRow = {
  id: string;
  activityType: string;
  year: number;
  isArchived: boolean;
  createdAt: string;
  recordCount: number;
  publicFormCount: number;
};

export type CleanupReceiptRow = {
  id: string;
  receiptNumber: string | null;
  payerName: string;
  status: string;
  amount: number;
  createdAt: string;
};

export type CleanupHouseholdRow = {
  id: string;
  name: string;
  code: string | null;
  memberCount: number;
  createdAt: string;
};

export type CleanupListing = {
  events: CleanupEventRow[];
  receipts: CleanupReceiptRow[];
  households: CleanupHouseholdRow[];
};

const toIso = (d: Date) => d.toISOString();

// ── 一、清單：列出「最近建立」的活動／感謝狀／家戶，供人工辨識挑選 ──────────
export async function listTestCleanupData(limit = 40): Promise<CleanupListing> {
  const [events, receipts, households] = await Promise.all([
    prisma.templeEvent.findMany({
      where: { isArchived: false },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, activityType: true, year: true, isArchived: true, createdAt: true },
    }),
    prisma.receipt.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        receiptNumber: true,
        payerName: true,
        status: true,
        createdAt: true,
        paymentTransaction: { select: { totalAmount: true } },
      },
    }),
    prisma.household.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, name: true, createdAt: true, _count: { select: { members: true } } },
    }),
  ]);

  const eventIds = events.map((e) => e.id);
  // RitualRecord 是正式 Prisma 模型可用 groupBy；public_reg_forms 是 raw SQL 表（client 無此模型），改用原生查詢。
  const recCounts = eventIds.length
    ? await prisma.ritualRecord.groupBy({ by: ["templeEventId"], where: { templeEventId: { in: eventIds } }, _count: { _all: true } })
    : [];
  const formCounts = eventIds.length
    ? await prisma.$queryRawUnsafe<{ templeEventId: string; n: number }[]>(
        `SELECT "templeEventId", COUNT(*)::int AS n FROM "public_reg_forms" WHERE "templeEventId" = ANY($1::text[]) GROUP BY "templeEventId"`,
        eventIds
      )
    : [];
  const recMap = new Map<string, number>();
  for (const r of recCounts) if (r.templeEventId) recMap.set(r.templeEventId, r._count._all);
  const formMap = new Map<string, number>();
  for (const f of formCounts) formMap.set(f.templeEventId, Number(f.n));

  return {
    events: events.map((e) => ({
      id: e.id,
      activityType: e.activityType,
      year: e.year,
      isArchived: e.isArchived,
      createdAt: toIso(e.createdAt),
      recordCount: recMap.get(e.id) ?? 0,
      publicFormCount: formMap.get(e.id) ?? 0,
    })),
    receipts: receipts.map((r) => ({
      id: r.id,
      receiptNumber: r.receiptNumber,
      payerName: r.payerName,
      status: r.status,
      amount: Number(r.paymentTransaction?.totalAmount ?? 0),
      createdAt: toIso(r.createdAt),
    })),
    households: households.map((h) => ({
      id: h.id,
      name: h.name,
      code: h.id, // 家戶編號就是 id（例如 F00009）
      memberCount: h._count.members,
      createdAt: toIso(h.createdAt),
    })),
  };
}

// ── 二、測試活動刪除（硬刪＋級聯，交易包覆） ─────────────────────────────
export type DeleteEventReport = {
  eventId: string;
  activityType: string;
  year: number;
  records: number;
  publicForms: number;
  publicRegistrations: number;
  committed: boolean;
};

export async function deleteTestEvent(eventId: string, commit: boolean): Promise<DeleteEventReport> {
  const ev = await prisma.templeEvent.findUnique({
    where: { id: eventId },
    select: { id: true, activityType: true, year: true },
  });
  if (!ev) throw new Error("找不到這個活動（可能已被刪除）");

  const recordIds = (await prisma.ritualRecord.findMany({ where: { templeEventId: eventId }, select: { id: true } })).map((r) => r.id);
  // public_reg_forms／public_registrations 是 raw SQL 表（client 無此模型）。
  const formIds = (
    await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "public_reg_forms" WHERE "templeEventId" = $1`, eventId)
  ).map((f) => f.id);
  const regCount = formIds.length
    ? Number(
        (
          await prisma.$queryRawUnsafe<{ n: number }[]>(
            `SELECT COUNT(*)::int AS n FROM "public_registrations" WHERE "formId" = ANY($1::text[])`,
            formIds
          )
        )[0]?.n ?? 0
      )
    : 0;

  const report: DeleteEventReport = {
    eventId: ev.id,
    activityType: ev.activityType,
    year: ev.year,
    records: recordIds.length,
    publicForms: formIds.length,
    publicRegistrations: regCount,
    committed: false,
  };

  if (!commit) return report;

  await prisma.$transaction(async (tx) => {
    // 公開報名表沒有建 FK，先清它的填單、再清表本身（raw SQL 表）。
    if (formIds.length) {
      await tx.$executeRawUnsafe(`DELETE FROM "public_registrations" WHERE "formId" = ANY($1::text[])`, formIds);
      await tx.$executeRawUnsafe(`DELETE FROM "public_reg_forms" WHERE "id" = ANY($1::text[])`, formIds);
    }
    // 刪 RitualRecord → 級聯清掉所有子資料（參加者／報名項目／祭改＋收款／全家燈＋成員／
    // 加印／普渡明細＋entries／燈別登記）。祭改是必填掛在紀錄底下，會一起被清。
    if (recordIds.length) {
      await tx.ritualRecord.deleteMany({ where: { id: { in: recordIds } } });
    }
    // 最後刪活動本身 → 級聯清掉活動層級（禁用號碼／清單項目／支出／供品／花壇位／爐主登記）。
    // FinanceRecord／列印批次是 SetNull，會保留但斷開，不影響財務正確性。
    await tx.templeEvent.delete({ where: { id: eventId } });
  });

  report.committed = true;
  return report;
}

// ── 三、測試感謝狀（收據鏈）刪除（硬刪，交易包覆） ───────────────────────
export type DeleteReceiptReport = {
  receiptId: string;
  receiptNumber: string | null;
  payerName: string;
  amount: number;
  manualReceivables: number;
  committed: boolean;
};

export async function deleteTestReceipt(receiptId: string, commit: boolean): Promise<DeleteReceiptReport> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: {
      id: true,
      receiptNumber: true,
      payerName: true,
      paymentTransactionId: true,
      paymentTransaction: {
        select: {
          totalAmount: true,
          allocations: { select: { manualReceivableId: true } },
        },
      },
    },
  });
  if (!receipt) throw new Error("找不到這張感謝狀（可能已被刪除）");

  const manualIds = Array.from(
    new Set(
      (receipt.paymentTransaction?.allocations ?? [])
        .map((a) => a.manualReceivableId)
        .filter((x): x is string => !!x)
    )
  );

  const report: DeleteReceiptReport = {
    receiptId: receipt.id,
    receiptNumber: receipt.receiptNumber,
    payerName: receipt.payerName,
    amount: Number(receipt.paymentTransaction?.totalAmount ?? 0),
    manualReceivables: manualIds.length,
    committed: false,
  };

  if (!commit) return report;

  await prisma.$transaction(async (tx) => {
    // 順序：先刪收據（級聯收據明細行）→ 再刪收款交易（級聯收款分配）→ 最後刪連動的人工應收。
    // 收據→交易是 Restrict，所以一定要先刪收據；明細行→分配也是 Restrict，收據級聯清掉明細行後才能刪分配。
    await tx.receipt.delete({ where: { id: receiptId } });
    await tx.paymentTransaction.delete({ where: { id: receipt.paymentTransactionId } });
    if (manualIds.length) {
      await tx.manualReceivable.deleteMany({ where: { id: { in: manualIds } } });
    }
  });

  report.committed = true;
  return report;
}

// ── 四、測試家戶封存（軟刪成員＋軟封存家戶，皆可還原） ─────────────────────
// 既有 archiveHousehold 要求「在戶成員為 0」才能封存；測試加戶通常還有你建立的成員，
// 所以這裡先把成員一併軟刪（deletedAt，可還原）、再軟封存家戶，全部包在一個交易裡。
// 注意：若這個家戶還有「未完成(草稿)活動」或「未收款」，仍會被擋——請先用上面的
// 「測試活動刪除」把測試活動清掉，草稿與應收就會跟著消失，家戶才封得掉。
export type ArchiveHouseholdReport = {
  householdId: string;
  name: string;
  memberCount: number;
  blockers: string[];
  canArchive: boolean;
  committed: boolean;
};

export async function archiveTestHousehold(
  householdId: string,
  commit: boolean,
  operatorName: string | null
): Promise<ArchiveHouseholdReport> {
  const hh = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!hh) throw new Error("找不到這個家戶（可能已封存或已刪除）");

  const preview = await previewHouseholdArchive(householdId);
  // 「在戶成員」不算阻擋——我們會一併軟刪；只保留草稿活動／未收款這類真正該先處理的阻擋。
  const blockers = preview.blockers.filter((b) => !b.includes("在戶成員"));
  const canArchive = blockers.length === 0;

  const report: ArchiveHouseholdReport = {
    householdId: hh.id,
    name: hh.name,
    memberCount: preview.activeMemberCount,
    blockers,
    canArchive,
    committed: false,
  };

  if (!commit) return report;
  if (!canArchive) throw new Error(`目前無法封存：${blockers.join("；")}`);

  await prisma.$transaction(async (tx) => {
    await tx.member.updateMany({
      where: { householdId, deletedAt: null },
      data: { deletedAt: new Date(), deletedByName: operatorName },
    });
    await tx.household.update({
      where: { id: householdId },
      data: { deletedAt: new Date(), deletedByName: operatorName },
    });
  });

  report.committed = true;
  return report;
}
