"use client";

import { useState } from "react";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";
import { stoveMasterRoleTypeLabel } from "@/lib/labels";
import type { MemberSearchResult } from "./types";
import { useStoredOperatorUserId } from "@/lib/operatorClient";

type StoveMasterRegistration = {
  id: string;
  roleType: "STOVE_MASTER" | "VICE_STOVE_MASTER";
  nameSnapshot: string;
  phoneSnapshot: string | null;
  status: "ACTIVE" | "CANCELLED";
  note: string | null;
};

/**
 * V10.1「供品認捐中心」需求「十五、爐主與副爐主」畫面：不屬供品、不收費，
 * 刻意跟上面的 ActivityOfferingsPanel（供品認捐）完全分開的一個區塊，
 * 只登錄最後結果（不記錄擲筊過程）。
 */
export default function StoveMasterPanel({
  templeEventId,
  initialRegistrations,
}: {
  templeEventId: string;
  initialRegistrations: StoveMasterRegistration[];
}) {

  const [registrations, setRegistrations] = useState(initialRegistrations);
  const [showAdd, setShowAdd] = useState<"STOVE_MASTER" | "VICE_STOVE_MASTER" | null>(null);

  async function refresh() {
    const res = await fetch(`/api/temple-events/${templeEventId}/stove-masters`);
    const data = await res.json();
    setRegistrations(data.registrations ?? []);
  }

  async function toggleStatus(id: string, status: "ACTIVE" | "CANCELLED") {
    await fetch(`/api/stove-masters/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await refresh();
  }

  const stoveMasters = registrations.filter((r) => r.roleType === "STOVE_MASTER");
  const viceStoveMasters = registrations.filter((r) => r.roleType === "VICE_STOVE_MASTER");

  return (
    <div className="flex flex-col gap-4">
      {(["STOVE_MASTER", "VICE_STOVE_MASTER"] as const).map((roleType) => {
        const list = roleType === "STOVE_MASTER" ? stoveMasters : viceStoveMasters;
        return (
          <div key={roleType}>
            <h3 className="text-sm font-medium text-ink">{stoveMasterRoleTypeLabel[roleType]}</h3>
            <div className="mt-2 flex flex-col gap-2">
              {list.length === 0 && <p className="text-sm text-ink-faint">尚未登錄</p>}
              {list.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-yolk-50 px-4 py-3">
                  <span className="text-sm text-ink">{r.nameSnapshot}</span>
                  {r.phoneSnapshot && <span className="text-xs text-ink-faint">{r.phoneSnapshot}</span>}
                  {r.status === "CANCELLED" && (
                    <span className="rounded-full bg-mist-200 px-2 py-0.5 text-xs text-ink-soft">已取消</span>
                  )}
                  <button
                    type="button"
                    className={`${secondaryButtonClass} ml-auto min-h-12`}
                    onClick={() => toggleStatus(r.id, r.status === "ACTIVE" ? "CANCELLED" : "ACTIVE")}
                  >
                    {r.status === "ACTIVE" ? "取消" : "恢復"}
                  </button>
                </div>
              ))}
              {showAdd === roleType ? (
                <StoveMasterAddForm
                  templeEventId={templeEventId}
                  roleType={roleType}
                  onDone={async () => {
                    setShowAdd(null);
                    await refresh();
                  }}
                  onCancel={() => setShowAdd(null)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAdd(roleType)}
                  className={`${primaryButtonClass} min-h-12 self-start`}
                >
                  ＋登錄{stoveMasterRoleTypeLabel[roleType]}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StoveMasterAddForm({
  templeEventId,
  roleType,
  onDone,
  onCancel,
}: {
  templeEventId: string;
  roleType: "STOVE_MASTER" | "VICE_STOVE_MASTER";
  onDone: () => void;
  onCancel: () => void;
}) {
  // V12.2 指令「五」：GET /api/search 這次補上了信眾 view 權限檢查，這裡
  // 沿用**同一個**既有身分來源把 operatorUserId 帶上（見
  // src/lib/operatorClient.tsx 的說明），不是另一套登入或角色機制。
  const operatorUserId = useStoredOperatorUserId();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberSearchResult[]>([]);
  const [selected, setSelected] = useState<MemberSearchResult | null>(null);
  const [manualName, setManualName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function search(q: string) {
    setQuery(q);
    setSelected(null);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}${operatorUserId ? `&operatorUserId=${encodeURIComponent(operatorUserId)}` : ""}`);
    const data = await res.json();
    setResults(data.results ?? []);
  }

  async function handleSubmit() {
    if (!selected && !manualName.trim()) {
      setError("請搜尋選取信眾，或至少輸入姓名");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/temple-events/${templeEventId}/stove-masters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleType,
          memberId: selected?.memberId ?? null,
          householdId: selected?.householdId ?? null,
          manualName: selected ? null : manualName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "登錄失敗");
        return;
      }
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-white/80 p-3">
      {error && <p className={errorTextClass}>{error}</p>}
      <label className={labelClass}>搜尋信眾（或直接輸入姓名）</label>
      <input
        className={inputClass}
        value={query}
        onChange={(e) => {
          search(e.target.value);
          setManualName(e.target.value);
        }}
        placeholder="輸入姓名搜尋，或直接輸入姓名"
      />
      {results.length > 0 && !selected && (
        <div className="flex flex-col gap-1 rounded-xl bg-cream-50 p-2">
          {results.map((r) => (
            <button
              key={`${r.householdId}-${r.memberId ?? r.name}`}
              type="button"
              className="min-h-12 rounded-lg px-3 text-left text-sm hover:bg-cream-100"
              onClick={() => {
                setSelected(r);
                setQuery(r.name);
                setResults([]);
              }}
            >
              {r.name}（{r.householdId}）
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={handleSubmit} disabled={submitting} className={`${primaryButtonClass} min-h-12`}>
          確認登錄
        </button>
        <button type="button" onClick={onCancel} className={`${secondaryButtonClass} min-h-12`}>
          取消
        </button>
      </div>
    </div>
  );
}
