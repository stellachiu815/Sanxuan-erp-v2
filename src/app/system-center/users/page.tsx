"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { roleLabel } from "@/lib/operatorClient";
import SystemCenterGate from "@/components/system-center/SystemCenterGate";

/**
 * V14.3【登入帳號管理】。
 *
 * 這一頁管理「正式登入帳號」：登入帳號（loginId）＋密碼＋角色＋啟用/停用。
 * 資料仍存在既有的 User 資料表，一個 User 同時是「操作人員身分（name）」與
 * 「登入帳號（loginId + passwordHash）」：
 *  - 有設定 loginId＋密碼的 User＝可登入的帳號；
 *  - 只有 name、沒有 loginId 的 User＝舊的純操作人員（顯示用，不能登入）。
 * 兩者不混在一起：畫面明確標示，並可把純操作人員「設定登入帳號」升級成
 * 可登入帳號（不新增第二套資料）。真正權限仍由各 API 的 assert 把關。
 */

type ManagedUser = {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
  loginId: string | null;
  hasPassword: boolean;
  createdAt: string;
};

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "SUPER_ADMIN", label: "最高管理員" },
  { value: "ADMIN", label: "管理員" },
  { value: "STAFF", label: "一般工作人員" },
  { value: "READONLY", label: "唯讀人員" },
];

function AccountManagementInner() {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const refresh = useCallback(() => setReloadTick((t) => t + 1), []);

  useEffect(() => {
    fetch("/api/system-center/users")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "載入失敗");
        return res.json();
      })
      .then((d) => {
        setUsers(d.users);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [reloadTick]);

  if (error) return <div className="rounded-3xl bg-blossom-100 p-6 text-sm text-ink">{error}</div>;
  if (!users) return <p className="text-sm text-ink-faint">載入中…</p>;

  const loginAccounts = users.filter((u) => u.loginId);
  const operatorsOnly = users.filter((u) => !u.loginId);

  return (
    <div className="flex flex-col gap-6">
      <CreateAccountForm onCreated={refresh} />

      <section className="rounded-3xl bg-white/70 p-4 shadow-card">
        <h2 className="px-2 py-1 text-sm font-medium text-ink">登入帳號（可登入系統）</h2>
        {loginAccounts.length === 0 ? (
          <p className="px-2 py-3 text-sm text-ink-faint">目前還沒有任何登入帳號，請用上方表單新增。</p>
        ) : (
          <AccountTable users={loginAccounts} onChanged={refresh} />
        )}
      </section>

      {operatorsOnly.length > 0 && (
        <section className="rounded-3xl bg-white/70 p-4 shadow-card">
          <h2 className="px-2 py-1 text-sm font-medium text-ink">操作人員（尚無登入帳號）</h2>
          <p className="px-2 pb-2 text-xs text-ink-faint">
            這些是既有的操作人員資料（沒有登入帳號、不能登入）。可為其「設定登入帳號」升級成可登入帳號，資料不會另建一份。
          </p>
          <AccountTable users={operatorsOnly} onChanged={refresh} />
        </section>
      )}
    </div>
  );
}

function CreateAccountForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("STAFF");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || !loginId.trim() || password.length < 6) {
      setError("請填寫姓名、登入帳號，且密碼至少 6 碼");
      return;
    }
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/system-center/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), loginId: loginId.trim(), password, role }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "建立失敗");
      setOk(`已建立登入帳號「${loginId.trim()}」（${roleLabel[role] ?? role}）。`);
      setName("");
      setLoginId("");
      setPassword("");
      setRole("STAFF");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "建立失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-3xl bg-white/70 p-6 shadow-card">
      <h2 className="text-sm font-medium text-ink">＋ 新增登入帳號</h2>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs text-ink-soft">
          姓名
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="王小明"
            className="mt-1 w-full rounded-xl border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm text-ink" />
        </label>
        <label className="text-xs text-ink-soft">
          登入帳號（loginId）
          <input value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="staff01" autoComplete="off"
            className="mt-1 w-full rounded-xl border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm text-ink" />
        </label>
        <label className="text-xs text-ink-soft">
          初始密碼（至少 6 碼）
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password"
            className="mt-1 w-full rounded-xl border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm text-ink" />
        </label>
        <label className="text-xs text-ink-soft">
          角色
          <select value={role} onChange={(e) => setRole(e.target.value)}
            className="mt-1 w-full rounded-xl border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm text-ink">
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button disabled={saving} onClick={submit}
          className="rounded-full bg-sage-200 px-5 py-1.5 text-sm font-medium text-ink disabled:opacity-40">
          {saving ? "建立中…" : "建立登入帳號"}
        </button>
        {error && <p className="text-xs text-blossom-400">{error}</p>}
        {ok && <p className="text-xs text-sage-400">{ok}</p>}
      </div>
    </div>
  );
}

