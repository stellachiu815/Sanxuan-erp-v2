/**
 * V30.6 中元普渡「上線前檢查」共用資料層（唯讀）。
 *
 * 供三處共用同一份判斷（不建第二套）：CLI 腳本、唯讀 API、系統管理唯讀頁。
 * 只 SELECT，不寫入、不修復。列出某年度中元普渡所有「無法正式使用」的資料。
 */
import { prisma } from "@/lib/prisma";
import { isAmountAnomaly } from "@/lib/preLaunchRules";

export type PreLaunchCategory =
  | "空 RitualRecord" | "DRAFT record" | "DRAFT item" | "孤兒 entry（無 item）"
  | "牌位 item 缺 entry" | "缺列印地址" | "缺陽上人" | "缺牌位名稱" | "缺基本寶袋"
  | "寶袋缺 registrationItemId" | "registrationOrder 缺失" | "registrationOrder 重複"
  | "重複報名 item" | "金額異常" | "已取消歷史資料" | "已刪除仍有應收";

export type PreLaunchFinding = {
  category: PreLaunchCategory;
  household: string;
  subject: string;
  recordId: string | null;
  entryId: string | null;
  itemId: string | null;
  createdAt: string | null;
  reason: string;
  action: string;
  memberId: string | null; // 供頁面「前往查看」
};

const TABLET_KEYS = new Set(["US_ANCESTOR", "US_ZHENGHUN", "US_YUANQIN", "US_WUYUAN"]);
const ADDRESS_CATS = new Set(["ANCESTOR_LINE", "INDIVIDUAL_SOUL"]);

