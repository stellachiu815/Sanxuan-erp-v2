"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OperatorProvider, useOperator } from "@/lib/operatorClient";
import { canDevotee } from "@/lib/permissions";
import OperatorBar from "@/components/system/OperatorBar";
import DevoteeCenterGate from "@/components/devotee/DevoteeCenterGate";

type CareEntry = {
  memberId: string;
  name: string;
  householdName: string;
  contact: string | null;
  careReason: string;
  lastContactedAt: string | null;
  nextContactSuggestedAt: string | null;
  careAssignedToName: string | null;
  isOfficiallyFlagged: boolean;
  suggestionSources: string[];
};

function CareListInner() {
  const { operatorUserId, operatorUser } = useOperator();
  const [flagged, setFlagged] = useState<CareEntry[] | null>(null);
  const [suggested, setSuggested] = useState<CareEntry[] | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const canManage = operatorUser?.role ? canDevotee(operatorUser.role, "manageCareList") : false;

  useEffect(() => {
    if (!operatorUserId) return;
    fetch(`/api/devotee-center/care?operatorUserId=${encodeURIComponent(operatorUserId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        setFlagged(d?.flagged ?? []);
        setSuggested(d?.suggested ?? []);
      })
      .catch(() => {
        setFlagged([]);
        setSuggested([]);
      });
  }, [operatorUserId, reloadTick]);

  async function flagOfficially(memberId: string, reason: string) {
    if (!operatorUserId) return;
    const res = await fetch(`/api/devotee-center/${memberId}/care/flag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operatorUserId, reason }),
    });
    if (res.ok) setReloadTick((t) => t + 1);
  }

  async function unflag(memberId: string) {
    if (!operatorUserId) return;
    const res = await fetch(`/api/devotee-center/${memberId}/care/unflag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operatorUserId }),
    });
    if (res.ok) setReloadTick((t) => t + 1);
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <h2 className="text-base font-medium text-ink">💗 已正式標記需要關懷</h2>
        <p className="mt-1 text-xs text-ink-faint">由管理者明確標記的名單。</p>
        {!flagged ? (
          <p className="mt-4 text-sm text-ink-faint">載入中…</p>
        ) : flagged.length === 0 ? (
          <p className="mt-4 text-sm text-ink-faint">目前沒有已正式標記的信眾。</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {flagged.map((e) => (
              <li key={e.memberId} className="rounded-2xl bg-cream-50 p-4 text-sm">
                <div className="flex items-center justify-between">
                  <Link href={`/devotee-center/${e.memberId}`} className="text-ink underline-offset-4 hover:underline">
                    {e.name}（{e.householdName}）
                  </Link>
                  {canManage && (
                    <button onClick={() => unflag(e.memberId)} className="rounded-full bg-cream-200 px-3 py-1 text-xs text-ink-soft hover:bg-cream-300">
                      取消標記
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-ink-soft">原因：{e.careReason}</p>
                <p className="mt-1 text-xs text-ink-faint">
                  聯絡方式：{e.contact ?? "無"}・負責人：{e.careAssignedToName ?? "未指派"}・下次聯絡：{e.nextContactSuggestedAt ?? "未設定"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <h2 className="text-base font-medium text-ink">💡 系統建議關懷名單</h2>
        <p className="mt-1 text-xs text-ink-faint">
          系統只會列出建議，不會自動標記為需要關懷——是否正式標記由管理者決定（對應指令「十一」）。
        </p>
        {!suggested ? (
          <p className="mt-4 text-sm text-ink-faint">載入中…</p>
        ) : suggested.length === 0 ? (
          <p className="mt-4 text-sm text-ink-faint">目前沒有系統建議項目。</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {suggested.map((e) => (
              <li key={e.memberId} className="rounded-2xl bg-cream-50 p-4 text-sm">
                <div className="flex items-center justify-between">
                  <Link href={`/devotee-center/${e.memberId}`} className="text-ink underline-offset-4 hover:underline">
                    {e.name}（{e.householdName}）
                  </Link>
                  {canManage && (
                    <button
                      onClick={() => flagOfficially(e.memberId, e.suggestionSources.join("；"))}
                      className="rounded-full bg-sage-200 px-3 py-1 text-xs text-ink hover:bg-sage-300"
                    >
                      正式標記
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-ink-soft">建議原因：{e.suggestionSources.join("；")}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function DevoteeCarePage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <Link href="/devotee-center" className="text-sm text-ink-soft hover:underline">
            ← 信眾關係中心
          </Link>
          <h1 className="text-sm text-ink-soft">💗 需要關懷名單</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-10">
        <OperatorProvider>
          <OperatorBar />
          <DevoteeCenterGate>
            <CareListInner />
          </DevoteeCenterGate>
        </OperatorProvider>
      </main>
    </div>
  );
}
