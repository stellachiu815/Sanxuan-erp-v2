/**
 * V38「現場快速報名」——一頁三步的後端服務。
 *
 * 目的（Stella 8/6 定案）：現場信眾來報名時，宮務人員一頁幾個欄位、一鍵完成，
 * 不再卡在舊手動流程的痛點：
 *   1. 陽上人不必是既有成員——直接打名字即可（新家戶不再卡住）。
 *   2. 報名成員自動帶「報名人」——不再「確認報名按不下去」。
 *   3. 地址依規則自動帶：冤親＝報名人個人地址；祖先／乙位正魂＝各自的安奉地。
 *
 * 實作原則：**完全重用既有、已驗證的函式**（createHousehold／createMemberForHousehold／
 * registerActivity／createUniversalSalvationEntry／registerRice／syncSponsorItemInTx／
 * confirmRegistration），不另建第二套報名系統。與 Excel 匯入 CREATE 路徑同一組零件。
 */
import { prisma } from "@/lib/prisma";
import { createHousehold } from "@/lib/householdManagement";
import { createMemberForHousehold } from "@/lib/memberCreate";
import { registerActivity } from "@/lib/activityRegistration";
import { confirmRegistration } from "@/lib/activityRegistration";
import { createUniversalSalvationEntry } from "@/lib/ritual";
import { registerRice } from "@/lib/whiteRiceService";
import { addSponsorItemInTx } from "@/lib/registrationItemRegistration";
import { createAdditionalPrintItem } from "@/lib/additionalPrintItems";
import { getUniversalSalvationSponsorPrice } from "@/lib/universalSalvationTabletPricing";
import { normalizeYangshangNames } from "@/lib/yangshang";
import { composeDevoteeSummary, DEVOTEE_SUMMARY_INCLUDE } from "@/lib/devoteeProfile";
import type { Role } from "@/lib/permissions";

/** 報名人（信眾）——既有就帶 existingMemberId，否則用姓名等欄位當場建立。 */
export type QuickRegRegistrant = {
  /** 既有信眾：直接用這位（不再新建）。 */
  existingMemberId?: string | null;
  /** 新信眾：姓名（existingMemberId 為空時必填）。 */
  name?: string | null;
  /** 個人地址（新信眾寫入 Member.address；也是冤親牌位地址來源）。 */
  address?: string | null;
  /** 生日（選填，沿用現有信眾生日欄位）。 */
  birthdayType?: "SOLAR" | "LUNAR" | null;
  solarBirthDate?: string | null;
  lunarBirthYear?: number | null;
  lunarBirthMonth?: number | null;
  lunarBirthDay?: number | null;
  lunarIsLeapMonth?: boolean | null;
};

/** 祖先／乙位正魂：各自的姓名（祖先＝姓，正魂＝往生者姓名）＋陽上人＋安奉地。 */
export type QuickRegNamedTablet = {
  displayName: string;
  yangshangNames?: string[];
  /** 安奉地（牌位放哪寫哪；非住家地址）。 */
  tabletAddress?: string | null;
  /** 增加寶袋：份數（沿用本牌位名稱印）。掛在「這一張」牌位下。 */
  extraPocketQty?: number | null;
  /** 增加寶袋：指定姓名（每個姓名各一份）。掛在「這一張」牌位下。 */
  extraPocketNames?: string[] | null;
};

/** 無緣子女／本宅地基主（同一類，主文可選）。 */
export type QuickRegUnbornTablet = {
  /** 主文：「無緣子女」或「本宅地基主」。 */
  mainText: "無緣子女" | "本宅地基主";
  yangshangNames?: string[];
  tabletAddress?: string | null;
};

