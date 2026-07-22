"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, use as usePromise } from "react";
import { useSearchParams } from "next/navigation";
import { OperatorProvider, useOperator } from "@/lib/operatorClient";
import { canDevotee } from "@/lib/permissions";
import OperatorBar from "@/components/system/OperatorBar";
import DevoteeCenterGate from "@/components/devotee/DevoteeCenterGate";
import DevoteeCompletenessCard from "@/components/devotee/DevoteeCompletenessCard";
import ChangeHouseholdModal from "@/components/devotee/ChangeHouseholdModal";
import { checkDevoteeDataQuality, type QualityIssue } from "@/lib/devoteeDataQuality";
import { DEVOTEE_INTERACTION_TYPE_LABEL } from "@/components/devotee/labels";
import { memberRoleOptions, memberRoleLabel, birthHourOptions, worshipTypeOptions } from "@/lib/labels";
// V13.2：性別選項與生日輸入都共用既有元件，不維護第二套。
import { GENDER_OPTIONS } from "@/lib/genderNormalize";
import DeceasedFollowUpDialog from "@/components/devotee/DeceasedFollowUpDialog";
import NewActivityRegistrationDialog from "@/components/devotee/NewActivityRegistrationDialog";
// V13.4 驗收：國曆生日一律以民國長格式顯示，唯一來源在 minguoDate。
import { formatIsoDateToMinguoLong } from "@/lib/minguoDate";
import BirthdayField, {
  createEmptyBirthdayValue,
  type BirthdayValue,
} from "@/components/birthday/BirthdayField";

type Overview = {
  basic: {
    memberId: string;
    householdId: string;
    name: string;
    gender: string | null;
    role: string;
    isPrimaryContact: boolean;
    solarBirthDate: string | null;
    lunarBirthDisplay: string | null;
    lunarBirthYear: number | null;
    lunarBirthMonth: number | null;
    lunarBirthDay: number | null;
    lunarIsLeapMonth: boolean;
    birthHour: string | null;
    // V13.1 生日／生肖模組：由 composeDevoteeSummary() 依生日即時計算，
    // 資料庫不儲存。沒有有效生日資料時三者皆為 null。
    zodiac: string | null;
    actualAge: number | null;
    nominalAge: number | null;
    isDeceased: boolean;
    deceasedAt: string | null;
    memberNotes: string | null;
    isDisabled: boolean;
    mobile: string | null;
    lineId: string | null;
    email: string | null;
    companyName: string | null;
    personalNote: string | null;
    careFlag: boolean;
    householdName: string;
    householdPhone: string | null;
    householdAddress: string | null;
  };
  household: {
    id: string;
    name: string;
    contactName: string | null;
    phone: string | null;
    address: string | null;
    members: { memberId: string; name: string; role: string; isPrimaryContact: boolean; isDeceased: boolean }[];
    worshipRecords: { id: string; type: string; displayName: string; location: string | null; yangshangName: string | null; notes: string | null }[];
  };
  tags: { assignmentId: string; tagId: string; name: string; isActive: boolean }[];
  rituals: { ritualRecordId: string; activityName: string; year: number; amount: number; paymentStatus: string; receiptNumbers: string[] }[];
  purifications: { entryId: string; year: number; amount: number; paymentStatus: string; receiptNumbers: string[] }[];
  offerings: { claimId: string; year: number; offeringName: string; amount: number; paymentStatus: string; receiptNumbers: string[]; isCollected: string }[];
  payments: { transactionId: string; transactionNo: string; paidOn: string; items: string; totalAmount: number; status: string }[];
  receipts: { receiptId: string; receiptNumber: string | null; issuedDate: string; amount: number; status: string }[];
  donationStats: {
    thisYearTotal: { received: number; due: number; unpaid: number };
    allTimeTotal: { received: number; due: number; unpaid: number };
    byCategory: Record<string, { thisYear: { received: number; due: number; unpaid: number }; allTime: { received: number; due: number; unpaid: number }; hasData: boolean }>;
    note: string;
  };
  activityStats: { firstActivityAt: string | null; lastActivityAt: string | null; totalCount: number; last1YearCount: number; inactiveOver1Year: boolean };
  timeline: { date: string; type: string; description: string }[];
  interactions: { id: string; interactionType: string; occurredAt: string; content: string; followUp: string | null; nextContactDate: string | null; createdByName: string | null }[];
};

const TABS = ["總覽", "時間軸", "活動", "收款", "收據", "供品", "祭祀與祭改", "家戶成員", "互動紀錄"] as const;

