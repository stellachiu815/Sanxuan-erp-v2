/**
 * V30.5 信眾「活動」分頁：某筆中元普渡報名（RitualRecord）的**完整報名明細**（唯讀）。
 *
 * 目的：信眾詳情頁目前只顯示「中元普渡｜年度｜金額｜收款狀態」，看不到實際報名內容。這裡把每一筆
 * 實際報名物件（牌位逐筆、白米、寶袋基本／額外、贊普…）攤平成可展開的明細列。**不建立第二套報名
 * 編輯流程**：編輯一律導向既有正式編輯頁 `/registration/[ritualRecordId]`。純讀取，不寫入。
 *
 * 規則：
 *  - 未收款但 CONFIRMED 仍顯示；0 元項目也顯示（不以金額過濾）。
 *  - 祖先／乙位／冤親／無緣**逐筆牌位**各一列（不合併）。
 *  - 白米顯示斤數；寶袋顯示 基本／額外、是否收費、指定名稱。
 *  - registrationOrder / registrationItemId 走 raw SQL（不依賴 client 是否 regenerate）。
 */
import { prisma } from "@/lib/prisma";
import { resolveYangshangNames } from "@/lib/yangshang";
import { displayDebtCreditorName } from "@/lib/debtCreditorName";
import { rowSection, pocketDisplay, pocketAmountDue, summarizeAmounts } from "@/lib/registrationDetailShape";

export type RegistrationDetailRow = {
  id: string;
  kind: "TABLET" | "RICE" | "SPONSOR" | "POCKET" | "OTHER";
  registrationOrder: number | null;
  itemName: string; // 報名項目正式名稱
  subject: string; // 牌位名稱／內容／認購人
  quantity: number;
  quantityUnit: string | null; // 白米＝斤
  yangshang: string[]; // 陽上人／報名者
  address: string | null; // 列印用地址
  amountDue: number;
  amountPaid: number;
  amountUnpaid: number;
  status: string; // 報名狀態
  printStatus: string; // 列印狀態
  printCount: number;
  lastPrintedAt: string | null;
  pocketKind: "BASIC" | "EXTRA" | null;
  chargeable: boolean | null;
  printName: string | null; // 寶袋指定名稱
  /** ACTIVE＝有效（CONFIRMED 進正式名單/列印）；DRAFT＝草稿（不進正式）；CANCELLED＝歷史。 */
  section: "ACTIVE" | "DRAFT" | "CANCELLED";
  missing: string[]; // DRAFT 缺漏原因（缺地址/缺陽上/缺牌位名）
};

export type RegistrationDetailSummary = {
  itemCount: number; // 報名項目總數（不含寶袋列印物件）
  printObjectCount: number; // 實際列印物件總數（牌位＋寶袋）
  amountDue: number;
  amountPaid: number;
  amountUnpaid: number;
  hasUnprintable: boolean; // 是否存在無法正式列印/仍草稿的資料
};

export type RegistrationDetail = {
  ritualRecordId: string;
  year: number;
  recordStatus: string;
  empty: boolean; // true＝有 record 但無任何報名物件 → 前端顯示「尚無報名項目」
  editHref: string; // 既有正式編輯頁（不建第二套）
  summary: RegistrationDetailSummary;
  rows: RegistrationDetailRow[];
};

const TABLET_KEYS = new Set(["US_ANCESTOR", "US_ZHENGHUN", "US_YUANQIN", "US_WUYUAN"]);

function printStatusText(printCount: number, printedAt: Date | null): string {
  if ((printCount ?? 0) <= 0 && !printedAt) return "未列印";
  if ((printCount ?? 0) <= 1) return "已列印";
  return `補印 ${printCount - 1} 次`;
}