export type QuickRegInput = {
  templeEventId: string;
  registrant: QuickRegRegistrant;
  /** 歷代祖先（可多筆）。 */
  ancestors?: QuickRegNamedTablet[];
  /** 乙位正魂（可多筆）。 */
  individualSouls?: QuickRegNamedTablet[];
  /** 累世冤親債主：勾了才建；陽上人預設＝報名人；地址＝報名人個人地址。 */
  creditor?: { include: boolean; yangshangNames?: string[] } | null;
  /** 無緣子女／地基主（可多筆）。 */
  unborn?: QuickRegUnbornTablet[];
  /** 白米斤數。 */
  riceKg?: number | null;
  /** 白米認購人名稱（可填公司名；留空＝用報名人姓名）。 */
  riceName?: string | null;
  /** 整戶寶袋份數（公開頁「增加寶袋」；掛在最後一張牌位下）。 */
  pocketQty?: number | null;
  /** 贊普數量（固定價）。 */
  sponsorQty?: number | null;
  /** 贊普認購人名稱（可填公司名；留空＝用報名人姓名）。 */
  sponsorName?: string | null;
  /** 隨喜贊普金額（自由）。 */
  donationAmount?: number | null;
  /** 隨喜贊普認購人名稱（可填公司名；留空＝用報名人姓名）。 */
  donationName?: string | null;
  /** 送出後是否立即確認（草稿→正式）；失敗則保留草稿並回報原因。 */
  confirm?: boolean;
};

export type QuickRegResult =
  | {
      ok: true;
      householdId: string;
      memberId: string;
      ritualRecordId: string;
      year: number;
      confirmed: boolean;
      /** confirm 失敗時的原因（草稿仍保留，可到報名頁補齊後再確認）。 */
      confirmError?: string | null;
      createdTablets: number;
    }
  | { ok: false; status: number; error: string };

