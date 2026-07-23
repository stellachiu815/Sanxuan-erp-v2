import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { memberSearchOrConditions, householdSearchOrConditions } from "@/lib/devoteeSearchFields";
// V14.1（十七）：搜尋結果生日一律民國／農曆顯示，不顯示西元。
import { formatRocDateCompact, formatLunarBirthDate } from "@/lib/minguoDate";

/**
 * 首頁快速搜尋 API（V1.1 建立，V12.2 大幅強化）
 *
 * GET /api/search?operatorUserId=xxx&q=王昆郎
 *
 * V12.2「信眾建立與查詢中心」指令「四、提升首頁搜尋」＋「五、搜尋權限漏洞」
 * 對這支 API 的三項變更：
 *
 * 1. **補上權限檢查（安全修正）**：這支 API 原本完全沒有權限檢查，任何人
 *    都能直接呼叫並取得全站信眾姓名與家戶編號對照表。現在沿用既有的
 *    assertDevoteePermissionForOperator(..., "view")——跟信眾名單／全宮
 *    搜尋同一個權限動作，**不新增第二套登入或角色邏輯**。
 *    沒有帶 operatorUserId → 401；角色沒有 view 權限 → 403。
 *
 * 2. **搜尋欄位補齊**：原本只搜 5 個欄位（成員姓名／家戶編號／電話／地址／
 *    公司名稱），搜不到戶名與主要聯絡人。現在改用共用規格
 *    memberSearchOrConditions()／householdSearchOrConditions()，涵蓋指令
 *    「四」要求的九項，且與信眾名單、全宮搜尋共用同一份欄位定義
 *    （見 src/lib/devoteeSearchFields.ts），避免三套再次分歧。
 *
 * 3. **結果附上足以辨識的資訊**：原本刻意只回「姓名＋家戶編號」（V1.1 的
 *    設計），造成同名信眾在結果列表中無法區分。現在每一筆都附上所屬戶名、
 *    電話（個人手機優先）、地址摘要與生日，並且信眾結果直接指向
 *    /devotee-center/[memberId]，不再一律只能進家戶頁。
 */

/** 地址摘要：完整地址常常很長，列表只顯示前段，避免手機版換行破版。 */
function summarizeAddress(address: string | null): string | null {
  if (!address) return null;
  const trimmed = address.trim();
  if (trimmed.length <= 18) return trimmed;
  return `${trimmed.slice(0, 18)}…`;
}

export type QuickSearchResult = {
  /** DEVOTEE＝點進信眾詳情頁；HOUSEHOLD＝點進家戶頁 */
  kind: "DEVOTEE" | "HOUSEHOLD";
  memberId: string | null;
  householdId: string;
  name: string;
  householdName: string;
  phone: string | null;
  addressSummary: string | null;
  birthdayDisplay: string | null;
  /** 直接可用的跳轉目標，畫面不需要自己拼路由 */
  href: string;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const check = await assertDevoteePermissionForOperator(searchParams.get("operatorUserId"), "view");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const q = searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ results: [] });
  }

  const [memberMatches, householdMatches] = await Promise.all([
    // V8.0「刪除保護」：移入回收區的成員/家戶不應該還能被搜尋到。
    prisma.member.findMany({
      where: {
        deletedAt: null,
        household: { deletedAt: null },
        OR: memberSearchOrConditions(q),
      },
      select: {
        id: true,
        name: true,
        householdId: true,
        solarBirthDate: true,
        lunarBirthYear: true,
        lunarBirthMonth: true,
        lunarBirthDay: true,
        lunarIsLeapMonth: true,
        household: { select: { id: true, name: true, phone: true, mobile: true, address: true } },
        devoteeProfile: { select: { mobile: true } },
      },
      take: 20,
      orderBy: { name: "asc" },
    }),
    prisma.household.findMany({
      where: { deletedAt: null, OR: householdSearchOrConditions(q) },
      select: { id: true, name: true, contactName: true, phone: true, mobile: true, address: true },
      take: 20,
    }),
  ]);

  const results: QuickSearchResult[] = [];
  const seenMemberIds = new Set<string>();
  const householdsWithMemberHit = new Set<string>();

  for (const m of memberMatches) {
    if (seenMemberIds.has(m.id)) continue;
    seenMemberIds.add(m.id);
    householdsWithMemberHit.add(m.householdId);

    results.push({
      kind: "DEVOTEE",
      memberId: m.id,
      householdId: m.householdId,
      name: m.name,
      householdName: m.household.name,
      // 個人手機優先，其次家戶手機，再其次家戶市話——跟疑似重複比對對
      // 「電話」的定義一致。
      phone: m.devoteeProfile?.mobile || m.household.mobile || m.household.phone || null,
      addressSummary: summarizeAddress(m.household.address),
      birthdayDisplay: m.solarBirthDate
        ? formatRocDateCompact(m.solarBirthDate)
        : m.lunarBirthYear && m.lunarBirthMonth && m.lunarBirthDay
          ? formatLunarBirthDate(m.lunarBirthYear, m.lunarBirthMonth, m.lunarBirthDay, m.lunarIsLeapMonth)
          : null,
      // 指令「四」：點擊信眾結果優先進入信眾詳情頁。
      href: `/devotee-center/${m.id}`,
    });
  }

  for (const h of householdMatches) {
    // 這一戶已經有成員命中時就不再另外列一筆家戶，避免同一戶在結果裡
    // 出現兩次（既有行為就是用 seen 去重，這裡沿用同樣的思路）。
    if (householdsWithMemberHit.has(h.id)) continue;

    results.push({
      kind: "HOUSEHOLD",
      memberId: null,
      householdId: h.id,
      name: h.contactName || h.name,
      householdName: h.name,
      phone: h.mobile || h.phone || null,
      addressSummary: summarizeAddress(h.address),
      birthdayDisplay: null,
      href: `/household/${h.id}`,
    });
  }

  return NextResponse.json({ results: results.slice(0, 20) });
}