export async function getUniversalSalvationRegistrationDetail(
  ritualRecordId: string
): Promise<RegistrationDetail | null> {
  const record = await prisma.ritualRecord.findFirst({
    where: { id: ritualRecordId, deletedAt: null, activityType: "UNIVERSAL_SALVATION" },
    select: { id: true, year: true, status: true },
  });
  if (!record) return null;

  // 1) 報名項目（排除寶袋 US_POCKET_EXTRA——寶袋改由列印物件呈現）。
  const items = await prisma.ritualRegistrationItem.findMany({
    where: { ritualRecordId, deletedAt: null, registrationItemType: { key: { not: "US_POCKET_EXTRA" } } },
    select: {
      id: true, quantity: true, amountDue: true, amountPaid: true, amountUnpaid: true, status: true,
      customName: true, printedAt: true, printCount: true, lastPrintedAt: true,
      registrationItemType: { select: { key: true, name: true, contentKind: true } },
      member: { select: { name: true } },
      universalSalvationEntry: { select: { displayName: true, tabletAddress: true, yangshangName: true, yangshangNames: true } },
    },
    orderBy: [{ registrationItemType: { sortOrder: "asc" } }, { createdAt: "asc" }],
  });

  // 2) 寶袋列印物件（基本＋額外）。
  const pockets = await prisma.additionalPrintItem.findMany({
    where: { ritualRecordId, deletedAt: null, itemType: "POCKET" },
    select: { id: true, printName: true, isExtra: true, isChargeable: true, quantity: true, status: true, printCount: true, printedAt: true, lastPrintedAt: true, subtotal: true, unitPrice: true },
    orderBy: [{ isExtra: "asc" }, { createdAt: "asc" }],
  });

  // 3) registrationOrder：item 直接取；pocket 經 registrationItemId 取自身 US_POCKET_EXTRA 順序（raw SQL）。
  const itemIds = items.map((i) => i.id);
  const itemOrder = itemIds.length
    ? await prisma.$queryRaw<{ id: string; ord: number | null }[]>`
        SELECT "id", "registrationOrder" AS ord FROM "ritual_registration_items" WHERE "id" = ANY(${itemIds})`
    : [];
  const itemOrderById = new Map(itemOrder.map((r) => [r.id, r.ord]));

  const pocketIds = pockets.map((p) => p.id);
  const pocketOrder = pocketIds.length
    ? await prisma.$queryRaw<{ id: string; ord: number | null }[]>`
        SELECT api."id", rri."registrationOrder" AS ord
        FROM "additional_print_items" api
        LEFT JOIN "ritual_registration_items" rri ON rri."id" = api."registrationItemId" AND rri."deletedAt" IS NULL
        WHERE api."id" = ANY(${pocketIds})`
    : [];
  const pocketOrderById = new Map(pocketOrder.map((r) => [r.id, r.ord]));

  const rows: RegistrationDetailRow[] = [];

  for (const it of items) {
    const key = it.registrationItemType.key;
    const kind: RegistrationDetailRow["kind"] = TABLET_KEYS.has(key)
      ? "TABLET"
      : it.registrationItemType.contentKind === "RICE"
        ? "RICE"
        : it.registrationItemType.contentKind === "SPONSOR"
          ? "SPONSOR"
          : "OTHER";
    const entry = it.universalSalvationEntry;
    const yang = entry ? resolveYangshangNames(entry.yangshangNames, entry.yangshangName) : [];
    const subject =
      key === "US_YUANQIN"
        ? displayDebtCreditorName(entry?.displayName ?? it.member?.name ?? "")
        : entry?.displayName ?? it.customName ?? it.member?.name ?? it.registrationItemType.name;
    // DRAFT 缺漏原因（僅牌位需地址/陽上/名稱；供畫面提示「草稿＋缺漏」）。
    const missing: string[] = [];
    if (kind === "TABLET") {
      if (!subject || !subject.trim()) missing.push("缺牌位名稱");
      if ((key === "US_ANCESTOR" || key === "US_ZHENGHUN") && !(entry?.tabletAddress ?? "").trim()) missing.push("缺地址");
      if ((key === "US_ANCESTOR" || key === "US_ZHENGHUN") && yang.length === 0) missing.push("缺陽上人");
    }
    rows.push({
      id: it.id,
      kind,
      registrationOrder: itemOrderById.get(it.id) ?? null,
      itemName: it.registrationItemType.name,
      subject,
      quantity: it.quantity,
      quantityUnit: kind === "RICE" ? "斤" : null,
      yangshang: yang.length > 0 ? yang : it.member?.name ? [it.member.name] : [],
      address: entry?.tabletAddress ?? null,
      amountDue: Number(it.amountDue),
      amountPaid: Number(it.amountPaid),
      amountUnpaid: Number(it.amountUnpaid),
      status: it.status,
      printStatus: printStatusText(it.printCount ?? 0, it.printedAt),
      printCount: it.printCount ?? 0,
      lastPrintedAt: (it.lastPrintedAt ?? it.printedAt)?.toISOString() ?? null,
      pocketKind: null,
      chargeable: null,
      printName: null,
      section: rowSection(it.status),
      missing,
    });
  }

  for (const p of pockets) {
    const pd = pocketDisplay(p.isExtra, p.isChargeable);
    const due = pocketAmountDue(p.isChargeable, Number(p.subtotal ?? 0));
    rows.push({
      id: p.id,
      kind: "POCKET",
      registrationOrder: pocketOrderById.get(p.id) ?? null,
      itemName: pd.itemName,
      subject: p.printName,
      quantity: p.quantity,
      quantityUnit: null,
      yangshang: [],
      address: null,
      amountDue: due,
      amountPaid: 0,
      amountUnpaid: due,
      status: p.status,
      printStatus: printStatusText(p.printCount ?? 0, p.printedAt),
      printCount: p.printCount ?? 0,
      lastPrintedAt: (p.lastPrintedAt ?? p.printedAt)?.toISOString() ?? null,
      pocketKind: pd.kind,
      chargeable: p.isChargeable,
      printName: p.printName,
      section: rowSection(p.status),
      missing: [],
    });
  }

  const amounts = summarizeAmounts(rows);
  const summary: RegistrationDetailSummary = {
    itemCount: items.length,
    printObjectCount: pockets.length + items.filter((i) => TABLET_KEYS.has(i.registrationItemType.key)).length,
    amountDue: amounts.amountDue,
    amountPaid: amounts.amountPaid,
    amountUnpaid: amounts.amountUnpaid,
    hasUnprintable: rows.some((r) => r.section === "DRAFT" || r.missing.length > 0),
  };

  return {
    ritualRecordId: record.id,
    year: record.year,
    recordStatus: record.status,
    empty: rows.length === 0,
    editHref: `/registration/${record.id}`,
    summary,
    rows,
  };
}
