import Link from "next/link";
import { notFound } from "next/navigation";
import { getHouseholdDetail } from "@/lib/household";
import { worshipTypeLabel, activityTypeLabel, memberRoleLabel } from "@/lib/labels";
import HeaderSearchBar from "@/components/HeaderSearchBar";
import QuickActionsPanel from "@/components/household/QuickActionsPanel";

export default async function HouseholdPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ member?: string }>;
}) {
  const { id } = await params;
  const { member: memberParam } = await searchParams;
  const household = await getHouseholdDetail(id);

  if (!household) {
    // notFound() 本身在執行期一定會中止渲染；這裡多加一行 throw 只是為了讓
    // TypeScript 自己就能證明「往下走 household 一定不是 null」，不依賴
    // next/navigation 的型別宣告（這個沙盒沒有安裝套件，型別檔案不存在時
    // notFound() 會被當成 any，TS 就無法用它來做控制流程窄化）。
    notFound();
    throw new Error("household not found");
  }

  // V6.0「信眾時間軸」：從搜尋結果帶進來的成員 id，只有真的屬於這一戶
  // 才採用，往下傳給「歷年紀錄」連結，時間軸頁面才能預設切到這位成員視角。
  const focusedMemberId =
    memberParam && household.members.some((m) => m.id === memberParam) ? memberParam : null;

  return (
    <div className="min-h-screen">
      {/* 固定搜尋框：不用回首頁就能搜尋下一位信眾 */}
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          <span className="whitespace-nowrap text-sm text-ink-soft">三玄宮行政系統</span>
          <HeaderSearchBar />
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
        {/* ① 家戶資訊 */}
        <section className="rounded-3xl bg-white/70 p-8 shadow-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-2xl font-medium text-ink">{household.name}</h1>
            <span className="rounded-full bg-yolk-50 px-3 py-1 text-sm text-ink-soft">
              {household.id}
            </span>
          </div>
          <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <InfoRow label="主要聯絡人" value={household.contactName} />
            <InfoRow label="電話" value={household.phone} />
            <InfoRow label="手機" value={household.mobile} />
            <InfoRow label="地址" value={household.address} className="sm:col-span-2" />
          </dl>
        </section>

        {/* ② 家戶成員 */}
        <section className="rounded-3xl bg-white/70 p-8 shadow-card">
          <h2 className="text-lg font-medium text-ink">家戶成員</h2>
          <div className="mt-5 flex flex-col gap-3">
            {household.members.length === 0 && (
              <p className="text-sm text-ink-faint">尚無成員資料。</p>
            )}
            {household.members.map((m) => (
              <div
                key={m.id}
                className={`rounded-2xl px-5 py-4 ${m.isDeceased ? "bg-mist-50" : "bg-sage-50"}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-medium text-ink">{m.name}</span>
                  {m.gender && <span className="text-xs text-ink-faint">{m.gender}</span>}
                  <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-ink-soft">
                    {memberRoleLabel[m.role] ?? m.role}
                  </span>
                  {m.isPrimaryContact && (
                    <span className="rounded-full bg-yolk-100 px-2 py-0.5 text-xs text-ink-soft">
                      主要聯絡人
                    </span>
                  )}
                  {m.isDeceased && (
                    <span className="rounded-full bg-mist-200 px-2 py-0.5 text-xs text-ink-soft">
                      已辭世
                    </span>
                  )}
                  {m.nominalAge !== null && (
                    <span className="ml-auto rounded-full bg-white/70 px-3 py-1 text-sm text-ink">
                      虛歲 {m.nominalAge}
                    </span>
                  )}
                </div>

                {m.isDeceased && m.yangshangName && (
                  <p className="mt-1 text-sm text-ink-soft">陽上姓名：{m.yangshangName}</p>
                )}

                {(m.solarBirthDateText || m.lunarBirthDateText) && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
                    {/* 農曆為主、國曆（民國）為輔；全系統不顯示西元年份（V14.1 十六）。 */}
                    {m.lunarBirthDateText && <span>農曆：{m.lunarBirthDateText}</span>}
                    {m.solarBirthDateText && <span>國曆：{m.solarBirthDateText}</span>}
                    {m.zodiac && <span>生肖：{m.zodiac}</span>}
                    {m.actualAge !== null && <span>實歲：{m.actualAge}</span>}
                    {m.nominalAge !== null && <span>虛歲：{m.nominalAge}</span>}
                  </div>
                )}

                {m.notes && <p className="mt-2 text-sm text-ink-faint">備註：{m.notes}</p>}

                <div className="mt-3">
                  <Link
                    href={`/offering-center/member/${m.id}`}
                    className="text-xs text-ink-soft hover:underline"
                  >
                    🙏 供品認捐歷年查詢 →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ③ 祭祀資料 */}
        <section className="rounded-3xl bg-white/70 p-8 shadow-card">
          <h2 className="text-lg font-medium text-ink">祭祀資料</h2>
          <div className="mt-5 flex flex-col gap-3">
            {household.worshipRecords.length === 0 && (
              <p className="text-sm text-ink-faint">尚無祭祀資料。</p>
            )}
            {household.worshipRecords.map((w) => (
              <div key={w.id} className="rounded-2xl bg-blossom-50 px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base text-ink">{w.displayName}</span>
                  <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-ink-soft">
                    {worshipTypeLabel[w.type] ?? w.type}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-ink-soft">
                  {w.location && <span>安奉地：{w.location}</span>}
                  {w.yangshangName && <span>陽上姓名：{w.yangshangName}</span>}
                </div>
                {w.notes && <p className="mt-1 text-sm text-ink-faint">備註：{w.notes}</p>}
              </div>
            ))}
          </div>
        </section>

        {/* ④ 今天要辦 —— 行政工作中心的核心操作區。 */}
        <section className="rounded-3xl bg-white/70 p-8 shadow-card">
          <h2 className="text-lg font-medium text-ink">今天要辦</h2>
          <p className="mt-1 text-sm text-ink-faint">選擇要為這一戶進行的作業</p>
          <div className="mt-5">
            <QuickActionsPanel
              householdId={household.id}
              focusedMemberId={focusedMemberId}
              household={{
                name: household.name,
                contactName: household.contactName,
                phone: household.phone,
                mobile: household.mobile,
                address: household.address,
                companyName: household.companyName,
                notes: household.notes,
              }}
              members={household.members.map((m) => ({ id: m.id, name: m.name, role: m.role }))}
              worshipRecords={household.worshipRecords.map((w) => ({
                id: w.id,
                type: w.type,
                displayName: w.displayName,
              }))}
            />
          </div>
        </section>

        {/* ⑤ 歷史活動 */}
        <section className="rounded-3xl bg-white/70 p-8 shadow-card">
          <h2 className="text-lg font-medium text-ink">歷史活動</h2>

          {/* V12.3 指令一.B：合併進本戶的來源家戶，其家戶層級歷史（活動／祭祀）
              刻意保留在原家戶不改寫，改成在這裡一併顯示並標示原家戶，
              避免使用者誤以為那些紀錄是合併之後才產生的。 */}
          {household.mergedFromHouseholds.length > 0 && (
            <p className="mt-3 rounded-2xl bg-mist-50 px-4 py-2.5 text-xs leading-relaxed text-ink-soft">
              本戶已合併{" "}
              {household.mergedFromHouseholds
                .map((h) => `${h.name}（${h.id}）`)
                .join("、")}
              。下方標示「原家戶」的紀錄來自合併前的來源家戶，仍保留其原始歸戶，不是合併後才產生的。
            </p>
          )}

          <div className="mt-5 flex flex-col gap-2">
            {household.activities.length === 0 && (
              <p className="text-sm text-ink-faint">尚無活動紀錄。</p>
            )}
            {household.activities.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center gap-2 rounded-2xl bg-cream-200/60 px-4 py-3 text-sm sm:gap-3 sm:px-5"
              >
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-ink-soft">
                  {activityTypeLabel[a.type] ?? a.type}
                </span>
                {a.year && <span className="text-ink-soft">{a.year} 年</span>}
                {a.note && <span className="text-ink-faint">{a.note}</span>}
                {a.originHouseholdId && (
                  <span className="rounded-full bg-yolk-100 px-2 py-0.5 text-xs text-ink-soft">
                    原家戶：{a.originHouseholdName ?? ""}（{a.originHouseholdId}）
                  </span>
                )}
                <span className="ml-auto text-xs text-ink-faint">
                  {new Date(a.createdAt).toLocaleDateString("zh-TW")}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ⑥ 備註 */}
        <section className="rounded-3xl bg-white/70 p-8 shadow-card">
          <h2 className="text-lg font-medium text-ink">備註</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm text-ink-soft">
            {household.notes || "（無）"}
          </p>
        </section>
      </main>
    </div>
  );
}

function InfoRow({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string | null;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value || "（未填寫）"}</dd>
    </div>
  );
}
