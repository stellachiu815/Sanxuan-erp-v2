"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OperatorProvider, useOperator, roleLabel } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import SystemCenterGate from "@/components/system-center/SystemCenterGate";

type ManagedUser = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
};

// V12 指令「九」明確只開放從這個畫面指定這三種角色（SUPER_ADMIN／
// FINANCE_CLERK 不開放，見 API route 說明）。
const ASSIGNABLE_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "ADMIN", label: "管理員" },
  { value: "STAFF", label: "一般工作人員" },
  { value: "READONLY", label: "唯讀人員" },
];

function UsersManagementInner() {
  const { operatorUserId, reload: reloadOperatorList } = useOperator();
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  function refresh() {
    setReloadTick((t) => t + 1);
    reloadOperatorList(); // 新增/改名/停用之後，畫面上方「目前操作人員」下拉選單也要跟著更新
  }

  useEffect(() => {
    if (!operatorUserId) return;
    fetch(`/api/system-center/users?operatorUserId=${encodeURIComponent(operatorUserId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "載入失敗");
        return res.json();
      })
      .then((d) => {
        setUsers(d.users);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [operatorUserId, reloadTick]);

  if (error) return <div className="rounded-3xl bg-blossom-100 p-6 text-sm text-ink">{error}</div>;
  if (!users) return <p className="text-sm text-ink-faint">載入中…</p>;

  return (
    <div className="flex flex-col gap-6">
      <CreateUserForm operatorUserId={operatorUserId} onCreated={refresh} />

      <div className="overflow-x-auto rounded-3xl bg-white/70 p-4 shadow-card">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead>
            <tr className="text-xs text-ink-faint">
              <th className="px-3 py-2">姓名</th>
              <th className="px-3 py-2">角色</th>
              <th className="px-3 py-2">狀態</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow key={u.id} user={u} operatorUserId={operatorUserId} onChanged={refresh} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateUserForm({ operatorUserId, onCreated }: { operatorUserId: string | null; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("STAFF");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!operatorUserId || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/system-center/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId, name: name.trim(), role }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "建立失敗");
      setName("");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "建立失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-3xl bg-white/70 p-6 shadow-card">
      <h2 className="text-sm font-medium text-ink">＋ 建立操作人員</h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="姓名"
          className="rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm text-ink"
        />
        <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm text-ink">
          {ASSIGNABLE_ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button disabled={saving || !name.trim()} onClick={submit} className="rounded-full bg-sage-200 px-5 py-1.5 text-sm font-medium text-ink disabled:opacity-40">
          {saving ? "建立中…" : "建立"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-blossom-300">{error}</p>}
      <p className="mt-2 text-xs text-ink-faint">
        這裡建立的是「操作人員」身分，不是登入帳號——不需要密碼，選出來的人在畫面上方「目前操作人員」下拉選單就能選到自己。
      </p>
    </div>
  );
}

function UserRow({
  user,
  operatorUserId,
  onChanged,
}: {
  user: ManagedUser;
  operatorUserId: string | null;
  onChanged: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(user.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSuperAdmin = user.role === "SUPER_ADMIN";

  async function patch(body: Record<string, unknown>) {
    if (!operatorUserId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/system-center/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId, ...body }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "儲存失敗");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-t border-cream-200 align-top">
      <td className="px-3 py-2 text-ink">
        {editingName ? (
          <div className="flex items-center gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-full border border-cream-200 bg-cream-50 px-2 py-1 text-sm" />
            <button
              disabled={saving || !name.trim()}
              onClick={async () => {
                await patch({ name: name.trim() });
                setEditingName(false);
              }}
              className="text-xs text-ink-soft hover:underline"
            >
              儲存
            </button>
            <button onClick={() => { setEditingName(false); setName(user.name); }} className="text-xs text-ink-faint hover:underline">
              取消
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span>{user.name}</span>
            <button onClick={() => setEditingName(true)} className="text-xs text-ink-faint hover:underline">
              修改姓名
            </button>
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-ink-soft">
        {isSuperAdmin ? (
          <span>{roleLabel[user.role] ?? user.role}</span>
        ) : (
          <select
            value={user.role}
            disabled={saving}
            onChange={(e) => patch({ role: e.target.value })}
            className="rounded-full border border-cream-200 bg-cream-50 px-2 py-1 text-xs"
          >
            {ASSIGNABLE_ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="px-3 py-2">
        <span className={`rounded-full px-2 py-0.5 text-xs ${user.isActive ? "bg-sage-100 text-ink-soft" : "bg-cream-300 text-ink-faint"}`}>
          {user.isActive ? "啟用中" : "已停用"}
        </span>
      </td>
      <td className="px-3 py-2">
        {!isSuperAdmin && (
          <button
            disabled={saving}
            onClick={() => patch({ isActive: !user.isActive })}
            className="rounded-full bg-cream-100 px-3 py-1 text-xs text-ink-soft hover:bg-cream-200 disabled:opacity-40"
          >
            {user.isActive ? "停用" : "啟用"}
          </button>
        )}
        {error && <p className="mt-1 text-xs text-blossom-300">{error}</p>}
      </td>
    </tr>
  );
}

export default function UsersManagementPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <Link href="/system-center" className="text-sm text-ink-soft hover:underline">
            ← 系統管理
          </Link>
          <h1 className="text-sm text-ink-soft">👤 使用者帳號管理</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-10">
        <div className="rounded-3xl bg-white/70 p-4 text-xs text-ink-faint shadow-soft">
          ⚠️ 這裡管理的是系統既有的「操作人員」身分（沒有密碼、沒有登入驗證，只是讓行政人員從下拉選單選出自己是誰）。
          登入帳號與密碼是獨立的資安模組，之後另外規劃，這次不在這裡加入。
        </div>
        <OperatorProvider>
          <OperatorBar />
          {/* V12 指令「九」：ADMIN 也能使用這個功能，見 SystemCenterGate 的
              action 參數說明——不是套用整個系統管理中心 SUPER_ADMIN 專屬
              的 viewSystemCenter。 */}
          <SystemCenterGate action="manageUsers">
            <UsersManagementInner />
          </SystemCenterGate>
        </OperatorProvider>
      </main>
    </div>
  );
}
