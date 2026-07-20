"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OperatorProvider, useOperator } from "@/lib/operatorClient";
import { canDevotee } from "@/lib/permissions";
import OperatorBar from "@/components/system/OperatorBar";
import DevoteeCenterGate from "@/components/devotee/DevoteeCenterGate";

type Tag = { id: string; name: string; isSystemDefault: boolean; isActive: boolean; note: string | null };

function TagsInner() {
  const { operatorUserId, operatorUser } = useOperator();
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const canManage = operatorUser?.role ? canDevotee(operatorUser.role, "manageTags") : false;

  useEffect(() => {
    if (!operatorUserId) return;
    fetch(`/api/devotee-center/tags?operatorUserId=${encodeURIComponent(operatorUserId)}&includeInactive=1`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => setTags(d?.tags ?? []))
      .catch(() => setTags([]));
  }, [operatorUserId, reloadTick]);

  async function createTag() {
    if (!operatorUserId || !newName.trim()) return;
    setError(null);
    const res = await fetch("/api/devotee-center/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operatorUserId, name: newName }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? "新增失敗");
      return;
    }
    setNewName("");
    setReloadTick((t) => t + 1);
  }

  async function toggleActive(tagId: string, isActive: boolean) {
    if (!operatorUserId) return;
    await fetch(`/api/devotee-center/tags/${tagId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operatorUserId, isActive: !isActive }),
    });
    setReloadTick((t) => t + 1);
  }

  return (
    <div className="flex flex-col gap-6">
      {canManage && (
        <div className="rounded-3xl bg-white/70 p-5 shadow-card">
          <h2 className="text-sm font-medium text-ink">新增自訂標籤</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="標籤名稱"
              className="min-h-11 w-full min-w-0 flex-1 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm sm:min-w-[160px]"
            />
            <button onClick={createTag} className="rounded-full bg-sage-200 px-4 py-1.5 text-sm text-ink">
              新增
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-blossom-300">{error}</p>}
        </div>
      )}

      <div className="rounded-3xl bg-white/70 p-5 shadow-card">
        <h2 className="text-sm font-medium text-ink">全部標籤</h2>
        {!tags ? (
          <p className="mt-3 text-sm text-ink-faint">載入中…</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {tags.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-2xl bg-cream-50 px-4 py-2 text-sm">
                <span className={t.isActive ? "text-ink" : "text-ink-faint line-through"}>
                  {t.name}
                  {t.isSystemDefault && <span className="ml-2 rounded-full bg-yolk-100 px-2 py-0.5 text-xs">預設</span>}
                </span>
                {canManage && (
                  <button
                    onClick={() => toggleActive(t.id, t.isActive)}
                    className="rounded-full bg-cream-200 px-3 py-1 text-xs text-ink-soft hover:bg-cream-300"
                  >
                    {t.isActive ? "停用" : "恢復啟用"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function DevoteeTagsPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <Link href="/devotee-center" className="text-sm text-ink-soft hover:underline">
            ← 信眾關係中心
          </Link>
          <h1 className="text-sm text-ink-soft">🏷️ 標籤管理</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
        <OperatorProvider>
          <OperatorBar />
          <DevoteeCenterGate>
            <TagsInner />
          </DevoteeCenterGate>
        </OperatorProvider>
      </main>
    </div>
  );
}