function s(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

/**
 * 現場快速報名主流程。與匯入 CREATE 路徑同一組零件，順序：
 * 解析活動 → 家戶／信眾 → registerActivity（record＋報名成員＋普渡明細）→ 各類牌位 → 白米 → 贊普 → 隨喜 →（選）確認。
 */
export async function quickRegister(
  input: QuickRegInput,
  operator: { id: string; name: string; role: Role }
): Promise<QuickRegResult> {
  // ── 1. 解析活動（必須是普渡） ──
  const event = await prisma.templeEvent.findUnique({ where: { id: input.templeEventId } });
  if (!event) return { ok: false, status: 404, error: "找不到這個活動" };
  if (event.activityType !== "UNIVERSAL_SALVATION") {
    return { ok: false, status: 400, error: "現場快速報名目前只支援中元普渡活動" };
  }
  const year = event.year;

  // ── 2. 家戶／信眾（報名人） ──
  let householdId: string;
  let memberId: string;
  let registrantAddress: string | null = s(input.registrant.address);
  // V38 修正：報名人姓名——選既有信眾時表單不會另送 name，要用該成員的姓名，
  //   否則冤親／無緣的陽上人預設值（＝報名人）會變空白（陽上人「叩薦」不見）。
  let registrantName: string | null = s(input.registrant.name);

  if (input.registrant.existingMemberId) {
    const m = await prisma.member.findFirst({
      where: { id: input.registrant.existingMemberId, deletedAt: null },
      select: { id: true, householdId: true, address: true, name: true },
    });
    if (!m) return { ok: false, status: 404, error: "找不到選取的信眾（可能已被刪除）" };
    memberId = m.id;
    householdId = m.householdId;
    // 冤親地址優先用本人個人地址；表單另填的地址次之。
    registrantAddress = (m as unknown as { address: string | null }).address ?? registrantAddress;
    // 選既有信眾 → 報名人姓名＝該成員姓名（供陽上人預設）。
    if (!registrantName) registrantName = m.name;
  } else {
    const name = s(input.registrant.name);
    if (!name) return { ok: false, status: 400, error: "請輸入報名人姓名" };
    // V38：新家戶戶名沿用既有規格「{姓}家」（例：許佩瑜→許家），與 Excel 匯入一致；
    //   聯絡人仍存本人全名。姓＝姓名第一個字（複姓少見，現場可事後於家戶頁改名）。
    const surname = name.charAt(0);
    const householdName = surname ? `${surname}家` : name;
    const hh = await createHousehold(
      { name: householdName, contactName: name, address: registrantAddress },
      operator.name
    );
    householdId = hh.household.id;
    const mem = await createMemberForHousehold(
      householdId,
      {
        name,
        isPrimaryContact: true,
        personalAddress: registrantAddress,
        birthdayType: input.registrant.birthdayType ?? undefined,
        solarBirthDate: input.registrant.solarBirthDate ?? undefined,
        lunarBirthYear: input.registrant.lunarBirthYear ?? undefined,
        lunarBirthMonth: input.registrant.lunarBirthMonth ?? undefined,
        lunarBirthDay: input.registrant.lunarBirthDay ?? undefined,
        lunarIsLeapMonth: input.registrant.lunarIsLeapMonth ?? undefined,
      },
      operator.name,
      "現場快速報名：新增信眾"
    );
    memberId = mem.member.id;
  }

  // ── 3. 成立報名（RitualRecord＋報名成員自動帶報名人＋普渡明細） ──
  const reg = await registerActivity({
    templeEventId: input.templeEventId,
    householdId,
    memberIds: [memberId],
    source: "ACTIVITY_PAGE",
    operatorName: operator.name,
  });
  if (!reg.ok) return { ok: false, status: reg.status, error: reg.error };
  const ritualRecordId = reg.ritualRecordId;

  // ── 4. 各類牌位（各自 createUniversalSalvationEntry；會連動計價 item） ──
  let createdTablets = 0;
  const yang = (arr?: string[]): string[] => normalizeYangshangNames(arr ?? []);
  const defaultYang = (arr?: string[]): string[] => {
    const y = yang(arr);
    return y.length > 0 ? y : registrantName ? [registrantName] : [];
  };

  // 把「增加寶袋」掛到某一類別「剛建立的那一張」牌位下（份數沿用牌位名稱；指定姓名各一份）。
  // 依序建立，故該類別 createdAt 最新的一筆＝剛建的這張。回傳錯誤字串（成功回 null）。
  const attachPockets = async (
    category: "ANCESTOR_LINE" | "INDIVIDUAL_SOUL",
    qtyRaw?: number | null,
    namesRaw?: string[] | null
  ): Promise<string | null> => {
    const names = (namesRaw ?? []).map((n) => (n ?? "").trim()).filter(Boolean);
    const qty = Math.floor(Number(qtyRaw ?? 0));
    if (names.length === 0 && qty <= 0) return null;
    const e = await prisma.universalSalvationEntry.findFirst({
      where: { universalSalvation: { ritualRecordId }, category, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!e) return null; // 理論上剛建過，不會發生
    for (const name of names) {
      const p = await createAdditionalPrintItem(
        householdId, year, e.id,
        { itemType: "POCKET", usesSourceName: false, customPrintName: name, quantity: 1, isExtra: true, isChargeable: true },
        operator.name
      );
      if (!p.ok) return `增加寶袋（${name}）：${p.error}`;
    }
    if (qty > 0) {
      const p = await createAdditionalPrintItem(
        householdId, year, e.id,
        { itemType: "POCKET", usesSourceName: true, quantity: qty, isExtra: true, isChargeable: true },
        operator.name
      );
      if (!p.ok) return `增加寶袋：${p.error}`;
    }
    return null;
  };

  try {
    // 4a 歷代祖先：安奉地各自填；同步進家戶永久名單。
    for (const a of input.ancestors ?? []) {
      const displayName = s(a.displayName);
      if (!displayName) continue;
      const r = await createUniversalSalvationEntry(
        householdId,
        year,
        {
          category: "ANCESTOR_LINE",
          displayName,
          yangshangNames: defaultYang(a.yangshangNames),
          tabletAddress: s(a.tabletAddress),
          syncToHousehold: true,
        },
        operator.name
      );
      if (!r.ok) return { ok: false, status: r.status, error: `歷代祖先：${r.error}` };
      createdTablets += 1;
      const pErr = await attachPockets("ANCESTOR_LINE", a.extraPocketQty, a.extraPocketNames);
      if (pErr) return { ok: false, status: 400, error: `歷代祖先「${displayName}」的${pErr}` };
    }

    // 4b 乙位正魂：安奉地各自填；同步進家戶永久名單；連結報名人成員。
    for (const soul of input.individualSouls ?? []) {
      const displayName = s(soul.displayName);
      if (!displayName) continue;
      const r = await createUniversalSalvationEntry(
        householdId,
        year,
        {
          category: "INDIVIDUAL_SOUL",
          displayName,
          yangshangNames: defaultYang(soul.yangshangNames),
          tabletAddress: s(soul.tabletAddress),
          linkedItemMemberId: memberId,
          syncToHousehold: true,
        },
        operator.name
      );
      if (!r.ok) return { ok: false, status: r.status, error: `乙位正魂：${r.error}` };
      createdTablets += 1;
      const pErr = await attachPockets("INDIVIDUAL_SOUL", soul.extraPocketQty, soul.extraPocketNames);
      if (pErr) return { ok: false, status: 400, error: `乙位正魂「${displayName}」的${pErr}` };
    }

    // 4c 累世冤親債主：主文固定；地址＝報名人個人地址；陽上人預設＝報名人。
    if (input.creditor?.include) {
      const r = await createUniversalSalvationEntry(
        householdId,
        year,
        {
          category: "DEBT_CREDITOR",
          displayName: "累世冤親債主",
          yangshangNames: defaultYang(input.creditor.yangshangNames),
          tabletAddress: registrantAddress,
          linkedItemMemberId: memberId,
        },
        operator.name
      );
      if (!r.ok) return { ok: false, status: r.status, error: `累世冤親債主：${r.error}` };
      createdTablets += 1;
    }

    // 4d 無緣子女／本宅地基主：主文可選；陽上人預設＝報名人。
    for (const u of input.unborn ?? []) {
      const mainText = u.mainText === "本宅地基主" ? "本宅地基主" : "無緣子女";
      const r = await createUniversalSalvationEntry(
        householdId,
        year,
        {
          category: "UNBORN_CHILD",
          displayName: mainText,
          yangshangNames: defaultYang(u.yangshangNames),
          tabletAddress: s(u.tabletAddress) ?? registrantAddress,
          linkedItemMemberId: memberId,
        },
        operator.name
      );
      if (!r.ok) return { ok: false, status: r.status, error: `${mainText}：${r.error}` };
      createdTablets += 1;
    }
  } catch (e) {
    return { ok: false, status: 500, error: `建立牌位時發生錯誤：${(e as Error).message}` };
  }

  // ── 4c. 整戶寶袋（公開頁「增加寶袋」用）：掛在剛建立的最後一張牌位下（份數沿用牌位名稱）。 ──
  const topPocketQty = Math.floor(Number(input.pocketQty ?? 0));
  if (topPocketQty > 0) {
    const anyEntry = await prisma.universalSalvationEntry.findFirst({
      where: { universalSalvation: { ritualRecordId }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (anyEntry) {
      const p = await createAdditionalPrintItem(
        householdId, year, anyEntry.id,
        { itemType: "POCKET", usesSourceName: true, quantity: topPocketQty, isExtra: true, isChargeable: true },
        operator.name
      );
      if (!p.ok) return { ok: false, status: 500, error: `增加寶袋：${p.error}` };
    }
    // 沒有任何牌位時略過（寶袋需掛在牌位下）；公開頁會提示需先報一張牌位。
  }

  // ── 5. 白米 ──
  if (input.riceKg && input.riceKg > 0) {
    const rice = await registerRice(
      { ritualRecordId, memberId, kg: input.riceKg, customName: s(input.riceName) ?? null, overageReason: null },
      { role: operator.role, userId: operator.id, name: operator.name }
    );
    if (!rice.ok) return { ok: false, status: rice.status, error: `白米：${rice.error}` };
  }

  // ── 6. 贊普（固定價）／隨喜贊普（自由金額）：同一 tx 內同步 ──
  const sponsorQty = Math.floor(Number(input.sponsorQty ?? 0));
  const donationAmount = Math.max(0, Math.round(Number(input.donationAmount ?? 0)));
  if (sponsorQty > 0 || donationAmount > 0) {
    const yearSponsorPrice = await getUniversalSalvationSponsorPrice(year);
    try {
      await prisma.$transaction(async (tx) => {
        // V38：現場快速報名每個認購人各自一筆（append），不合併、不蓋掉既有認購人。
        if (sponsorQty > 0) {
          await addSponsorItemInTx(tx, {
            ritualRecordId,
            itemKey: "US_SPONSOR",
            pricing: { mode: "FIXED", quantity: sponsorQty, fixedUnitPrice: yearSponsorPrice },
            customName: s(input.sponsorName) ?? registrantName,
            status: "DRAFT",
          });
        }
        if (donationAmount > 0) {
          await addSponsorItemInTx(tx, {
            ritualRecordId,
            itemKey: "US_SPONSOR_DONATION",
            pricing: { mode: "FREE", amount: donationAmount },
            customName: s(input.donationName) ?? registrantName,
            status: "DRAFT",
          });
        }
      });
    } catch (e) {
      return { ok: false, status: 500, error: `贊普：${(e as Error).message}` };
    }
  }

  // ── 7.（選）立即確認：失敗則保留草稿並回報原因 ──
  let confirmed = false;
  let confirmError: string | null = null;
  if (input.confirm) {
    const c = await confirmRegistration(ritualRecordId, operator.name);
    if (c.ok) confirmed = true;
    else confirmError = c.error;
  }

  return {
    ok: true,
    householdId,
    memberId,
    ritualRecordId,
    year,
    confirmed,
    confirmError,
    createdTablets,
  };
}

/** 現場報名的信眾查詢（輕量）：回傳可選的既有信眾清單。 */
/**
 * 現場快速報名：查既有信眾。V41 起除了姓名／家戶／地址，另回傳「現場核對用」資料：
 * 農曆生日、虛歲、生肖（皆由 composeDevoteeSummary 即時計算，不另存）。供各活動報名表
 * 選到既有信眾後，唯讀顯示讓宮務人員當場跟信眾核對姓名／歲數／農曆生日／地址。
 */
export async function quickRegSearchDevotees(
  q: string
): Promise<{
  memberId: string;
  name: string;
  householdId: string;
  householdName: string;
  address: string | null;
  lunarBirthDisplay: string | null;
  nominalAge: number | null;
  zodiac: string | null;
  solarBirthDate: string | null;
}[]> {
  const query = q.trim();
  if (!query) return [];
  const members = await prisma.member.findMany({
    where: {
      deletedAt: null,
      household: { deletedAt: null },
      name: { contains: query },
    },
    include: DEVOTEE_SUMMARY_INCLUDE,
    take: 20,
    orderBy: { createdAt: "desc" },
  });
  return members.map((m) => {
    const sum = composeDevoteeSummary(m);
    return {
      memberId: sum.memberId,
      name: sum.name,
      householdId: sum.householdId,
      householdName: sum.householdName,
      // 個人地址優先 → 家戶地址（與原本 fallback 行為一致）。
      address: sum.displayAddress,
      lunarBirthDisplay: sum.lunarBirthDisplay,
      nominalAge: sum.nominalAge,
      zodiac: sum.zodiac,
      solarBirthDate: sum.solarBirthDate,
    };
  });
}
