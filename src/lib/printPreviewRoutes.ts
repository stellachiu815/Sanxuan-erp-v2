/**
 * V21.1 正式列印預覽對照表（Preview Mapping）。
 *
 * 唯一權威來源：每一種列印物件 → 它「真正的正式列印模板」路由。
 * 規則：
 *  - 預覽內容必須與最後真正列印完全一致（同一份正式版型、正式資料）。
 *  - 不得導向任何「管理頁」（例如 /print-center 首頁彙總）。
 *  - 不得共用錯誤模板；不得為了預覽新建第二套模板（一律沿用既有列印頁）。
 *
 * 對照（依 contentKind／itemKey）：
 *   牌位   TABLET       → 家戶牌位 A4 正式列印頁（/household/[id]/rituals/universal-salvation/print）
 *   寶袋   POCKET       → 牌位／寶袋列印物件中心（/universal-salvation/[year]/print-center，系統唯一含寶袋版型處）
 *   年度燈 LANTERN      → 年度燈燈牌／疏文列印頁（/lantern/[activityType]/print）
 *   祭改   PURIFICATION → 小人頭貼紙正式列印頁（/purification/[templeEventId]/print，沿用承載該年度祭改的 TempleEvent）
 *   白米   RICE         → 名冊列印頁（/print-center/rosters/US_RICE/[year]，此頁本身即正式版型）
 *   贊普   SPONSOR      → 名冊列印頁（/print-center/rosters/US_SPONSOR/[year]）
 *   名冊   ROSTER 等     → 名冊列印頁（/print-center/rosters/[itemKey]/[year]）
 *
 * 名冊列印頁（rosters/[itemKey]/[year]）本身即為白米／贊普／名冊類型的正式列印版型
 * （print:block 內容＝實際印出內容），故該類型 isRosterItself=true。
 */

/** 年度燈：報名項目 itemKey → 燈別列印路由所需的 activityType。 */
const LANTERN_ITEMKEY_TO_ACTIVITY: Record<string, string> = {
  LANTERN_GUANGMING: "GUANGMING_LANTERN",
  LANTERN_TAISUI: "TAISUI_LANTERN",
  LANTERN_FAMILY: "FAMILY_LANTERN",
  DRAGON_PHOENIX: "DRAGON_PHOENIX_LANTERN",
};

export type PreviewTarget = {
  /** 正式列印模板路由（可直接開啟預覽＝實際列印）。 */
  href: string;
  /** UI 標籤（例：牌位正式版型）。 */
  label: string;
  /**
   * 名冊列印頁本身即為此類型的正式版型（白米／贊普／名冊）。
   * 若為 true，代表目前若已在名冊頁，不需再另開別的模板。
   */
  isRosterItself: boolean;
};

export function previewRouteForPrintObject(input: {
  itemKey: string;
  contentKind: string | null | undefined;
  householdId?: string | null;
  /** 承載此報名的 TempleEvent id（祭改正式列印頁需用）。 */
  templeEventId?: string | null;
  year: number | string;
}): PreviewTarget {
  const kind = (input.contentKind ?? "").toUpperCase();
  const rosterHref = `/print-center/rosters/${input.itemKey}/${input.year}`;

  // 祭改：小人頭貼紙正式列印頁，沿用承載該年度祭改的 TempleEvent（新架構＝年度燈 ANNUAL_LANTERN，
  // 舊架構＝獨立 PURIFICATION 事件），不建第二套路由、不新增第二套資料。
  if (kind === "PURIFICATION") {
    if (input.templeEventId) {
      return { href: `/purification/${input.templeEventId}/print`, label: "祭改小人頭正式版型", isRosterItself: false };
    }
    return { href: rosterHref, label: "名冊", isRosterItself: true };
  }

  // 牌位：家戶牌位 A4 正式版型頁（實際會印出來的牌位版型）。
  if (kind === "TABLET") {
    if (input.householdId) {
      return {
        href: `/household/${input.householdId}/rituals/universal-salvation/print`,
        label: "牌位正式版型",
        isRosterItself: false,
      };
    }
    return { href: rosterHref, label: "名冊", isRosterItself: true };
  }

  // 寶袋：牌位／寶袋列印物件中心（系統唯一含寶袋正式版型之處）。
  if (kind === "POCKET") {
    return {
      href: `/universal-salvation/${input.year}/print-center`,
      label: "寶袋正式版型",
      isRosterItself: false,
    };
  }

  // 年度燈：燈牌／疏文正式列印頁。
  if (kind === "LANTERN") {
    const activity = LANTERN_ITEMKEY_TO_ACTIVITY[input.itemKey];
    if (activity) {
      return { href: `/lantern/${activity}/print`, label: "年度燈正式版型", isRosterItself: false };
    }
  }

  // 白米／贊普／名冊（RICE／SPONSOR／ROSTER 及其他）：名冊列印頁本身即正式版型。
  return { href: rosterHref, label: "名冊", isRosterItself: true };
}