function DevoteeDetailInner({ memberId }: { memberId: string }) {
  const { operatorUserId, operatorUser } = useOperator();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("總覽");
  const [reloadTick, setReloadTick] = useState(0);

  // 對應指令「七、上一位／下一位」：q／filters 是從信眾名單頁點進來時網址
  // 帶的參數（見 list/page.tsx 的 detailQueryString），維持在同一個篩選
  // 範圍內移動，見 src/lib/devoteeList.ts getAdjacentDevoteeIds() 的說明。
  const urlParams = useSearchParams();
  const listQueryString = urlParams.toString(); // 原封不動轉送給 neighbors API 跟 上一位/下一位連結
  const [neighbors, setNeighbors] = useState<{ prevMemberId: string | null; nextMemberId: string | null } | null>(null);
  const [showChangeHousehold, setShowChangeHousehold] = useState(false);

  useEffect(() => {
    if (!operatorUserId) return;
    fetch(`/api/devotee-center/${memberId}?operatorUserId=${encodeURIComponent(operatorUserId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "載入失敗");
        return res.json();
      })
      .then((d) => {
        setOverview(d.overview);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [operatorUserId, memberId, reloadTick]);

  useEffect(() => {
    if (!operatorUserId) return;
    const params = new URLSearchParams(listQueryString);
    params.set("operatorUserId", operatorUserId);
    fetch(`/api/devotee-center/${memberId}/neighbors?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => setNeighbors(d))
      .catch(() => setNeighbors(null));
  }, [operatorUserId, memberId, listQueryString]);

  if (error) return <div className="rounded-3xl bg-blossom-100 p-6 text-sm text-ink">{error}</div>;
  if (!overview) return <p className="text-sm text-ink-faint">載入中…</p>;

  const b = overview.basic;
  const detailHref = (id: string) => `/devotee-center/${id}${listQueryString ? `?${listQueryString}` : ""}`;
  // V12.5 指令五：更換家戶背後是 transferMember 權限（V12.3 起 STAFF 沒有）。
  // 前端隱藏只是體驗優化，真正把關在 /api/households/members/transfer。
  const canChangeHousehold = operatorUser?.role
    ? canDevotee(operatorUser.role, "transferMember")
    : false;

  return (
    <div className="flex flex-col gap-6">
      {/* 對應指令「七、上一位／下一位」：方便連續完成資料補登，不用每次都
          回列表再點下一位。找不到上一位/下一位（例如已經是名單頭尾）時
          按鈕會停用。 */}
      {neighbors && (neighbors.prevMemberId || neighbors.nextMemberId) && (
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/70 px-4 py-2 text-sm shadow-soft">
          {neighbors.prevMemberId ? (
            <Link href={detailHref(neighbors.prevMemberId)} className="rounded-full bg-cream-100 px-4 py-1.5 text-ink-soft hover:bg-cream-200">
              ← 上一位
            </Link>
          ) : (
            <span className="rounded-full bg-cream-100 px-4 py-1.5 text-ink-faint opacity-40">← 上一位</span>
          )}
          <span className="text-xs text-ink-faint">依目前名單排序移動</span>
          {neighbors.nextMemberId ? (
            <Link href={detailHref(neighbors.nextMemberId)} className="rounded-full bg-cream-100 px-4 py-1.5 text-ink-soft hover:bg-cream-200">
              下一位 →
            </Link>
          ) : (
            <span className="rounded-full bg-cream-100 px-4 py-1.5 text-ink-faint opacity-40">下一位 →</span>
          )}
        </div>
      )}
      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg text-ink">
              {b.name}
              {b.isDeceased && <span className="ml-2 rounded-full bg-cream-300 px-2 py-0.5 text-xs">已往生</span>}
              {b.isDisabled && <span className="ml-2 rounded-full bg-blossom-200 px-2 py-0.5 text-xs">停用</span>}
              {b.careFlag && <span className="ml-2 rounded-full bg-blossom-100 px-2 py-0.5 text-xs">需要關懷</span>}
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              {b.householdName}・{b.mobile || b.householdPhone || "無電話"}・{b.householdAddress || "無地址"}
            </p>
            {/*
              V13.1 生日／生肖模組：性別、國曆、農曆、生肖、實歲、虛歲
              **各自獨立一格**顯示。

              舊寫法是 `{b.solarBirthDate || b.lunarBirthDisplay}` 後面接一段
              `{b.zodiac ? \`・生肖 ${b.zodiac}\` : ""}`——短路運算讓兩種曆別
              只會顯示其中一種，生肖則被擠在同一行末端、樣式極淡，實務上
              等於看不見。這正是「生肖沒顯示」的原因。

              ⚠️ 不會出現 Invalid Date / NaN：
              這裡顯示的全部是 composeDevoteeSummary() already-formatted 的值
              （solarBirthDate 是字串、lunarBirthDisplay 是字串、歲數是 number
              或 null），畫面**不做任何 new Date() 或算術**。資料不足時
              deriveBirthdayInfo() 整個回傳 null，五個欄位一律是 null，
              不可能是 NaN。

              版面用 flex-wrap + gap，手機與桌機都不會擠成一條過長文字。
            */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
              <span>
                性別：<span className="text-ink-soft">{b.gender ?? "未填寫"}</span>
              </span>
              <span>
                {/* V13.4 驗收：國曆生日顯示民國長格式「民國61年8月15日」，
                    不顯示 1972-08-15。轉換走 minguoDate 的唯一共用函式。 */}
                國曆：<span className="text-ink-soft">{formatIsoDateToMinguoLong(b.solarBirthDate) || "未填寫"}</span>
              </span>
              <span>
                農曆：<span className="text-ink-soft">{b.lunarBirthDisplay ?? "未填寫"}</span>
              </span>
              <span>
                生肖：<span className="text-ink-soft">{b.zodiac ?? "未填寫"}</span>
              </span>
              <span>
                實歲：
                <span className="text-ink-soft">
                  {b.actualAge === null ? "未填寫" : `${b.actualAge} 歲`}
                </span>
              </span>
              <span>
                虛歲：
                <span className="text-ink-soft">
                  {b.nominalAge === null ? "未填寫" : `${b.nominalAge} 歲`}
                </span>
              </span>
            </div>
            {/* V12.2「信眾建立與查詢中心」指令「六、信眾與家戶互相導覽」：
                這一頁原本完全沒有連回所屬家戶的連結（頁面上有家戶資料但不能
                點）。這裡補上明顯的入口，連到既有的 /household/[id]，不新增
                第二個家戶頁。反向（家戶頁 → 信眾詳情）在 V12.1 已經做好。 */}
            {/* V12.4 指令五：所屬家戶必須可點擊，並提供明顯的「回家戶」按鈕，
                直接開啟既有的 Household Detail（/household/[id]）。 */}
            <div id="field-household" className="mt-2 flex flex-col gap-2 rounded-2xl transition sm:flex-row sm:items-center">
              <Link
                href={`/household/${b.householdId}`}
                className="inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-full
                           bg-mist-100 px-4 py-2 text-sm text-ink transition hover:bg-mist-200 sm:w-auto"
              >
                🏠 回家戶：{b.householdName}（{b.householdId}）→
              </Link>
              {/* V12.5 指令五：快速更換家戶。實際搬遷交給既有的
                  POST /api/households/members/transfer，不另做一套。 */}
              {canChangeHousehold && (
                <button
                  type="button"
                  onClick={() => setShowChangeHousehold(true)}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-cream-200
                             px-4 py-2 text-sm text-ink-soft transition hover:bg-cream-300 hover:text-ink sm:w-auto"
                >
                  🔀 更換家戶
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {overview.tags.map((t) => (
              <TagChip
                key={t.assignmentId}
                name={t.name}
                isActive={t.isActive}
                tagId={t.tagId}
                memberId={memberId}
                operatorUserId={operatorUserId}
                canManage={operatorUser?.role ? canDevotee(operatorUser.role, "applyTag") : false}
                onChanged={() => setReloadTick((tk) => tk + 1)}
              />
            ))}
          </div>
        </div>
        {operatorUser?.role && canDevotee(operatorUser.role, "applyTag") && (
          <TagPicker memberId={memberId} operatorUserId={operatorUserId} existingTagIds={overview.tags.map((t) => t.tagId)} onChanged={() => setReloadTick((tk) => tk + 1)} />
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm transition ${tab === t ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft hover:bg-cream-200"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        {tab === "總覽" && (
          <OverviewTab
            overview={overview}
            operatorRole={operatorUser?.role}
            memberId={memberId}
            operatorUserId={operatorUserId}
            onChanged={() => setReloadTick((t) => t + 1)}
          />
        )}
        {tab === "時間軸" && <TimelineTab items={overview.timeline} />}
        {tab === "活動" && (
          <ActivitiesTab
            rituals={overview.rituals}
            stats={overview.activityStats}
            memberId={memberId}
            canEdit={
              operatorUser?.role === "SUPER_ADMIN" ||
              operatorUser?.role === "ADMIN" ||
              operatorUser?.role === "STAFF"
            }
            onChanged={() => setReloadTick((t) => t + 1)}
          />
        )}
        {tab === "收款" && <PaymentsTab payments={overview.payments} />}
        {tab === "收據" && <ReceiptsTab receipts={overview.receipts} />}
        {tab === "供品" && <OfferingsTab offerings={overview.offerings} />}
        {tab === "祭祀與祭改" && <PurificationsTab purifications={overview.purifications} />}
        {tab === "家戶成員" && (
          <HouseholdTab
            memberId={memberId}
            household={overview.household}
            operatorUserId={operatorUserId}
            canEdit={operatorUser?.role === "SUPER_ADMIN" || operatorUser?.role === "ADMIN"}
            onChanged={() => setReloadTick((t) => t + 1)}
          />
        )}
        {tab === "互動紀錄" && (
          <InteractionsTab
            memberId={memberId}
            interactions={overview.interactions}
            operatorUserId={operatorUserId}
            onChanged={() => setReloadTick((t) => t + 1)}
          />
        )}
      </section>

      {showChangeHousehold && (
        <ChangeHouseholdModal
          memberId={memberId}
          memberName={b.name}
          currentHouseholdId={b.householdId}
          currentHouseholdName={b.householdName}
          onClose={() => setShowChangeHousehold(false)}
          onChanged={() => setReloadTick((t) => t + 1)}
        />
      )}
    </div>
  );
}

function Money({ n }: { n: number }) {
  return <>{n.toLocaleString("zh-Hant")}</>;
}

/** 已套用的單一標籤，可管理者可移除套用（對應指令「八」，applyTag）。 */
function TagChip({
  name,
  isActive,
  tagId,
  memberId,
  operatorUserId,
  canManage,
  onChanged,
}: {
  name: string;
  isActive: boolean;
  tagId: string;
  memberId: string;
  operatorUserId: string | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  async function remove() {
    if (!operatorUserId) return;
    await fetch(`/api/devotee-center/${memberId}/tags/${tagId}?operatorUserId=${encodeURIComponent(operatorUserId)}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${isActive ? "bg-yolk-100 text-ink-soft" : "bg-cream-200 text-ink-faint line-through"}`}>
      {name}
      {canManage && (
        <button onClick={remove} className="text-ink-faint hover:text-ink" title="移除標籤">
          ×
        </button>
      )}
    </span>
  );
}

/** 套用既有標籤到這位信眾（下拉選單挑選尚未套用的標籤）。 */
function TagPicker({
  memberId,
  operatorUserId,
  existingTagIds,
  onChanged,
}: {
  memberId: string;
  operatorUserId: string | null;
  existingTagIds: string[];
  onChanged: () => void;
}) {
  const [allTags, setAllTags] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    if (!operatorUserId) return;
    fetch(`/api/devotee-center/tags?operatorUserId=${encodeURIComponent(operatorUserId)}&includeInactive=0`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => setAllTags(d?.tags ?? []))
      .catch(() => setAllTags([]));
  }, [operatorUserId]);

  const options = allTags.filter((t) => !existingTagIds.includes(t.id));

  async function apply() {
    if (!operatorUserId || !selected) return;
    await fetch(`/api/devotee-center/${memberId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operatorUserId, tagId: selected }),
    });
    setSelected("");
    onChanged();
  }

  if (options.length === 0) return null;

  return (
    <div className="mt-3 flex items-center gap-2">
      <select value={selected} onChange={(e) => setSelected(e.target.value)} className="rounded-full border border-cream-200 bg-cream-50 px-3 py-1 text-xs">
        <option value="">套用標籤…</option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <button disabled={!selected} onClick={apply} className="rounded-full bg-sage-200 px-3 py-1 text-xs text-ink disabled:opacity-40">
        套用
      </button>
    </div>
  );
}

function OverviewTab({
  overview,
  operatorRole,
  memberId,
  operatorUserId,
  onChanged,
}: {
  overview: Overview;
  operatorRole?: string;
  memberId: string;
  operatorUserId: string | null;
  onChanged: () => void;
}) {
  const canSeeFullStats = operatorRole === "SUPER_ADMIN";
  const canEdit = operatorRole === "SUPER_ADMIN" || operatorRole === "ADMIN";
  // V13.4 驗收修正：活動報名入口原本只在「活動」分頁，落地的「總覽」分頁看不到。
  // 報名權限沿用 ActivitiesTab 同一組角色（含 STAFF），不另立第二套判斷。
  const canRegister =
    operatorRole === "SUPER_ADMIN" || operatorRole === "ADMIN" || operatorRole === "STAFF";
  const [showNewRegistration, setShowNewRegistration] = useState(false);
  const ds = overview.donationStats;
  return (
    <div className="flex flex-col gap-4">
      {/*
        V13.4 驗收修正（第一項）：活動報名入口直接顯示在落地的「總覽」分頁最上方。
        開啟的是與「活動」分頁完全相同的 NewActivityRegistrationDialog（非第二套）。

        ⚠️ 這張卡片「一律渲染」，不再用 canRegister 把整段藏掉——
        外層 DevoteeCenterGate 已保證進到這裡時 operatorUser 一定解析完成且
        具信眾中心查看權限，所以不會因 operatorUser 載入中或比對失敗而整段消失
        （對應指令：不得因 operatorUser／canEdit 未載入讓入口永久不渲染）。
        只有「＋新增活動報名」這顆按鈕依角色決定啟用或停用：
          SUPER_ADMIN／ADMIN／STAFF → 可點；READONLY → 停用並提示。
      */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-sage-100/70 px-5 py-4">
        <div>
          <p className="text-sm text-ink">活動報名</p>
          <p className="mt-0.5 text-xs text-ink-faint">
            {canRegister
              ? "普渡、年度燈、宮慶等所有活動都可從這裡新增，支援沿用去年或全新建立。"
              : "唯讀人員可查看活動紀錄，但沒有新增報名的權限。"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewRegistration(true)}
          disabled={!canRegister}
          className={`min-h-11 rounded-full px-5 py-2 text-sm font-medium transition ${
            canRegister
              ? "bg-yolk-200 text-ink hover:bg-yolk-300"
              : "cursor-not-allowed bg-cream-200 text-ink-faint"
          }`}
        >
          ＋新增活動報名
        </button>
      </div>
      {showNewRegistration && canRegister && (
        <NewActivityRegistrationDialog
          memberId={memberId}
          onClose={() => {
            setShowNewRegistration(false);
            onChanged();
          }}
        />
      )}
      {/* V12.5 指令二：資料完整度卡片放在最上面；手機版 sticky 置頂，
          捲動填寫時仍看得到還缺哪些欄位。 */}
      <DevoteeCompletenessCard
        mobile={overview.basic.mobile}
        email={overview.basic.email}
        address={overview.household.address}
        solarBirthDate={overview.basic.solarBirthDate}
        lunarBirthDisplay={overview.basic.lunarBirthDisplay}
        householdId={overview.basic.householdId}
      />
      {canEdit && (
        <BaseEditForm
          memberId={memberId}
          operatorUserId={operatorUserId}
          basic={overview.basic}
          household={overview.household}
          onChanged={onChanged}
        />
      )}
      {canEdit && (
        <ProfileEditForm memberId={memberId} operatorUserId={operatorUserId} basic={overview.basic} onChanged={onChanged} />
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-yolk-100 p-4">
          <p className="text-xs text-ink-faint">本年度實收</p>
          <p className="mt-1 text-lg text-ink"><Money n={ds.thisYearTotal.received} /></p>
        </div>
        <div className="rounded-2xl bg-sage-100 p-4">
          <p className="text-xs text-ink-faint">本年度應收</p>
          <p className="mt-1 text-lg text-ink"><Money n={ds.thisYearTotal.due} /></p>
        </div>
        <div className="rounded-2xl bg-blossom-100 p-4">
          <p className="text-xs text-ink-faint">本年度未收</p>
          <p className="mt-1 text-lg text-ink"><Money n={ds.thisYearTotal.unpaid} /></p>
        </div>
      </div>
      {canSeeFullStats ? (
        <div>
          {/* V12.4 指令六：手機改用卡片，不需要橫向捲動就能看到逐類別統計；
              桌面（sm 以上）維持既有完整表格，欄位一欄都沒有拿掉。 */}
          <div className="flex flex-col gap-2 sm:hidden">
            {Object.entries(ds.byCategory).map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-cream-100/60 px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-ink">{k}</span>
                  <span className="text-xs text-ink-faint">{v.hasData ? "有資料" : "無登記資料"}</span>
                </div>
                <p className="mt-1 text-xs text-ink-soft">
                  本年度實收 <Money n={v.thisYear.received} />
                </p>
                <p className="text-xs text-ink-soft">
                  累計實收 <Money n={v.allTime.received} />
                </p>
              </div>
            ))}
          </div>

          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-ink-faint">
                  <th className="px-3 py-2">類別</th>
                  <th className="px-3 py-2">本年度實收</th>
                  <th className="px-3 py-2">累計實收</th>
                  <th className="px-3 py-2">是否有資料</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(ds.byCategory).map(([k, v]) => (
                  <tr key={k} className="border-t border-cream-200">
                    <td className="px-3 py-2 text-ink">{k}</td>
                    <td className="px-3 py-2 text-ink-soft"><Money n={v.thisYear.received} /></td>
                    <td className="px-3 py-2 text-ink-soft"><Money n={v.allTime.received} /></td>
                    <td className="px-3 py-2 text-xs text-ink-faint">{v.hasData ? "有" : "無登記資料"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ink-faint">{ds.note}</p>
        </div>
      ) : (
        <p className="text-xs text-ink-faint">完整逐類別捐款統計僅開放最高管理員查看。</p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl bg-mist-100 p-4">
          <p className="text-xs text-ink-faint">累計活動次數</p>
          <p className="mt-1 text-lg text-ink">{overview.activityStats.totalCount}</p>
        </div>
        <div className="rounded-2xl bg-cream-200 p-4">
          <p className="text-xs text-ink-faint">最近一次活動</p>
          <p className="mt-1 text-sm text-ink">{overview.activityStats.lastActivityAt ?? "無紀錄"}</p>
        </div>
        <div className="rounded-2xl bg-yolk-100 p-4">
          <p className="text-xs text-ink-faint">一年內活動次數</p>
          <p className="mt-1 text-lg text-ink">{overview.activityStats.last1YearCount}</p>
        </div>
        <div className="rounded-2xl bg-sage-100 p-4">
          <p className="text-xs text-ink-faint">是否超過一年未參加</p>
          <p className="mt-1 text-sm text-ink">{overview.activityStats.inactiveOver1Year ? "是" : "否"}</p>
        </div>
      </div>

    </div>
  );
}


/**
 * V12「信眾資料中心正式建置」指令「四、信眾完整資料編輯頁」。
 *
 * 這裡負責「基本資料」＋「家戶資料」——直接修改既有的 Member／Household
 * 兩張表（呼叫 PATCH /api/devotee-center/[memberId]/base，見
 * src/lib/devoteeBaseEdit.ts）。跟下面既有的 ProfileEditForm（只改
 * DevoteeProfile 延伸資料表，例如手機/LINE/個人備註）是兩支獨立的表單、
 * 各自送出各自的 API，不要混在一起——沿用既有架構分工，不重新設計。
 *
 * ⚠️ 家戶編號（Household.id）刻意不提供輸入框：這是主鍵，被十幾張既有
 * 資料表引用，且沒有設定連動更新，直接開放修改會造成外鍵衝突或需要高
 * 風險的多表同步更新（使用者已確認這次不開放修改，只顯示唯讀）。
 */
function BaseEditForm({
  memberId,
  operatorUserId,
  basic,
  household,
  onChanged,
}: {
  memberId: string;
  operatorUserId: string | null;
  basic: Overview["basic"];
  household: Overview["household"];
  onChanged: () => void;
}) {
  const [name, setName] = useState(basic.name);
  const [gender, setGender] = useState(basic.gender ?? "");
  const [role, setRole] = useState(basic.role);
  const [isPrimaryContact, setIsPrimaryContact] = useState(basic.isPrimaryContact);
  const [isDeceased, setIsDeceased] = useState(basic.isDeceased);
  const [deceasedAt, setDeceasedAt] = useState(basic.deceasedAt ?? "");
  const [notes, setNotes] = useState(basic.memberNotes ?? "");
  const [birthHour, setBirthHour] = useState(basic.birthHour ?? "");

  /**
   * V13.2 第五節：生日改用共用的 BirthdayField，不再維護第二套邏輯。
   *
   * ⚠️ 原始登記曆別的判定順序很重要：**先看農曆**。
   *
   * V13.1 起國曆與農曆兩者都會永久保存（由 resolveBirthdayFields 自動換算），
   * 所以「有沒有 solarBirthDate」已經無法判斷當初是用哪一種登記的——兩者
   * 一定都有值。舊寫法 `basic.solarBirthDate ? "solar" : ...` 會讓**所有**
   * 農曆登記的信眾一開啟編輯頁就變成國曆模式，一存檔就把原本的農曆登記
   * 誤存成國曆（V13.2 第五節明令禁止）。
   *
   * 判斷依據改為 lunarBirthYear：使用者當初若是用農曆登記，農曆年是他
   * 親手輸入的原始值；國曆則是系統換算出來的。
   */
  const initialBirthday: BirthdayValue = basic.lunarBirthYear
    ? {
        birthdayType: "lunar",
        solarBirthDate: basic.solarBirthDate ?? "",
        lunarBirthYear: String(basic.lunarBirthYear),
        lunarBirthMonth: basic.lunarBirthMonth ? String(basic.lunarBirthMonth) : "",
        lunarBirthDay: basic.lunarBirthDay ? String(basic.lunarBirthDay) : "",
        lunarIsLeapMonth: basic.lunarIsLeapMonth,
      }
    : basic.solarBirthDate
      ? {
          birthdayType: "solar",
          solarBirthDate: basic.solarBirthDate,
          lunarBirthYear: "",
          lunarBirthMonth: "",
          lunarBirthDay: "",
          lunarIsLeapMonth: false,
        }
      : createEmptyBirthdayValue();

  const [birthday, setBirthday] = useState<BirthdayValue>(initialBirthday);
  const birthdayMode = birthday.birthdayType;
  const solarBirthDate = birthday.solarBirthDate;
  const lunarBirthYear = birthday.lunarBirthYear;
  const lunarBirthMonth = birthday.lunarBirthMonth;
  const lunarBirthDay = birthday.lunarBirthDay;

  const [householdName, setHouseholdName] = useState(household.name);
  const [contactName, setContactName] = useState(household.contactName ?? "");
  const [address, setAddress] = useState(household.address ?? "");
  const [phone, setPhone] = useState(household.phone ?? "");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** V13.4：首次標記辭世後的後續詢問 */
  const [showDeceasedFollowUp, setShowDeceasedFollowUp] = useState(false);

  /**
   * V12.5 指令六：資料品質提醒（電話／生日格式、重複地址）。
   * 規則來自共用的 src/lib/devoteeDataQuality.ts，前後端同一份。
   * ⚠️ 只提醒，不阻止儲存——save() 完全不看這個結果。
   */
  const qualityIssues: QualityIssue[] = checkDevoteeDataQuality({
    phone,
    solarBirthDate: birthdayMode === "solar" ? solarBirthDate : null,
    lunarBirthYear: birthdayMode === "lunar" ? Number(lunarBirthYear) || null : null,
    lunarBirthMonth: birthdayMode === "lunar" ? Number(lunarBirthMonth) || null : null,
    lunarBirthDay: birthdayMode === "lunar" ? Number(lunarBirthDay) || null : null,
    address,
    // ⚠️ 刻意不比對「同戶其他成員的地址」——目前地址是整戶共用一份
    // （Household.address），同戶必然相同，比對出來是必然成立的雜訊。
    // 真正有意義的是「別的家戶也用同一個地址」，見下方 duplicateAddressHouseholds。
  });

  /**
   * V12.5 指令六：重複地址提示。
   *
   * 有意義的訊號是「其他家戶登記了完全相同的地址」——那通常代表同一戶被
   * 重複建立成兩戶。這裡沿用既有的家戶搜尋端點
   * GET /api/devotee-center/household-options（搜尋欄位含地址），
   * **不新增第二支 API**。
   */
  const [duplicateAddressHouseholds, setDuplicateAddressHouseholds] = useState<
    { id: string; name: string }[]
  >([]);

  useEffect(() => {
    const a = address.trim();
    if (a.length < 6) {
      setDuplicateAddressHouseholds([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: a });
        if (operatorUserId) params.set("operatorUserId", operatorUserId);
        const res = await fetch(`/api/devotee-center/household-options?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) return;
        const others = (json.data?.households ?? []).filter(
          (h: { id: string; address: string | null }) =>
            h.id !== household.id && (h.address ?? "").trim() === a
        );
        setDuplicateAddressHouseholds(others.map((h: { id: string; name: string }) => ({ id: h.id, name: h.name })));
      } catch {
        setDuplicateAddressHouseholds([]);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [address, operatorUserId, household.id]);

  async function save() {
    if (!operatorUserId) return;
    if (!name.trim()) {
      setError("姓名為必填，不能清空");
      return;
    }
    if (!householdName.trim()) {
      setError("戶名為必填，不能清空");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const body: Record<string, unknown> = {
        operatorUserId,
        name: name.trim(),
        gender: gender || null,
        role,
        isPrimaryContact,
        isDeceased,
        deceasedAt: isDeceased ? deceasedAt || null : null,
        notes: notes || null,
        birthHour: birthHour || null,
        birthdayType: birthdayMode,
        household: {
          name: householdName.trim(),
          contactName: contactName || null,
          address: address || null,
          phone: phone || null,
        },
      };
      if (birthdayMode === "solar") {
        body.solarBirthDate = solarBirthDate;
      } else if (birthdayMode === "lunar") {
        body.lunarBirthYear = Number(lunarBirthYear);
        body.lunarBirthMonth = Number(lunarBirthMonth);
        body.lunarBirthDay = Number(lunarBirthDay);
        body.lunarIsLeapMonth = birthday.lunarIsLeapMonth;
      }

      const res = await fetch(`/api/devotee-center/${memberId}/base`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "儲存失敗");
      setSaved(true);
      onChanged();

      /**
       * V13.4 指令二十二：辭世流程接通。
       *
       * 只有信眾**第一次**由「在世」改成「已辭世」且儲存成功時，
       * 伺服器才會回 justMarkedDeceased=true（判定條件見
       * src/lib/devoteeBaseEdit.ts）。一般編輯不會觸發，
       * 按過「暫不處理」的也不會再問。
       */
      if (data?.justMarkedDeceased === true) {
        setShowDeceasedFollowUp(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl bg-cream-100 p-4">
      <h3 className="text-sm font-medium text-ink">信眾基本資料</h3>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          姓名 *
          <input value={name} onChange={(e) => setName(e.target.value)} className="min-h-11 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm text-ink" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          性別
          {/*
            V13.2 第五節：性別改為下拉，不可自由輸入其他文字。
            選項來自共用的 GENDER_OPTIONS，與新增信眾表單同一份定義。
            後端 updateDevoteeBase() 也會用 normalizeGenderInput() 再驗一次，
            即使前端被繞過也不會有奇怪的值進資料庫。
          */}
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            className="min-h-11 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm text-ink"
          >
            {GENDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          與戶主關係
          <select value={role} onChange={(e) => setRole(e.target.value)} className="min-h-11 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm text-ink">
            {memberRoleOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          出生時辰
          <select value={birthHour} onChange={(e) => setBirthHour(e.target.value)} className="min-h-11 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm text-ink">
            <option value="">未填寫</option>
            {birthHourOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/*
        V13.2 第五節：生日編輯區沿用共用的 BirthdayField，與新增信眾
        （CreateDevoteeModal／AddMemberModal）**同一個元件**，不維護第二套。
        BirthdayField 本身會即時顯示國曆、農曆、生肖、實歲、虛歲。
      */}
      <div id="field-birthday" className="mt-3 rounded-2xl transition">
        <BirthdayField value={birthday} onChange={setBirthday} />
      </div>

      {/*
        V13.4 指令二十二之 2／3：「已辭世」移出一般基本資料區。

        放在表單較下方的獨立可收合區塊，預設收合——日常編輯電話、地址、
        備註時不會誤觸，也不會讓這個敏感欄位夾在姓名與生日中間。
      */}
      <details className="mt-4 rounded-2xl bg-cream-50 px-4 py-3">
        <summary className="cursor-pointer text-xs text-ink-soft">
          特殊狀態（已辭世）
          {isDeceased && (
            <span className="ml-2 rounded-full bg-cream-300 px-2 py-0.5 text-xs text-ink">
              目前標記為已辭世
            </span>
          )}
        </summary>

        <label className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={isDeceased}
            onChange={(e) => setIsDeceased(e.target.checked)}
          />
          已辭世
        </label>
        {isDeceased && (
          <input
            type="date"
            value={deceasedAt}
            onChange={(e) => setDeceasedAt(e.target.value)}
            className="mt-2 min-h-11 rounded-full border border-cream-200 bg-white px-3 py-1.5 text-sm text-ink"
          />
        )}
        <p className="mt-2 text-xs leading-relaxed text-ink-faint">
          第一次標記為已辭世並儲存後，系統會詢問是否建立乙位正魂。
          <span className="text-ink-soft">不會自動建立</span>，也不會自動加入普渡。
          取消已辭世不會刪除任何已建立的牌位、普渡或收款紀錄。
        </p>
      </details>

      <label className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
        <input type="checkbox" checked={isPrimaryContact} onChange={(e) => setIsPrimaryContact(e.target.checked)} />
        是主要聯絡人
      </label>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="備註"
        rows={2}
        className="mt-3 w-full rounded-2xl border border-cream-200 bg-cream-50 px-3 py-2 text-sm"
      />

      <h3 className="mt-5 text-sm font-medium text-ink">家戶資料</h3>
      <p className="mt-1 text-xs text-ink-faint">家戶編號：{household.id}（不開放修改，如需更換編號請另外告知）</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          戶名 *
          <input value={householdName} onChange={(e) => setHouseholdName(e.target.value)} className="min-h-11 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm text-ink" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          主要聯絡人
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="min-h-11 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm text-ink" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          市話（家戶電話）
          <input
            id="field-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            className="min-h-11 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint sm:col-span-2">
          地址
          <input
            id="field-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="min-h-11 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm text-ink"
          />
        </label>
      </div>

      {/*
        V12.5 指令三：一鍵帶入家戶地址。

        ⚠️ 誠實說明目前的資料模型：系統只有 Household.address 一份地址，
        DevoteeProfile 沒有個人地址欄位（依本輪裁決不新增）。所以這個欄位
        編輯的就是「整戶的地址」——「一鍵複製」在這裡的意義是「把已被改動的
        輸入框還原成家戶目前的地址」，而不是把家戶地址複製到另一個個人欄位。
        同理，覆蓋提示提醒的是「這次修改會影響同戶所有人」。
      */}
      {household.address && address.trim() !== (household.address ?? "").trim() && (
        <div className="mt-2 flex flex-col gap-2 rounded-2xl bg-yolk-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed text-ink-soft">
            地址已被修改。這個欄位是<span className="text-ink">整戶共用的家戶地址</span>，儲存後同戶
            {household.members.length} 位成員的地址都會一起變更。
            <br />
            <span className="text-ink-faint">家戶目前地址：{household.address}</span>
          </p>
          <button
            type="button"
            onClick={() => setAddress(household.address ?? "")}
            className="min-h-11 whitespace-nowrap rounded-full bg-white/80 px-4 py-2 text-xs text-ink-soft
                       shadow-soft transition hover:bg-white hover:text-ink sm:min-h-0 sm:py-1.5"
          >
            還原為家戶地址
          </button>
        </div>
      )}
      {!household.address && (
        <p className="mt-2 rounded-2xl bg-mist-50 px-4 py-2.5 text-xs text-ink-soft">
          這一戶尚未登記地址。在此填寫後，同戶 {household.members.length} 位成員都會套用這個地址。
        </p>
      )}

      {/* V12.5 指令六：資料品質提醒。僅提醒，不阻止儲存。 */}
      {(qualityIssues.length > 0 || duplicateAddressHouseholds.length > 0) && (
        <ul className="mt-3 flex flex-col gap-1 rounded-2xl bg-blossom-50 px-4 py-3">
          {qualityIssues.map((i) => (
            <li key={`${i.field}-${i.message}`} className="text-xs leading-relaxed text-ink-soft">
              ⚠️ {i.message}
            </li>
          ))}
          {duplicateAddressHouseholds.length > 0 && (
            <li className="text-xs leading-relaxed text-ink-soft">
              ⚠️ 這個地址與其他 {duplicateAddressHouseholds.length} 個家戶相同（
              {duplicateAddressHouseholds.slice(0, 3).map((h) => `${h.name}（${h.id}）`).join("、")}
              ）。請確認是否為重複建立的家戶。
            </li>
          )}
          <li className="mt-1 text-xs text-ink-faint">以上僅為提醒，仍可直接儲存。</li>
        </ul>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <button
          disabled={saving}
          onClick={save}
          className="min-h-11 w-full rounded-full bg-sage-200 px-5 py-2 text-sm font-medium text-ink disabled:opacity-40 sm:w-auto"
        >
          {saving ? "儲存中…" : "儲存基本資料"}
        </button>
        {saved && <span className="text-xs text-ink-faint">已儲存</span>}
        {error && <span className="text-xs text-blossom-300">{error}</span>}
      </div>

      {/*
        V13.4：首次標記辭世後的兩段式詢問（建立乙位正魂 → 加入普渡）。
        只有伺服器回 justMarkedDeceased=true 才會出現，一般編輯不會打擾。
      */}
      {showDeceasedFollowUp && (
        <DeceasedFollowUpDialog
          memberId={memberId}
          memberName={name}
          operatorUserId={operatorUserId}
          onClose={() => setShowDeceasedFollowUp(false)}
          onFinished={onChanged}
        />
      )}
    </div>
  );
}

/**
 * 信眾延伸資料編輯表單（對應指令「七」）。SUPER_ADMIN／ADMIN 皆可呼叫
 * PATCH /api/devotee-center/[memberId]/profile——本輪沒有把任何延伸資料
 * 欄位另外標記為「僅 SUPER_ADMIN 專屬」，見 src/lib/permissions.ts 說明。
 */
function ProfileEditForm({
  memberId,
  operatorUserId,
  basic,
  onChanged,
}: {
  memberId: string;
  operatorUserId: string | null;
  basic: Overview["basic"];
  onChanged: () => void;
}) {
  const [mobile, setMobile] = useState(basic.mobile ?? "");
  const [lineId, setLineId] = useState(basic.lineId ?? "");
  const [email, setEmail] = useState(basic.email ?? "");
  const [companyName, setCompanyName] = useState(basic.companyName ?? "");
  const [personalNote, setPersonalNote] = useState(basic.personalNote ?? "");
  const [isDisabled, setIsDisabled] = useState(basic.isDisabled);
  const [disabledReason, setDisabledReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // V12.5 指令六：手機／Email 格式提醒，規則來自共用的 devoteeDataQuality。
  // ⚠️ 只提醒，save() 不看這個結果。
  const profileQualityIssues: QualityIssue[] = checkDevoteeDataQuality({ mobile, email });
  const [saved, setSaved] = useState(false);

  async function save() {
    if (!operatorUserId) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/devotee-center/${memberId}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorUserId,
          mobile: mobile || null,
          lineId: lineId || null,
          email: email || null,
          companyName: companyName || null,
          personalNote: personalNote || null,
          isDisabled,
          disabledReason: isDisabled ? disabledReason || null : null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "儲存失敗");
      setSaved(true);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl bg-cream-100 p-4">
      <h3 className="text-sm font-medium text-ink">信眾延伸資料</h3>
      {/* V12.5 指令一／七：欄位加上標籤與 id（供完整度卡片跳轉），
          手機單欄、sm 以上兩欄，輸入框 min-h-11 方便觸控。 */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          手機
          <input
            id="field-mobile"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            inputMode="tel"
            placeholder="例如 0912345678"
            className="min-h-11 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          Email
          <input
            id="field-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            inputMode="email"
            placeholder="例如 abc@example.com"
            className="min-h-11 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          LINE ID
          <input
            value={lineId}
            onChange={(e) => setLineId(e.target.value)}
            className="min-h-11 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          公司名稱
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="min-h-11 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm text-ink"
          />
        </label>
      </div>

      {/* V12.5 指令六：手機／Email 格式提醒。僅提醒，不阻止儲存。 */}
      {profileQualityIssues.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 rounded-2xl bg-blossom-50 px-4 py-3">
          {profileQualityIssues.map((i) => (
            <li key={`${i.field}-${i.message}`} className="text-xs leading-relaxed text-ink-soft">
              ⚠️ {i.message}
            </li>
          ))}
          <li className="mt-1 text-xs text-ink-faint">以上僅為提醒，仍可直接儲存。</li>
        </ul>
      )}
      <textarea
        value={personalNote}
        onChange={(e) => setPersonalNote(e.target.value)}
        placeholder="個人備註"
        rows={2}
        className="mt-3 w-full rounded-2xl border border-cream-200 bg-cream-50 px-3 py-2 text-sm"
      />
      <label className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
        <input type="checkbox" checked={isDisabled} onChange={(e) => setIsDisabled(e.target.checked)} />
        停用此信眾（不影響歷史資料）
      </label>
      {isDisabled && (
        <input
          value={disabledReason}
          onChange={(e) => setDisabledReason(e.target.value)}
          placeholder="停用原因"
          className="mt-2 min-h-11 w-full rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm"
        />
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <button disabled={saving} onClick={save} className="min-h-11 w-full rounded-full bg-sage-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40 sm:w-auto">
          {saving ? "儲存中…" : "儲存"}
        </button>
        {saved && <span className="text-xs text-ink-faint">已儲存</span>}
        {error && <span className="text-xs text-blossom-300">{error}</span>}
      </div>
    </div>
  );
}

function EmptyState() {
  return <p className="text-sm text-ink-faint">（目前沒有資料）</p>;
}

function TimelineTab({ items }: { items: Overview["timeline"] }) {
  if (!items.length) return <EmptyState />;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((it, idx) => (
        <li key={idx} className="flex gap-4 border-l-2 border-sage-200 pl-4">
          <span className="w-24 shrink-0 text-xs text-ink-faint">{it.date}</span>
          <span className="w-20 shrink-0 rounded-full bg-cream-100 px-2 py-0.5 text-center text-xs text-ink-soft">{it.type}</span>
          <span className="text-sm text-ink">{it.description}</span>
        </li>
      ))}
    </ul>
  );
}

function ActivitiesTab({
  rituals,
  stats,
  memberId,
  canEdit,
  onChanged,
}: {
  rituals: Overview["rituals"];
  stats: Overview["activityStats"];
  memberId: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [showNewRegistration, setShowNewRegistration] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {/*
        V13.4：信眾詳情頁的活動報名入口。
        所有已建立且開放報名的活動都能從這裡新增，不限普渡——
        清單完全由 TempleEvent 動態取得，前端沒有寫死任何活動種類。
      */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-faint">
          首次參加：{stats.firstActivityAt ?? "無"}・最近參加：{stats.lastActivityAt ?? "無"}
        </p>
        {canEdit && (
          <button
            type="button"
            onClick={() => setShowNewRegistration(true)}
            className="min-h-11 rounded-full bg-yolk-200 px-5 py-2 text-sm font-medium text-ink transition hover:bg-yolk-300"
          >
            ＋新增活動報名
          </button>
        )}
      </div>

      {showNewRegistration && (
        <NewActivityRegistrationDialog
          memberId={memberId}
          onClose={() => {
            setShowNewRegistration(false);
            onChanged();
          }}
        />
      )}
      {rituals.length === 0 ? (
        <EmptyState />
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-ink-faint">
              <th className="px-3 py-2">活動</th>
              <th className="px-3 py-2">年度</th>
              <th className="px-3 py-2">金額</th>
              <th className="px-3 py-2">收款狀態</th>
              <th className="px-3 py-2">收據號碼</th>
            </tr>
          </thead>
          <tbody>
            {rituals.map((r) => (
              <tr key={r.ritualRecordId} className="border-t border-cream-200">
                <td className="px-3 py-2 text-ink">{r.activityName}</td>
                <td className="px-3 py-2 text-ink-soft">{r.year}</td>
                <td className="px-3 py-2 text-ink-soft"><Money n={r.amount} /></td>
                <td className="px-3 py-2 text-ink-soft">{r.paymentStatus}</td>
                <td className="px-3 py-2 text-ink-faint">{r.receiptNumbers.join("、") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PaymentsTab({ payments }: { payments: Overview["payments"] }) {
  if (!payments.length) return <EmptyState />;
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs text-ink-faint">
          <th className="px-3 py-2">收款序號</th>
          <th className="px-3 py-2">日期</th>
          <th className="px-3 py-2">項目</th>
          <th className="px-3 py-2">金額</th>
          <th className="px-3 py-2">狀態</th>
        </tr>
      </thead>
      <tbody>
        {payments.map((p) => (
          <tr key={p.transactionId} className="border-t border-cream-200">
            <td className="px-3 py-2 text-ink">
              <Link href={`/collection-center/payments/${p.transactionId}`} className="underline-offset-4 hover:underline">
                {p.transactionNo}
              </Link>
            </td>
            <td className="px-3 py-2 text-ink-soft">{p.paidOn}</td>
            <td className="px-3 py-2 text-ink-soft">{p.items}</td>
            <td className="px-3 py-2 text-ink-soft"><Money n={p.totalAmount} /></td>
            <td className="px-3 py-2 text-ink-faint">{p.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReceiptsTab({ receipts }: { receipts: Overview["receipts"] }) {
  if (!receipts.length) return <EmptyState />;
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs text-ink-faint">
          <th className="px-3 py-2">收據號碼</th>
          <th className="px-3 py-2">開立日期</th>
          <th className="px-3 py-2">金額</th>
          <th className="px-3 py-2">狀態</th>
        </tr>
      </thead>
      <tbody>
        {receipts.map((r) => (
          <tr key={r.receiptId} className="border-t border-cream-200">
            <td className="px-3 py-2 text-ink">
              <Link href={`/receipt-center/receipts/${r.receiptId}`} className="underline-offset-4 hover:underline">
                {r.receiptNumber ?? "（尚未編號）"}
              </Link>
            </td>
            <td className="px-3 py-2 text-ink-soft">{r.issuedDate}</td>
            <td className="px-3 py-2 text-ink-soft"><Money n={r.amount} /></td>
            <td className="px-3 py-2 text-ink-faint">{r.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OfferingsTab({ offerings }: { offerings: Overview["offerings"] }) {
  if (!offerings.length) return <EmptyState />;
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs text-ink-faint">
          <th className="px-3 py-2">供品</th>
          <th className="px-3 py-2">年度</th>
          <th className="px-3 py-2">金額</th>
          <th className="px-3 py-2">收款狀態</th>
          <th className="px-3 py-2">是否領取</th>
        </tr>
      </thead>
      <tbody>
        {offerings.map((o) => (
          <tr key={o.claimId} className="border-t border-cream-200">
            <td className="px-3 py-2 text-ink">{o.offeringName}</td>
            <td className="px-3 py-2 text-ink-soft">{o.year}</td>
            <td className="px-3 py-2 text-ink-soft"><Money n={o.amount} /></td>
            <td className="px-3 py-2 text-ink-soft">{o.paymentStatus}</td>
            <td className="px-3 py-2 text-ink-faint">{o.isCollected}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PurificationsTab({ purifications }: { purifications: Overview["purifications"] }) {
  if (!purifications.length) return <EmptyState />;
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs text-ink-faint">
          <th className="px-3 py-2">年度</th>
          <th className="px-3 py-2">金額</th>
          <th className="px-3 py-2">收款狀態</th>
          <th className="px-3 py-2">收據號碼</th>
        </tr>
      </thead>
      <tbody>
        {purifications.map((p) => (
          <tr key={p.entryId} className="border-t border-cream-200">
            <td className="px-3 py-2 text-ink">{p.year}</td>
            <td className="px-3 py-2 text-ink-soft"><Money n={p.amount} /></td>
            <td className="px-3 py-2 text-ink-soft">{p.paymentStatus}</td>
            <td className="px-3 py-2 text-ink-faint">{p.receiptNumbers.join("、") || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const WORSHIP_TYPE_LABEL: Record<string, string> = { ANCESTOR_LINE: "歷代祖先", INDIVIDUAL: "個人往生者" };

/**
 * V12「信眾資料中心正式建置」指令「四、其他資料」：家戶成員／歷代祖先／
 * 乙位正魂——只能新增，比照既有 /household/[id] 頁面同樣資料的「新增」
 * 行為，不提供修改/刪除既有這些項目的入口（既有頁面本身也沒有這些操作，
 * 這裡沒有擴大範圍）。
 */
function HouseholdTab({
  memberId,
  household,
  operatorUserId,
  canEdit,
  onChanged,
}: {
  memberId: string;
  household: Overview["household"];
  operatorUserId: string | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-ink-soft">
          {household.name}（{household.id}）・{household.phone || "無電話"}・{household.address || "無地址"}
        </p>
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-ink-faint">
              <th className="px-3 py-2">姓名</th>
              <th className="px-3 py-2">身份</th>
              <th className="px-3 py-2">主要聯絡人</th>
              <th className="px-3 py-2">狀態</th>
            </tr>
          </thead>
          <tbody>
            {household.members.map((m) => (
              <tr key={m.memberId} className="border-t border-cream-200">
                <td className="px-3 py-2 text-ink">
                  <Link href={`/devotee-center/${m.memberId}`} className="underline-offset-4 hover:underline">
                    {m.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-ink-soft">{memberRoleLabel[m.role] ?? m.role}</td>
                <td className="px-3 py-2 text-ink-soft">{m.isPrimaryContact ? "是" : ""}</td>
                <td className="px-3 py-2 text-ink-faint">{m.isDeceased ? "已往生" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit && <AddHouseholdMemberForm memberId={memberId} operatorUserId={operatorUserId} onChanged={onChanged} />}
      </div>

      <div>
        <h3 className="text-sm font-medium text-ink">歷代祖先／乙位正魂</h3>
        {household.worshipRecords.length === 0 ? (
          <p className="mt-2 text-sm text-ink-faint">尚無祭祀資料。</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {household.worshipRecords.map((w) => (
              <div key={w.id} className="rounded-2xl bg-blossom-50 px-4 py-3 text-sm">
                <span className="text-ink">{w.displayName}</span>
                <span className="ml-2 rounded-full bg-white/70 px-2 py-0.5 text-xs text-ink-soft">
                  {WORSHIP_TYPE_LABEL[w.type] ?? w.type}
                </span>
                {w.location && <span className="ml-2 text-xs text-ink-faint">安奉地：{w.location}</span>}
              </div>
            ))}
          </div>
        )}
        {canEdit && <AddWorshipRecordForm memberId={memberId} operatorUserId={operatorUserId} onChanged={onChanged} />}
      </div>
    </div>
  );
}

/** 新增家戶成員小表單（對應指令「四」）。呼叫 POST .../household-members。 */
function AddHouseholdMemberForm({
  memberId,
  operatorUserId,
  onChanged,
}: {
  memberId: string;
  operatorUserId: string | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("OTHER");
  const [gender, setGender] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!operatorUserId || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/devotee-center/${memberId}/household-members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId, name: name.trim(), role, gender: gender || undefined, birthdayType: "none" }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "新增失敗");
      setName("");
      setGender("");
      setOpen(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "新增失敗");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-3 rounded-full bg-cream-100 px-4 py-1.5 text-xs text-ink-soft hover:bg-cream-200">
        ＋ 新增家戶成員
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-2xl bg-cream-100 p-4">
      <div className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="姓名" className="rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm" />
        {/* V13.2 第五節：性別一律下拉，不可自由輸入 */}
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          className="w-32 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm"
        >
          {GENDER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm">
          {memberRoleOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-2 text-xs text-ink-faint">出生年月日等其他資料可以在新增後，點進這位成員的信眾完整資料編輯頁再補齊。</p>
      <div className="mt-3 flex items-center gap-3">
        <button disabled={saving || !name.trim()} onClick={submit} className="min-h-11 w-full rounded-full bg-sage-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40 sm:w-auto">
          {saving ? "新增中…" : "新增"}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-ink-faint hover:underline">
          取消
        </button>
        {error && <span className="text-xs text-blossom-300">{error}</span>}
      </div>
    </div>
  );
}

/** 新增歷代祖先／乙位正魂小表單（對應指令「四」）。呼叫 POST .../worship-records。 */
function AddWorshipRecordForm({
  memberId,
  operatorUserId,
  onChanged,
}: {
  memberId: string;
  operatorUserId: string | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>(worshipTypeOptions[0]?.value ?? "ANCESTOR_LINE");
  const [displayName, setDisplayName] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!operatorUserId || !displayName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/devotee-center/${memberId}/worship-records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId, type, displayName: displayName.trim(), location: location || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "新增失敗");
      setDisplayName("");
      setLocation("");
      setOpen(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "新增失敗");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-3 rounded-full bg-cream-100 px-4 py-1.5 text-xs text-ink-soft hover:bg-cream-200">
        ＋ 新增歷代祖先／乙位正魂
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-2xl bg-cream-100 p-4">
      <div className="flex flex-wrap gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm">
          {worshipTypeOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="名稱（例如：王姓歷代祖先）" className="min-h-11 w-full min-w-0 flex-1 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm sm:min-w-[200px]" />
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="安奉地（選填）" className="w-40 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm" />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button disabled={saving || !displayName.trim()} onClick={submit} className="min-h-11 w-full rounded-full bg-sage-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40 sm:w-auto">
          {saving ? "新增中…" : "新增"}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-ink-faint hover:underline">
          取消
        </button>
        {error && <span className="text-xs text-blossom-300">{error}</span>}
      </div>
    </div>
  );
}

function InteractionsTab({
  memberId,
  interactions,
  operatorUserId,
  onChanged,
}: {
  memberId: string;
  interactions: Overview["interactions"];
  operatorUserId: string | null;
  onChanged: () => void;
}) {
  const [content, setContent] = useState("");
  const [type, setType] = useState("PHONE_CALL");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit() {
    if (!operatorUserId || !content.trim()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/devotee-center/${memberId}/interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId, interactionType: type, occurredAt: new Date().toISOString(), content }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "新增失敗");
      setContent("");
      onChanged();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "新增失敗");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl bg-cream-100 p-4">
        <div className="flex flex-wrap gap-2">
          <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm">
            {Object.entries(DEVOTEE_INTERACTION_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="互動內容"
            className="min-h-11 w-full min-w-0 flex-1 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm sm:min-w-[200px]"
          />
          <button
            disabled={submitting || !content.trim()}
            onClick={submit}
            className="min-h-11 w-full rounded-full bg-sage-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40 sm:w-auto"
          >
            新增互動紀錄
          </button>
        </div>
        {formError && <p className="mt-2 text-xs text-blossom-300">{formError}</p>}
      </div>

      {interactions.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-2">
          {interactions.map((i) => (
            <li key={i.id} className="rounded-2xl bg-cream-50 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-mist-100 px-2 py-0.5 text-xs text-ink-soft">
                  {DEVOTEE_INTERACTION_TYPE_LABEL[i.interactionType] ?? i.interactionType}
                </span>
                <span className="text-xs text-ink-faint">{i.occurredAt.slice(0, 10)}・{i.createdByName ?? "（未填）"}</span>
              </div>
              <p className="mt-2 text-ink">{i.content}</p>
              {i.nextContactDate && <p className="mt-1 text-xs text-ink-faint">下次聯絡：{i.nextContactDate.slice(0, 10)}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function DevoteeDetailPage({ params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = usePromise(params);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <Link href="/devotee-center/list" className="text-sm text-ink-soft hover:underline">
            ← 信眾名單
          </Link>
          <h1 className="text-sm text-ink-soft">360°信眾總覽</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
        <OperatorProvider>
          <OperatorBar />
          <DevoteeCenterGate>
            {/* DevoteeDetailInner 用了 useSearchParams()，Next.js 要求外面要有
                Suspense 邊界，否則 npm run build 靜態分析階段會報錯。 */}
            <Suspense fallback={<p className="text-sm text-ink-faint">載入中…</p>}>
              <DevoteeDetailInner memberId={memberId} />
            </Suspense>
          </DevoteeCenterGate>
        </OperatorProvider>
      </main>
    </div>
  );
}
