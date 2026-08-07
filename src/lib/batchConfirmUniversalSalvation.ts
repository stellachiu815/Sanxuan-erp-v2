import { prisma } from "@/lib/prisma";
import { confirmRegistration } from "@/lib/activityRegistration";
import { upsertParticipantsInTransaction } from "@/lib/ritualParticipants";

/**
 * V38 一鍵批次確認：把某年度「有內容但還停在草稿」的普渡報名一次確認轉正式。
 *
 * 明細：每筆列出報名內容（祖先/正魂/冤親/無緣、白米、贊普、寶袋）＋報名成員數，方便核對。
 * 缺報名成員（匯入早期沒帶到）：**自動帶入該戶戶長**當報名成員，讓它能確認（明細會標示帶入誰）。
 * 只確認「有任一報名項目」的；完全沒項目的略過。已收款／已列印不影響。已封存家戶排除。
 * commit=false 預覽、true 才執行。
 */

const CAT_LABEL: Record<string, string> = { ANCESTOR_LINE: "祖先", INDIVIDUAL_SOUL: "乙位正魂", DEBT_CREDITOR: "冤親", UNBORN_CHILD: "無緣/地基主" };
const CONTENT_ITEM_KEYS = new Set(["US_ANCESTOR", "US_ZHENGHUN", "US_YUANQIN", "US_WUYUAN", "US_RICE", "US_SPONSOR", "US_SPONSOR_DONATION", "US_POCKET_EXTRA"]);

export type BatchConfirmRow = {
  ritualRecordId: string;
  householdId: string;
  householdName: string | null;
  summary: string;
  participantCount: number;
  willAddParticipant: string | null;
  canConfirm: boolean;
  reason: string | null;
  confirmed?: boolean;
};
export type BatchConfirmReport = {
  ok: boolean;
  commit: boolean;
  year: number;
  totalDraft: number;
  confirmable: number;
  confirmed: number;
  rows: BatchConfirmRow[];
};

export async function batchConfirmUniversalSalvation(
  year: number,
  opts: { commit: boolean; operatorName: string | null }
): Promise<BatchConfirmReport> {
  const commit = !!opts.commit;
  const records = await prisma.ritualRecord.findMany({
    where: { activityType: "UNIVERSAL_SALVATION", year, status: "DRAFT", deletedAt: null, household: { deletedAt: null } },
    select: {
      id: true,
      householdId: true,
      household: {
        select: {
          name: true,
          members: { where: { deletedAt: null }, select: { id: true, name: true, isPrimaryContact: true, isDeceased: true }, orderBy: { createdAt: "asc" } },
        },
      },
      participants: { where: { deletedAt: null }, select: { id: true } },
      universalSalvation: { select: { entries: { where: { deletedAt: null }, select: { category: true } } } },
      registrationItems: { where: { deletedAt: null, status: { not: "CANCELLED" } }, select: { quantity: true, registrationItemType: { select: { key: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows: BatchConfirmRow[] = [];
  let confirmed = 0;

  for (const r of records) {
    const entries = r.universalSalvation?.entries ?? [];
    const items = r.registrationItems ?? [];
    // 內容明細
    const catCount: Record<string, number> = {};
    for (const e of entries) catCount[e.category] = (catCount[e.category] ?? 0) + 1;
    const parts: string[] = [];
    for (const [c, n] of Object.entries(catCount)) parts.push(`${CAT_LABEL[c] ?? c}×${n}`);
    for (const it of items) {
      const k = it.registrationItemType.key;
      if (k === "US_RICE") parts.push(`白米${it.quantity}斤`);
      else if (k === "US_SPONSOR") parts.push(`贊普×${it.quantity}`);
      else if (k === "US_SPONSOR_DONATION") parts.push("大額贊普");
      else if (k === "US_POCKET_EXTRA") parts.push(`寶袋×${it.quantity}`);
    }
    const summary = parts.join("、") || "（無項目）";

    const hasContent = entries.length > 0 || items.some((it) => CONTENT_ITEM_KEYS.has(it.registrationItemType.key));
    const hasParticipant = r.participants.length > 0;
    const members = r.household?.members ?? [];
    const primary = members.find((m) => m.isPrimaryContact && !m.isDeceased) ?? members.find((m) => !m.isDeceased) ?? members[0] ?? null;

    let canConfirm = true;
    let reason: string | null = null;
    let willAdd: string | null = null;
    if (!hasContent) {
      canConfirm = false;
      reason = "沒有任何報名項目";
    } else if (!hasParticipant) {
      if (primary) willAdd = primary.name; // 會自動帶入戶長當報名成員
      else { canConfirm = false; reason = "此戶查無成員可帶入報名成員"; }
    }

    const row: BatchConfirmRow = {
      ritualRecordId: r.id,
      householdId: r.householdId,
      householdName: r.household?.name ?? null,
      summary,
      participantCount: r.participants.length,
      willAddParticipant: willAdd,
      canConfirm,
      reason,
    };

    if (commit && canConfirm) {
      if (!hasParticipant && primary) {
        await prisma.$transaction((tx) => upsertParticipantsInTransaction(tx, r.id, [primary.id], opts.operatorName));
      }
      const c = await confirmRegistration(r.id, opts.operatorName);
      row.confirmed = c.ok;
      if (c.ok) confirmed += 1;
      else { row.canConfirm = false; row.reason = c.error; }
    }

    rows.push(row);
  }

  return {
    ok: true,
    commit,
    year,
    totalDraft: records.length,
    confirmable: rows.filter((x) => x.canConfirm).length,
    confirmed,
    rows,
  };
}
