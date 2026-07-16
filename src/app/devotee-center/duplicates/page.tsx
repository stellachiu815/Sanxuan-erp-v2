"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OperatorProvider, useOperator } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import DevoteeCenterGate from "@/components/devotee/DevoteeCenterGate";

type Group = {
  reason: string;
  reasonLabel: string;
  members: { memberId: string; name: string; householdId: string; householdName: string }[];
};

function DuplicatesInner() {
  const { operatorUserId } = useOperator();
  const [groups, setGroups] = useState<Group[] | null>(null);

  useEffect(() => {
    if (!operatorUserId) return;
    fetch(`/api/devotee-center/duplicates?operatorUserId=${encodeURIComponent(operatorUserId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => setGroups(d?.groups ?? []))
      .catch(() => setGroups([]));
  }, [operatorUserId]);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl bg-blossom-100 p-5 text-sm text-ink">
        疑似重複僅供人工確認，系統不會自動刪除或合併資料。
      </div>

      {!groups ? (
        <p className="text-sm text-ink-faint">載入中…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-ink-faint">目前沒有偵測到疑似重複的信眾資料。</p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g, idx) => (
            <div key={idx} className="rounded-3xl bg-white/70 p-5 shadow-card">
              <p className="text-xs text-ink-faint">{g.reasonLabel}</p>
              <div className="mt-2 flex flex-wrap gap-3">
                {g.members.map((m) => (
                  <Link
                    key={m.memberId}
                    href={`/devotee-center/${m.memberId}`}
                    className="rounded-2xl bg-cream-100 px-4 py-2 text-sm text-ink underline-offset-4 hover:underline"
                  >
                    {m.name}（{m.householdName}・{m.householdId}）
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DevoteeDuplicatesPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <Link href="/devotee-center" className="text-sm text-ink-soft hover:underline">
            ← 信眾關係中心
          </Link>
          <h1 className="text-sm text-ink-soft">🧩 疑似重複信眾</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-10">
        <OperatorProvider>
          <OperatorBar />
          <DevoteeCenterGate>
            <DuplicatesInner />
          </DevoteeCenterGate>
        </OperatorProvider>
      </main>
    </div>
  );
}
