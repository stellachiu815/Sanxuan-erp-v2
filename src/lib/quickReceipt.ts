import { prisma } from "@/lib/prisma";
import { createHousehold } from "@/lib/householdManagement";
import { createMemberForHousehold } from "@/lib/memberCreate";
import { createManualReceivable, createMergedPaymentTransaction } from "@/lib/collectionCenter";
import { issueReceipt } from "@/lib/receipt";

/**
 * 現場快速開感謝狀（收據）——一步到位。
 *
 * 把「捐獻(自由金額)＋活動繳款(未收款)」在一次動作內完成:
 *   1. 付款人:既有信眾或當場建新(姓名＋地址)。
 *   2. 捐獻類(油香/香/犒將/贊助/隨喜/其他)→ 各建一筆臨時應收(MANUAL)。
 *   3. 活動繳款→ 直接用該信眾的既有未收款(sourceType/sourceId)。
 *   4. 建立一筆收款(PaymentTransaction＋多筆 Allocation)。
 *   5. 對這筆收款「合併開立一張收據」。
 *   6. 回傳收據 id,前端直接跳列印。
 *
 * 全程重用既有、已驗證的收款/收據零件(createManualReceivable／
 * createMergedPaymentTransaction／issueReceipt),不建第二套金流。
 * 一張收據多行,每行(項目＋金額)在財務仍各自一筆,財務可分開計。
 */

export type QuickReceiptDonation = { name: string; amount: number };
export type QuickReceiptActivityLine = { sourceType: string; sourceId: string; amount: number; itemName?: string | null };
export type QuickReceiptPayer = {
  existingMemberId?: string | null;
  name?: string | null;
  address?: string | null;
  phone?: string | null;
};
export type QuickReceiptInput = {
  payer: QuickReceiptPayer;
  donations?: QuickReceiptDonation[];
  activityLines?: QuickReceiptActivityLine[];
  methodType?: string | null;
  methodNote?: string | null;
  bankName?: string | null;
  bankAccountLast5?: string | null;
  checkNumber?: string | null;
  year: number;
  idempotencyKey?: string | null;
};

export type QuickReceiptResult =
  | { ok: true; receiptId: string; receiptNumber: string | null; totalAmount: number }
  | { ok: false; status: number; error: string };

const s = (v: string | null | undefined): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
};
const pos = (n: unknown): number => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.round(Number(n)) : 0);

