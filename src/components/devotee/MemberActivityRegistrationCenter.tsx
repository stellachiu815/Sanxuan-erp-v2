"use client";

/**
 * V36：信眾詳情頁「活動報名中心」——**純介面／流程版（UI-only）**。
 *
 * ⚠️ 本元件刻意**不串接任何寫入 API、不讀寫資料庫、不觸發任何報名建立流程**。
 *    所有狀態都是本地 useState；「確認報名」只顯示預覽提示，不送出、不建立任何資料。
 *    目的：先確認活動列表／已報名列表／報名步驟／品項選擇／摘要確認／響應式版面的體驗，
 *    之後再由另一輪工作決定是否接上既有正式報名 API（NewActivityRegistrationDialog 等）。
 *
 * 不修改：信眾資料、家戶、普渡匯入、Excel、報名建立流程、資料庫、Migration。
 */

import { useMemo, useState } from "react";

// ── 靜態活動型錄（示意資料，僅供介面呈現；非資料庫來源） ──────────────
type CatalogItem = { id: string; name: string; unitPrice: number | null; note?: string; qtyMode: "qty" | "toggle" };
type CatalogActivity = { key: string; title: string; tone: string; desc: string; items: CatalogItem[] };

const ACTIVITY_CATALOG: CatalogActivity[] = [
  {
    key: "UNIVERSAL_SALVATION",
    title: "中元普渡",
    tone: "bg-blossom-50",
    desc: "歷代祖先／乙位正魂／累世冤親債主／無緣子女牌位、寶袋、白米、贊普。",
    items: [
      { id: "us_ancestor", name: "歷代祖先牌位", unitPrice: 600, qtyMode: "qty" },
      { id: "us_soul", name: "個人乙位正魂", unitPrice: 600, qtyMode: "qty" },
      { id: "us_yuanqin", name: "累世冤親債主", unitPrice: 600, qtyMode: "qty" },
      { id: "us_unborn", name: "無緣子女", unitPrice: 600, qtyMode: "qty" },
      { id: "us_pocket", name: "額外寶袋", unitPrice: 100, qtyMode: "qty" },
      { id: "us_rice", name: "白米（斤）", unitPrice: 35, note: "以斤計", qtyMode: "qty" },
      { id: "us_sponsor", name: "贊普", unitPrice: 1500, qtyMode: "qty" },
    ],
  },
  {
    key: "ANNUAL_LANTERN",
    title: "年度燈（光明燈／太歲燈／全家燈）",
    tone: "bg-yolk-50",
    desc: "闔家點燈祈福，可整戶多人一次報名。",
    items: [
      { id: "lantern_guangming", name: "光明燈", unitPrice: 500, qtyMode: "qty" },
      { id: "lantern_taisui", name: "太歲燈", unitPrice: 500, qtyMode: "qty" },
      { id: "lantern_family", name: "全家燈", unitPrice: 2000, note: "整戶一盞", qtyMode: "toggle" },
    ],
  },
  {
    key: "PURIFICATION",
    title: "祭改",
    tone: "bg-sage-50",
    desc: "消災解厄、補運祭改。",
    items: [
      { id: "purify_basic", name: "祭改（基本）", unitPrice: 500, qtyMode: "qty" },
      { id: "purify_kubu", name: "補庫", unitPrice: 1200, qtyMode: "qty" },
    ],
  },
  {
    key: "TEMPLE_CELEBRATION",
    title: "宮慶",
    tone: "bg-mist-50",
    desc: "宮慶訂桌、供品認捐、隨喜。",
    items: [
      { id: "celebr_table", name: "宮慶訂桌", unitPrice: 6000, note: "每桌", qtyMode: "qty" },
      { id: "celebr_offering", name: "供品認捐", unitPrice: null, note: "金額另訂", qtyMode: "toggle" },
    ],
  },
];

// ── 已報名活動（可由 props 帶入真實唯讀資料；預設示意） ───────────────
type RegisteredRow = { activityName: string; year: number; amount: number; paymentStatus: string };
const SAMPLE_REGISTERED: RegisteredRow[] = [
  { activityName: "中元普渡", year: 115, amount: 1800, paymentStatus: "已收款" },
  { activityName: "光明燈", year: 115, amount: 500, paymentStatus: "未收款" },
];

