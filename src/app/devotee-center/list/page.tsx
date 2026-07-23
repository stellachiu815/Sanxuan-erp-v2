"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { OperatorProvider, useOperator } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import DevoteeCenterGate from "@/components/devotee/DevoteeCenterGate";
import { canDevotee } from "@/lib/permissions";
// V14.1（十七）：名單國曆生日以民國顯示，不顯示西元。
import { formatIsoDateToRocCompact } from "@/lib/minguoDate";
import CreateHouseholdModal from "@/components/household/CreateHouseholdModal";
import CreateDevoteeModal from "@/components/devotee/CreateDevoteeModal";
import HouseholdActionsMenu from "@/components/household/HouseholdActionsMenu";

type DevoteeRow = {
  memberId: string;
  name: string;
  householdId: string;
  householdName: string;
  householdContactName: string | null;
  mobile: string | null;
  householdPhone: string | null;
  householdAddress: string | null;
  solarBirthDate: string | null;
  lunarBirthDisplay: string | null;
  zodiac: string | null;
  isDeceased: boolean;
  isDisabled: boolean;
  tags: string[];
  lastActivityAt: string | null;
  lastPaymentAt: string | null;
};

type ListResponse = { rows: DevoteeRow[]; total: number; page: number; pageSize: number };

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "ACTIVE", label: "在用" },
  { value: "DISABLED", label: "停用" },
  { value: "DECEASED", label: "已往生" },
  { value: "HAS_PHONE", label: "有電話" },
  { value: "NO_PHONE", label: "無電話" },
  { value: "HAS_ADDRESS", label: "有地址" },
  { value: "NO_ADDRESS", label: "無地址" },
  { value: "BIRTHDAY_THIS_MONTH", label: "本月生日" },
  { value: "ACTIVE_THIS_YEAR", label: "本年度參加活動" },
  { value: "INACTIVE_OVER_1YEAR", label: "一年以上未參加活動" },
  { value: "NEEDS_CARE", label: "需要關懷" },
  { value: "TAG_VIP", label: "VIP" },
  { value: "TAG_VOLUNTEER", label: "義工" },
  { value: "TAG_COMMITTEE", label: "宮委" },
];

// V12「信眾資料中心正式建置」指令「六、信眾列表快速篩選」：全部／缺出生
// 年月日／缺地址／缺電話／資料完整，獨立放在搜尋框正下方最顯眼的位置，
// 跟上面既有的細部篩選（FILTER_OPTIONS）分開——這是「待補資料」工作流程
// 最常用到的幾個按鈕，不希望被埋在 14 個選項中間。「缺地址」「缺電話」
// 沿用既有的 NO_ADDRESS／NO_PHONE，不重複定義。
const QUICK_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "NO_BIRTHDAY", label: "缺出生年月日" },
  { value: "NO_ADDRESS", label: "缺地址" },
  { value: "NO_PHONE", label: "缺電話" },
  { value: "DATA_COMPLETE", label: "資料完整" },
];