function AccountTable({ users, onChanged }: { users: ManagedUser[]; onChanged: () => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead>
          <tr className="text-xs text-ink-faint">
            <th className="px-3 py-2">姓名</th>
            <th className="px-3 py-2">登入帳號</th>
            <th className="px-3 py-2">角色</th>
            <th className="px-3 py-2">狀態</th>
            <th className="px-3 py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <AccountRow key={u.id} user={u} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountRow({ user, onChanged }: { user: ManagedUser; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [pwd, setPwd] = useState("");
  const [newLoginId, setNewLoginId] = useState("");

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(`/api/system-center/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "儲存失敗");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  async function submitPassword() {
    if (pwd.length < 6) {
      setError("密碼至少 6 碼");
      return;
    }
    // 沒有 loginId 的操作人員：升級成登入帳號時，必須同時設定 loginId。
    if (!user.loginId && !newLoginId.trim()) {
      setError("請先設定登入帳號（loginId）");
      return;
    }
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(`/api/system-center/users/${user.id}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd, ...(user.loginId ? {} : { loginId: newLoginId.trim() }) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "設定失敗");
      setOk(user.loginId ? "已重設密碼（該帳號需重新登入）。" : "已設定登入帳號與密碼。");
      setPwd("");
      setNewLoginId("");
      setShowPwd(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "設定失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-t border-cream-200 align-top">
      <td className="px-3 py-2 text-ink">{user.name}</td>
      <td className="px-3 py-2 text-ink-soft">
        {user.loginId ? (
          <span className="font-mono">{user.loginId}</span>
        ) : (
          <span className="text-xs text-ink-faint">—（無登入）</span>
        )}
      </td>
      <td className="px-3 py-2">
        <select
          value={user.role}
          disabled={saving}
          onChange={(e) => patch({ role: e.target.value })}
          className="rounded-full border border-cream-200 bg-cream-50 px-2 py-1 text-xs"
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <span className={`rounded-full px-2 py-0.5 text-xs ${user.isActive ? "bg-sage-100 text-ink-soft" : "bg-cream-300 text-ink-faint"}`}>
          {user.isActive ? "啟用中" : "已停用"}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={saving} onClick={() => patch({ isActive: !user.isActive })}
            className="rounded-full bg-cream-100 px-3 py-1 text-xs text-ink-soft hover:bg-cream-200 disabled:opacity-40">
            {user.isActive ? "停用" : "啟用"}
          </button>
          <button onClick={() => { setShowPwd((v) => !v); setError(null); setOk(null); }}
            className="rounded-full bg-cream-100 px-3 py-1 text-xs text-ink-soft hover:bg-cream-200">
            {user.loginId ? "重設密碼" : "設定登入帳號"}
          </button>
        </div>
        {showPwd && (
          <div className="mt-2 flex flex-col gap-1 rounded-xl bg-cream-50 p-2">
            {!user.loginId && (
              <input value={newLoginId} onChange={(e) => setNewLoginId(e.target.value)} placeholder="登入帳號 loginId" autoComplete="off"
                className="rounded-lg border border-cream-200 px-2 py-1 text-xs" />
            )}
            <input value={pwd} onChange={(e) => setPwd(e.target.value)} type="password" placeholder="新密碼（至少 6 碼）" autoComplete="new-password"
              className="rounded-lg border border-cream-200 px-2 py-1 text-xs" />
            <div className="flex gap-2">
              <button disabled={saving} onClick={submitPassword}
                className="rounded-full bg-sage-200 px-3 py-1 text-xs text-ink disabled:opacity-40">確定</button>
              <button onClick={() => { setShowPwd(false); setPwd(""); setNewLoginId(""); }}
                className="rounded-full bg-cream-200 px-3 py-1 text-xs text-ink-soft">取消</button>
            </div>
          </div>
        )}
        {error && <p className="mt-1 text-xs text-blossom-400">{error}</p>}
        {ok && <p className="mt-1 text-xs text-sage-400">{ok}</p>}
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
          <h1 className="text-sm text-ink-soft">🔑 登入帳號管理</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-10">
        <div className="rounded-3xl bg-white/70 p-4 text-xs text-ink-faint shadow-soft">
          這裡管理「正式登入帳號」：登入帳號（loginId）＋密碼＋角色（最高管理員／管理員／
          一般工作人員／唯讀人員）＋啟用停用。重設密碼會讓該帳號既有登入立即失效、需重新登入。
          僅最高管理員可進入本頁。
        </div>
        {/* 僅 SUPER_ADMIN（manageUsers）可進入；未登入／無權限由 API 與此閘門雙重把關。 */}
        <SystemCenterGate action="manageUsers">
          <AccountManagementInner />
        </SystemCenterGate>
      </main>
    </div>
  );
}