function money(n: number) {
  return n.toLocaleString("zh-Hant");
}

function StatusChip({ status }: { status: string }) {
  const paid = status.includes("已收") || status.toUpperCase().includes("PAID");
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${paid ? "bg-sage-100 text-ink-soft" : "bg-blossom-100 text-ink"}`}>{status}</span>
  );
}

export default function MemberActivityRegistrationCenter({
  memberName,
  registered,
  year = 115,
}: {
  memberName?: string;
  registered?: RegisteredRow[];
  year?: number;
}) {
  const registeredRows = registered && registered.length ? registered : SAMPLE_REGISTERED;

  // 報名流程本地狀態（不送出、不寫入）。
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [activityKey, setActivityKey] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const activity = useMemo(() => ACTIVITY_CATALOG.find((a) => a.key === activityKey) ?? null, [activityKey]);
  const chosen = useMemo(
    () => (activity ? activity.items.filter((it) => (qty[it.id] ?? 0) > 0) : []),
    [activity, qty]
  );
  const total = useMemo(
    () => chosen.reduce((s, it) => s + (it.unitPrice ?? 0) * (qty[it.id] ?? 0), 0),
    [chosen, qty]
  );

  function startRegister(key: string) {
    setActivityKey(key);
    setQty({});
    setSubmitted(false);
    setStep(2);
  }
  function reset() {
    setActivityKey(null);
    setQty({});
    setSubmitted(false);
    setStep(1);
  }
  function setItemQty(id: string, next: number) {
    setQty((q) => ({ ...q, [id]: Math.max(0, next) }));
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 介面預覽聲明 */}
      <div className="rounded-2xl bg-cream-100 px-4 py-3 text-xs leading-relaxed text-ink-soft">
        這是「活動報名中心」的<span className="text-ink">介面／流程預覽</span>（V36 UI 版）。
        目前<span className="text-ink">尚未串接寫入 API</span>，所有操作皆為畫面示意，不會建立任何報名或收款、也不會修改任何資料。
      </div>

      {/* 步驟指示器 */}
      <ol className="flex items-center gap-2 text-xs">
        {[
          { n: 1, label: "選擇活動" },
          { n: 2, label: "選擇品項" },
          { n: 3, label: "摘要確認" },
        ].map((s, i) => (
          <li key={s.n} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                step === s.n ? "bg-sage-300 text-ink" : step > s.n ? "bg-sage-100 text-ink-soft" : "bg-cream-200 text-ink-faint"
              }`}
            >
              {s.n}
            </span>
            <span className={step === s.n ? "text-ink" : "text-ink-faint"}>{s.label}</span>
            {i < 2 && <span className="mx-1 h-px w-6 bg-cream-300 sm:w-10" />}
          </li>
        ))}
      </ol>

      {/* ── STEP 1：活動列表 ────────────────────────────── */}
      {step === 1 && (
        <section className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ACTIVITY_CATALOG.map((a) => (
              <div key={a.key} className={`flex flex-col justify-between gap-3 rounded-2xl ${a.tone} p-4 shadow-soft`}>
                <div>
                  <p className="text-sm font-medium text-ink">{a.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-faint">{a.desc}</p>
                  <p className="mt-2 text-xs text-ink-soft">可報名品項：{a.items.length} 項</p>
                </div>
                <button
                  type="button"
                  onClick={() => startRegister(a.key)}
                  className="min-h-11 rounded-full bg-white/80 px-4 py-2 text-sm font-medium text-ink shadow-soft transition hover:bg-white"
                >
                  開始報名 →
                </button>
              </div>
            ))}
          </div>

          {/* 已報名活動列表 */}
          <div className="rounded-2xl bg-white/70 p-4 shadow-card">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-ink">已報名活動{memberName ? `（${memberName}）` : ""}</h3>
              <span className="text-xs text-ink-faint">民國 {year} 年度</span>
            </div>
            {registeredRows.length === 0 ? (
              <p className="mt-3 text-xs text-ink-faint">目前沒有已報名的活動。</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {registeredRows.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-cream-50 px-4 py-2.5">
                    <span className="text-sm text-ink">{r.activityName}<span className="ml-2 text-xs text-ink-faint">民國 {r.year} 年</span></span>
                    <span className="flex items-center gap-3">
                      <span className="text-sm text-ink-soft">NT$ {money(r.amount)}</span>
                      <StatusChip status={r.paymentStatus} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* ── STEP 2：品項選擇 ────────────────────────────── */}
      {step === 2 && activity && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-ink">{activity.title}・選擇品項</h3>
            <button type="button" onClick={reset} className="text-xs text-ink-faint underline-offset-4 hover:underline">重新選活動</button>
          </div>
          <ul className="flex flex-col gap-2">
            {activity.items.map((it) => {
              const q = qty[it.id] ?? 0;
              return (
                <li key={it.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/70 px-4 py-3 shadow-soft">
                  <div>
                    <p className="text-sm text-ink">{it.name}</p>
                    <p className="text-xs text-ink-faint">
                      {it.unitPrice == null ? "金額另訂" : `單價 NT$ ${money(it.unitPrice)}`}{it.note ? `・${it.note}` : ""}
                    </p>
                  </div>
                  {it.qtyMode === "toggle" ? (
                    <label className="flex items-center gap-2 text-sm text-ink-soft">
                      <input type="checkbox" checked={q > 0} onChange={(e) => setItemQty(it.id, e.target.checked ? 1 : 0)} />
                      選取
                    </label>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setItemQty(it.id, q - 1)} className="h-8 w-8 rounded-full bg-cream-200 text-ink-soft hover:bg-cream-300">−</button>
                      <span className="w-8 text-center text-sm text-ink">{q}</span>
                      <button type="button" onClick={() => setItemQty(it.id, q + 1)} className="h-8 w-8 rounded-full bg-cream-200 text-ink-soft hover:bg-cream-300">＋</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink-soft">已選 {chosen.length} 項・小計 NT$ {money(total)}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setStep(1)} className="min-h-11 rounded-full bg-cream-200 px-5 py-2 text-sm text-ink-soft hover:bg-cream-300">← 上一步</button>
              <button
                type="button"
                disabled={chosen.length === 0}
                onClick={() => setStep(3)}
                className="min-h-11 rounded-full bg-yolk-200 px-5 py-2 text-sm font-medium text-ink transition hover:bg-yolk-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                下一步：摘要確認 →
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── STEP 3：摘要與確認 ──────────────────────────── */}
      {step === 3 && activity && (
        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-medium text-ink">報名摘要確認</h3>
          <div className="rounded-2xl bg-white/70 p-4 shadow-card">
            <div className="flex items-center justify-between border-b border-cream-200 pb-2">
              <span className="text-sm text-ink">{activity.title}</span>
              {memberName && <span className="text-xs text-ink-faint">報名人：{memberName}</span>}
            </div>
            <ul className="mt-3 flex flex-col gap-2">
              {chosen.map((it) => (
                <li key={it.id} className="flex items-center justify-between text-sm">
                  <span className="text-ink-soft">{it.name} × {qty[it.id]}</span>
                  <span className="text-ink">{it.unitPrice == null ? "金額另訂" : `NT$ ${money((it.unitPrice ?? 0) * (qty[it.id] ?? 0))}`}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between border-t border-cream-200 pt-2">
              <span className="text-sm text-ink">合計（示意）</span>
              <span className="text-lg text-ink">NT$ {money(total)}</span>
            </div>
          </div>

          {submitted ? (
            <div className="rounded-2xl bg-sage-100 px-4 py-3 text-sm leading-relaxed text-ink">
              ✅ 這是介面預覽：流程已走完，但<span className="font-medium">尚未串接寫入 API</span>，因此
              <span className="font-medium">未建立任何報名、未產生收款</span>，也未修改任何資料。
              <div className="mt-2">
                <button type="button" onClick={reset} className="rounded-full bg-white/80 px-4 py-1.5 text-xs text-ink-soft hover:bg-white">回到活動列表</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-ink-faint">確認後僅顯示預覽結果，不會送出或建立任何資料。</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setStep(2)} className="min-h-11 rounded-full bg-cream-200 px-5 py-2 text-sm text-ink-soft hover:bg-cream-300">← 修改品項</button>
                <button type="button" onClick={() => setSubmitted(true)} className="min-h-11 rounded-full bg-sage-300 px-5 py-2 text-sm font-medium text-ink hover:brightness-95">確認報名（預覽）</button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