export async function runUniversalSalvationPreLaunchCheck(year: number): Promise<PreLaunchFinding[]> {
  const findings: PreLaunchFinding[] = [];
  const push = (f: PreLaunchFinding) => findings.push(f);

  const records = await prisma.ritualRecord.findMany({
    where: { activityType: "UNIVERSAL_SALVATION", year, deletedAt: null },
    select: {
      id: true, status: true, createdAt: true,
      household: { select: { name: true } },
      registrationItems: {
        where: { deletedAt: null },
        select: {
          id: true, status: true, quantity: true, memberId: true, createdAt: true,
          amountDue: true, amountPaid: true, amountUnpaid: true, universalSalvationEntryId: true,
          registrationItemType: { select: { key: true, name: true } },
          member: { select: { id: true, name: true } },
        },
      },
      universalSalvation: {
        select: { entries: { where: { deletedAt: null }, select: { id: true, category: true, displayName: true, tabletAddress: true, yangshangName: true, yangshangNames: true, createdAt: true } } },
      },
    },
  });
  const recordIds = records.map((r) => r.id);

  const orderRows = recordIds.length
    ? await prisma.$queryRaw<{ id: string; ord: number | null }[]>`
        SELECT rri."id", rri."registrationOrder" AS ord FROM "ritual_registration_items" rri
        WHERE rri."ritualRecordId" = ANY(${recordIds}) AND rri."deletedAt" IS NULL`
    : [];
  const orderById = new Map(orderRows.map((r) => [r.id, r.ord]));

  const pockets = recordIds.length
    ? await prisma.$queryRaw<{ id: string; sourceEntryId: string; isExtra: boolean; regId: string | null; household: string; recordId: string }[]>`
        SELECT api."id", api."sourceEntryId", api."isExtra", api."registrationItemId" AS "regId", h."name" AS household, rr."id" AS "recordId"
        FROM "additional_print_items" api
        JOIN "ritual_records" rr ON rr."id" = api."ritualRecordId"
        JOIN "households" h ON h."id" = rr."householdId"
        WHERE rr."id" = ANY(${recordIds}) AND api."deletedAt" IS NULL AND api."itemType" = 'POCKET'`
    : [];
  const basicPocketSourceIds = new Set(pockets.filter((p) => !p.isExtra).map((p) => p.sourceEntryId));

  for (const rec of records) {
    const hh = rec.household.name;
    if (rec.status === "DRAFT") push({ category: "DRAFT record", household: hh, subject: "—", recordId: rec.id, entryId: null, itemId: null, createdAt: rec.createdAt.toISOString(), reason: "主報名停在 DRAFT", action: "內容完整並通過驗證後確認（修復腳本 dry-run）", memberId: null });
    if (rec.registrationItems.length === 0) push({ category: "空 RitualRecord", household: hh, subject: "—", recordId: rec.id, entryId: null, itemId: null, createdAt: rec.createdAt.toISOString(), reason: "有 record 但無任何報名項目", action: "確認是否需實際報名；否則保留為參加名單", memberId: null });

    for (const it of rec.registrationItems) {
      const key = it.registrationItemType.key;
      const subj = `${it.registrationItemType.name}｜${it.member?.name ?? "—"}`;
      const mid = it.member?.id ?? null;
      const due = Number(it.amountDue), paid = Number(it.amountPaid), un = Number(it.amountUnpaid);

      // 已取消：只列歷史提醒，**不**做完整度／金額／取號／重複等正式資料檢查。
      // 取消後 amountUnpaid=0 是正確狀態，即使保留原 amountDue 也不屬異常。
      if (it.status === "CANCELLED") {
        push({ category: "已取消歷史資料", household: hh, subject: subj, recordId: rec.id, entryId: it.universalSalvationEntryId, itemId: it.id, createdAt: it.createdAt.toISOString(), reason: "CANCELLED 項目（正式名單/列印/統計已排除；僅歷史提醒）", action: "無需處理；如需追查取消原因可查版本紀錄", memberId: mid });
        // 已取消但仍有未收（異常財務殘留，非取消正常狀態）才提醒；amountUnpaid=0 不提醒。
        if (un > 0) push({ category: "已刪除仍有應收", household: hh, subject: subj, recordId: rec.id, entryId: null, itemId: it.id, createdAt: it.createdAt.toISOString(), reason: "已取消但未收 > 0", action: "交收款/財務核對", memberId: mid });
        continue;
      }

      if (it.status === "DRAFT") push({ category: "DRAFT item", household: hh, subject: subj, recordId: rec.id, entryId: it.universalSalvationEntryId, itemId: it.id, createdAt: it.createdAt.toISOString(), reason: "項目停在 DRAFT，不進正式名單/列印/統計", action: "通過 validateForConfirm 後確認（修復腳本 B）", memberId: mid });
      if (TABLET_KEYS.has(key) && !it.universalSalvationEntryId) push({ category: "牌位 item 缺 entry", household: hh, subject: subj, recordId: rec.id, entryId: null, itemId: it.id, createdAt: it.createdAt.toISOString(), reason: "牌位項目未連結 entry", action: "人工確認，不可自動猜測", memberId: mid });
      if (orderById.get(it.id) == null) push({ category: "registrationOrder 缺失", household: hh, subject: subj, recordId: rec.id, entryId: it.universalSalvationEntryId, itemId: it.id, createdAt: it.createdAt.toISOString(), reason: "尚未取號", action: "活動已歸屬者用 applyRegistrationOrder 補號（修復腳本 C）", memberId: mid });
      if (isAmountAnomaly(it.status, due, paid, un)) push({ category: "金額異常", household: hh, subject: subj, recordId: rec.id, entryId: null, itemId: it.id, createdAt: it.createdAt.toISOString(), reason: `應收 ${due}／已收 ${paid}／未收 ${un} 不一致或為負`, action: "交收款/財務人工核對，本輪不改金額", memberId: mid });
    }

    // 重複報名 item：**排除已取消**（取消保留原位不算重複）。
    const dup = new Map<string, number>();
    for (const it of rec.registrationItems) {
      if (it.status === "CANCELLED") continue;
      const k = `${it.registrationItemType.key}::${it.memberId ?? ""}`;
      dup.set(k, (dup.get(k) ?? 0) + 1);
    }
    for (const [k, n] of dup) if (n > 1) push({ category: "重複報名 item", household: hh, subject: k, recordId: rec.id, entryId: null, itemId: null, createdAt: null, reason: `同項目同成員 ${n} 筆`, action: "人工確認；牌位多筆內容應以 entry 表達", memberId: null });

    const linkedEntryIds = new Set(rec.registrationItems.map((i) => i.universalSalvationEntryId).filter(Boolean));
    for (const e of rec.universalSalvation?.entries ?? []) {
      const yang = e.yangshangNames?.length ? e.yangshangNames : e.yangshangName ? [e.yangshangName] : [];
      if (!e.displayName?.trim()) push({ category: "缺牌位名稱", household: hh, subject: e.category, recordId: rec.id, entryId: e.id, itemId: null, createdAt: e.createdAt.toISOString(), reason: "牌位 displayName 空白", action: "補牌位姓名", memberId: null });
      if (ADDRESS_CATS.has(e.category) && !e.tabletAddress?.trim()) push({ category: "缺列印地址", household: hh, subject: `${e.category}｜${e.displayName}`, recordId: rec.id, entryId: e.id, itemId: null, createdAt: e.createdAt.toISOString(), reason: "牌位缺 tabletAddress", action: "補地址", memberId: null });
      if (ADDRESS_CATS.has(e.category) && yang.length === 0) push({ category: "缺陽上人", household: hh, subject: `${e.category}｜${e.displayName}`, recordId: rec.id, entryId: e.id, itemId: null, createdAt: e.createdAt.toISOString(), reason: "牌位缺陽上人", action: "補陽上人", memberId: null });
      if (!linkedEntryIds.has(e.id)) push({ category: "孤兒 entry（無 item）", household: hh, subject: `${e.category}｜${e.displayName}`, recordId: rec.id, entryId: e.id, itemId: null, createdAt: e.createdAt.toISOString(), reason: "有 entry 但無有效 item", action: "冤親可唯一 RESTORE（修復腳本 A）；其他人工確認", memberId: null });
      if (!basicPocketSourceIds.has(e.id)) push({ category: "缺基本寶袋", household: hh, subject: `${e.category}｜${e.displayName}`, recordId: rec.id, entryId: e.id, itemId: null, createdAt: e.createdAt.toISOString(), reason: "牌位缺對應基本寶袋列印物件", action: "由既有牌位建立流程補", memberId: null });
    }
  }

  for (const p of pockets) if (!p.regId) push({ category: "寶袋缺 registrationItemId", household: p.household, subject: p.isExtra ? "額外寶袋" : "基本寶袋", recordId: p.recordId, entryId: p.sourceEntryId, itemId: p.id, createdAt: null, reason: "POCKET 未連結 US_POCKET_EXTRA 報名項目（作業號碼會缺）", action: "由既有寶袋建立流程補；舊資料不誤用牌位號", memberId: null });

  const dupOrder = recordIds.length
    ? await prisma.$queryRaw<{ typeId: string; ord: number; n: number }[]>`
        SELECT rri."registrationItemTypeId" AS "typeId", rri."registrationOrder" AS ord, COUNT(*)::int AS n
        FROM "ritual_registration_items" rri JOIN "ritual_records" rr ON rr."id" = rri."ritualRecordId"
        WHERE rr."id" = ANY(${recordIds}) AND rri."deletedAt" IS NULL AND rri."registrationOrder" IS NOT NULL AND rri."templeEventId" IS NOT NULL
        GROUP BY rri."templeEventId", rri."registrationItemTypeId", rri."registrationOrder" HAVING COUNT(*) > 1`
    : [];
  for (const d of dupOrder) push({ category: "registrationOrder 重複", household: "—", subject: `type=${d.typeId}`, recordId: null, entryId: null, itemId: null, createdAt: null, reason: `同活動同項目 registrationOrder=${d.ord} 出現 ${d.n} 次`, action: "人工確認（unique index 應防止）", memberId: null });

  return findings;
}

/** 依分類彙總（供頁面/腳本共用）。 */
export function summarizePreLaunch(findings: PreLaunchFinding[]): { category: string; count: number }[] {
  const m = new Map<string, number>();
  for (const f of findings) m.set(f.category, (m.get(f.category) ?? 0) + 1);
  return [...m.entries()].map(([category, count]) => ({ category, count }));
}