export async function quickIssueReceipt(
  input: QuickReceiptInput,
  operator: { id: string; name: string }
): Promise<QuickReceiptResult> {
  const donations = (input.donations ?? []).filter((d) => s(d.name) && pos(d.amount) > 0);
  const activityLines = (input.activityLines ?? []).filter((a) => s(a.sourceType) && s(a.sourceId) && pos(a.amount) > 0);
  if (donations.length === 0 && activityLines.length === 0) {
    return { ok: false, status: 400, error: "請至少加一個項目（捐獻或活動繳款）" };
  }

  // 1) 付款人：既有或當場建新。
  let payerMemberId: string;
  let payerHouseholdId: string;
  let payerName: string;
  let payerPhone: string | null = null;
  if (s(input.payer.existingMemberId)) {
    const m = await prisma.member.findFirst({
      where: { id: input.payer.existingMemberId as string, deletedAt: null },
      select: { id: true, name: true, householdId: true },
    });
    if (!m) return { ok: false, status: 404, error: "找不到選取的信眾（可能已被刪除）" };
    payerMemberId = m.id;
    payerHouseholdId = m.householdId;
    payerName = m.name;
  } else {
    const name = s(input.payer.name);
    if (!name) return { ok: false, status: 400, error: "請填付款人姓名，或先搜尋選一位信眾" };
    const surname = name.charAt(0);
    const hh = await createHousehold(
      { name: surname ? `${surname}家` : name, contactName: name, address: s(input.payer.address), phone: s(input.payer.phone) },
      operator.name
    );
    payerHouseholdId = hh.household.id;
    const mem = await createMemberForHousehold(
      payerHouseholdId,
      { name, isPrimaryContact: true, personalAddress: s(input.payer.address) },
      operator.name,
      "現場開立感謝狀：新增信眾"
    );
    payerMemberId = mem.member.id;
    payerName = name;
    payerPhone = s(input.payer.phone);
  }

  // 2) 捐獻 → 各建一筆臨時應收（MANUAL）。名稱→金額 對照表供收據行標示。
  type Alloc = { sourceType: string; sourceId: string; amount: number };
  const allocations: Alloc[] = [];
  const nameByKey = new Map<string, string>();
  for (const d of donations) {
    const title = s(d.name) as string;
    const amount = pos(d.amount);
    const r = await createManualReceivable({
      title,
      year: input.year,
      payerMemberId,
      payerHouseholdId,
      payerNameSnapshot: payerName,
      amountDue: amount,
      createdByName: operator.name,
    });
    if (!r.ok) return { ok: false, status: r.status ?? 400, error: r.error };
    allocations.push({ sourceType: "MANUAL", sourceId: r.data.id, amount });
    nameByKey.set(`MANUAL:${r.data.id}`, title);
  }

  // 3) 活動繳款：用信眾既有未收款來源。
  for (const a of activityLines) {
    const st = s(a.sourceType) as string;
    const sid = s(a.sourceId) as string;
    const amount = pos(a.amount);
    allocations.push({ sourceType: st, sourceId: sid, amount });
    nameByKey.set(`${st}:${sid}`, s(a.itemName ?? null) ?? "活動繳款");
  }

  const totalAmount = allocations.reduce((sum, x) => sum + x.amount, 0);
  const methodType = (["CASH", "BANK_TRANSFER", "MOBILE_PAYMENT", "CHECK", "OTHER"].includes(input.methodType ?? "")
    ? input.methodType
    : "CASH") as "CASH" | "BANK_TRANSFER" | "MOBILE_PAYMENT" | "CHECK" | "OTHER";

  // 4) 建立一筆收款。
  const pay = await createMergedPaymentTransaction(
    {
      paidOn: new Date(),
      totalAmount,
      methodType,
      methodNote: s(input.methodNote),
      bankName: s(input.bankName),
      bankAccountLast5: s(input.bankAccountLast5),
      checkNumber: s(input.checkNumber),
      payerMemberId,
      payerHouseholdId,
      payerNameSnapshot: payerName,
      payerPhoneSnapshot: payerPhone,
      collectedByName: operator.name,
      createdByName: operator.name,
      idempotencyKey: s(input.idempotencyKey),
      allocations,
    },
    operator.name
  );
  if (!pay.ok) return { ok: false, status: pay.status, error: pay.error };

  // 5) 取這筆收款的分配項目（含 id），開立一張合併收據。
  const created = await prisma.paymentAllocation.findMany({
    where: { paymentTransactionId: pay.data.id },
    select: { id: true, sourceType: true, sourceId: true, amount: true },
  });
  if (created.length === 0) return { ok: false, status: 500, error: "收款建立後找不到分配項目，請到收款紀錄確認" };

  const rec = await issueReceipt(
    {
      lines: created.map((c) => ({
        allocationId: c.id,
        amount: Number(c.amount),
        itemName: nameByKey.get(`${c.sourceType}:${c.sourceId}`) ?? undefined,
      })),
      receiptType: "MERGED",
      payerName,
      idempotencyKey: s(input.idempotencyKey) ? `${input.idempotencyKey}-rcpt` : null,
      createdByName: operator.name,
    },
    operator.name
  );
  if (!rec.ok) return { ok: false, status: rec.status, error: rec.error };

  return { ok: true, receiptId: rec.data.id, receiptNumber: rec.data.receiptNumber, totalAmount };
}