function DevoteeListInner() {
  const { operatorUserId, operatorUser } = useOperator();
  // V12.1「家戶管理中心」驗收修正輪：直接整合進信眾名單頁，不另外開頁面。
  const canManage = operatorUser?.role ? canDevotee(operatorUser.role, "updateProfile") : false;
  const [showCreateHousehold, setShowCreateHousehold] = useState(false);
  const [showCreateDevotee, setShowCreateDevotee] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  // 對應指令「五、待補資料」：從首頁統計數字點進來時，網址會帶
  // ?filters=NO_BIRTHDAY 這類參數，這裡讀出來當作篩選的初始值，讓「點擊
  // 數字直接看到對應名單」真的成立，不是只有停在空白的名單頁。
  const urlParams = useSearchParams();
  const [q, setQ] = useState(() => urlParams.get("q") ?? "");
  const [debouncedQ, setDebouncedQ] = useState(() => urlParams.get("q") ?? "");
  const [filters, setFilters] = useState<string[]>(() => {
    const raw = urlParams.get("filters");
    return raw ? raw.split(",").map((f) => f.trim()).filter(Boolean) : [];
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 對應指令「十八」：搜尋輸入需要 debounce，不是每個按鍵都打一次 API。
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, filters, pageSize]);

  useEffect(() => {
    if (!operatorUserId) return;
    const params = new URLSearchParams({
      operatorUserId,
      page: String(page),
      pageSize: String(pageSize),
    });
    if (debouncedQ) params.set("q", debouncedQ);
    if (filters.length) params.set("filters", filters.join(","));

    fetch(`/api/devotee-center/list?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "載入失敗");
        return res.json();
      })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [operatorUserId, debouncedQ, filters, page, pageSize, reloadTick]);

  const totalPages = useMemo(() => (data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1), [data]);

  // 對應指令「七、上一位／下一位」：把目前的搜尋字／篩選條件一起帶到
  // 信眾完整資料編輯頁，讓上一位/下一位可以在同一個篩選範圍內移動
  // （見 src/lib/devoteeList.ts getAdjacentDevoteeIds() 說明）。
  const detailQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (filters.length) params.set("filters", filters.join(","));
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [debouncedQ, filters]);

  function toggleFilter(value: string) {
    setFilters((prev) => (prev.includes(value) ? prev.filter((f) => f !== value) : [...prev, value]));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl bg-white/70 p-5 shadow-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜尋姓名/戶名/電話/地址/家戶編號/主要聯絡人/公司名稱/Email/LINE ID/標籤"
            className="min-h-11 w-full min-w-0 rounded-full border border-cream-200 bg-cream-50 px-4 py-2 text-sm text-ink sm:w-auto sm:flex-1"
          />
          {/* V12.2「信眾建立與查詢中心」指令「一」：「新增信眾」是整套 ERP
              最高頻的操作，放在最前面、比「新增家戶」更顯眼。兩者都保留：
              新增信眾＝建立一個人（可順帶開新家戶）；新增家戶＝只開一個空戶。
              手機版兩個按鈕各自佔滿一行、min-h-11 觸控尺寸，不需要橫向捲動。 */}
          {canManage && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => setShowCreateDevotee(true)}
                className="min-h-11 w-full whitespace-nowrap rounded-full bg-sage-200 px-5 py-2 text-sm text-ink transition hover:bg-sage-300 sm:w-auto"
              >
                ➕ 新增信眾
              </button>
              <button
                type="button"
                onClick={() => setShowCreateHousehold(true)}
                className="min-h-11 w-full whitespace-nowrap rounded-full bg-ink-soft px-5 py-2 text-sm text-cream-50 transition hover:bg-ink sm:w-auto"
              >
                ➕ 新增家戶
              </button>
            </div>
          )}
        </div>

        {/* 對應指令「六」：全部／缺出生年月日／缺地址／缺電話／資料完整，
            放在搜尋框正下方最顯眼的位置。 */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => setFilters([])}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              filters.length === 0 ? "bg-yolk-200 text-ink" : "bg-cream-100 text-ink-soft hover:bg-cream-200"
            }`}
          >
            全部
          </button>
          {QUICK_FILTER_OPTIONS.map((f) => (
            <button
              key={f.value}
              onClick={() => toggleFilter(f.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                filters.includes(f.value) ? "bg-yolk-200 text-ink" : "bg-cream-100 text-ink-soft hover:bg-cream-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2 border-t border-cream-200 pt-3">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f.value}
              onClick={() => toggleFilter(f.value)}
              className={`rounded-full px-3 py-1 text-xs transition ${
                filters.includes(f.value) ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft hover:bg-cream-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-3xl bg-blossom-100 p-4 text-sm text-ink">{error}</div>}

      {/* V12.2 指令「八、手機版」：小螢幕改用卡片列表，不需要橫向捲動就能
          看到最重要的辨識資訊並點進詳情；桌面版（sm 以上）維持既有的完整
          13 欄表格，一欄都沒有拿掉。 */}
      {data && (
        <div className="flex flex-col gap-3 sm:hidden">
          {data.rows.map((r) => (
            <div key={r.memberId} className="rounded-2xl bg-white/70 p-4 shadow-card">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base text-ink">{r.name}</span>
                <Link
                  href={`/household/${r.householdId}`}
                  className="rounded-full bg-cream-100 px-2.5 py-0.5 text-xs text-ink-soft"
                >
                  {r.householdName}（{r.householdId}）
                </Link>
              </div>
              <p className="mt-1.5 text-xs text-ink-soft">
                {[r.mobile || r.householdPhone, r.lunarBirthDisplay || formatIsoDateToRocCompact(r.solarBirthDate)]
                  .filter(Boolean)
                  .join("・") || "尚未填寫聯絡資料"}
              </p>
              {r.householdAddress && (
                <p className="mt-0.5 text-xs text-ink-faint">{r.householdAddress}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {r.isDeceased && (
                  <span className="rounded-full bg-cream-300 px-2 py-0.5 text-xs text-ink-soft">已往生</span>
                )}
                {r.isDisabled && (
                  <span className="rounded-full bg-blossom-200 px-2 py-0.5 text-xs text-ink-soft">停用</span>
                )}
                {r.tags.map((t) => (
                  <span key={t} className="rounded-full bg-yolk-100 px-2 py-0.5 text-xs text-ink-soft">
                    {t}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link
                  href={`/devotee-center/${r.memberId}${detailQueryString}`}
                  className="min-h-11 rounded-full bg-mist-100 px-4 py-2 text-xs text-ink transition hover:bg-mist-200"
                >
                  查看／編輯 →
                </Link>
                {canManage && (
                  <HouseholdActionsMenu
                    householdId={r.householdId}
                    onChanged={() => setReloadTick((t) => t + 1)}
                  />
                )}
              </div>
            </div>
          ))}
          {data.rows.length === 0 && (
            <p className="rounded-2xl bg-white/70 px-4 py-8 text-center text-sm text-ink-faint shadow-card">
              沒有符合條件的信眾。
            </p>
          )}
        </div>
      )}

      {data && (
        <div className="hidden overflow-x-auto rounded-3xl bg-white/70 p-4 shadow-card sm:block">
          <table className="w-full min-w-[1150px] text-left text-sm">
            <thead>
              <tr className="text-xs text-ink-faint">
                <th className="px-3 py-2">姓名</th>
                <th className="px-3 py-2">家戶編號</th>
                <th className="px-3 py-2">戶名</th>
                <th className="px-3 py-2">出生年月日</th>
                <th className="px-3 py-2">地址</th>
                <th className="px-3 py-2">電話</th>
                <th className="px-3 py-2">標籤</th>
                <th className="px-3 py-2">最近參加活動</th>
                <th className="px-3 py-2">最近收款</th>
                <th className="px-3 py-2">狀態</th>
                {/* 對應指令「二」：列表至少需顯示「資料狀態」——這裡指資料
                    完整度（定義同指令「五」：姓名＋生日其中一種＋家戶地址），
                    跟左邊既有的「狀態」欄（在用／停用／已往生）是不同的兩件事，
                    分開各自一欄，不合併也不覆蓋既有欄位。 */}
                <th className="px-3 py-2">資料狀態</th>
                <th className="px-3 py-2"></th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const hasBirthday = Boolean(r.solarBirthDate || r.lunarBirthDisplay);
                const hasAddress = Boolean(r.householdAddress);
                const isDataComplete = hasBirthday && hasAddress; // 姓名恆為必填，不需另外檢查
                return (
                  <tr key={r.memberId} className="border-t border-cream-200">
                    <td className="px-3 py-2 text-ink">{r.name}</td>
                    {/* V12.1 一次性修正指令「二之2」：家戶編號與戶名直接連到
                        既有的家戶完整詳情頁（src/app/household/[id]/page.tsx，
                        既有 Route，沒有新增第二個詳情頁），不必再先點進成員頁
                        才能繞到家戶。 */}
                    <td className="px-3 py-2">
                      <Link
                        href={`/household/${r.householdId}`}
                        className="text-ink-soft underline-offset-4 hover:text-ink hover:underline"
                      >
                        {r.householdId}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/household/${r.householdId}`}
                        className="text-ink-soft underline-offset-4 hover:text-ink hover:underline"
                      >
                        {r.householdName}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-ink-soft">
                      {r.lunarBirthDisplay || formatIsoDateToRocCompact(r.solarBirthDate) || "—"}
                      {r.zodiac && <span className="ml-1 text-xs text-ink-faint">（{r.zodiac}）</span>}
                    </td>
                    <td className="px-3 py-2 text-ink-soft">{r.householdAddress || "—"}</td>
                    <td className="px-3 py-2 text-ink-soft">{r.mobile || r.householdPhone || "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {r.tags.map((t) => (
                          <span key={t} className="rounded-full bg-yolk-100 px-2 py-0.5 text-xs text-ink-soft">
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-ink-soft">{r.lastActivityAt || "—"}</td>
                    <td className="px-3 py-2 text-ink-soft">{r.lastPaymentAt || "—"}</td>
                    <td className="px-3 py-2 text-xs text-ink-soft">
                      {r.isDeceased && <span className="mr-1 rounded-full bg-cream-300 px-2 py-0.5">已往生</span>}
                      {r.isDisabled && <span className="rounded-full bg-blossom-200 px-2 py-0.5">停用</span>}
                      {!r.isDeceased && !r.isDisabled && "在用"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {isDataComplete ? (
                        <span className="rounded-full bg-sage-100 px-2 py-0.5 text-ink-soft">資料完整</span>
                      ) : (
                        <span className="rounded-full bg-blossom-100 px-2 py-0.5 text-ink-soft">待補資料</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/devotee-center/${r.memberId}${detailQueryString}`}
                        className="text-xs text-ink-faint underline-offset-4 hover:underline"
                      >
                        查看／編輯 →
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {/* V12.1「家戶管理中心」驗收修正輪：這一列右側的「更多
                          操作」——指定戶長／成員轉移／合併家戶／拆分家戶／
                          封存家戶，全部是上一輪已經做好、只是完全沒有入口的
                          既有 Modal／Wizard，這裡只是補上入口。 */}
                      {canManage && (
                        <HouseholdActionsMenu
                          householdId={r.householdId}
                          onChanged={() => setReloadTick((t) => t + 1)}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-ink-faint">共 {data.total} 筆</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-full bg-cream-100 px-3 py-1 disabled:opacity-40"
              >
                上一頁
              </button>
              <span className="text-ink-soft">
                第 {data.page} / {totalPages} 頁
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-full bg-cream-100 px-3 py-1 disabled:opacity-40"
              >
                下一頁
              </button>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded-full border border-cream-200 bg-cream-50 px-2 py-1"
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    每頁 {n} 筆
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {showCreateHousehold && <CreateHouseholdModal onClose={() => setShowCreateHousehold(false)} />}
      {showCreateDevotee && (
        <CreateDevoteeModal
          onClose={() => setShowCreateDevotee(false)}
          onCreated={() => setReloadTick((t) => t + 1)}
        />
      )}
    </div>
  );
}

export default function DevoteeListPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link href="/devotee-center" className="text-sm text-ink-soft hover:underline">
            ← 信眾關係中心
          </Link>
          <h1 className="text-sm text-ink-soft">📋 信眾名單</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
        <OperatorProvider>
          <OperatorBar />
          <DevoteeCenterGate>
            {/* DevoteeListInner 用了 useSearchParams()，Next.js 要求外面要有
                Suspense 邊界，否則 npm run build 靜態分析階段會報錯。 */}
            <Suspense fallback={<p className="text-sm text-ink-faint">載入中…</p>}>
              <DevoteeListInner />
            </Suspense>
          </DevoteeCenterGate>
        </OperatorProvider>
      </main>
    </div>
  );
}
