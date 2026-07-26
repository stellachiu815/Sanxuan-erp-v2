"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import {
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
  labelClass,
} from "@/components/household/formStyles";
import { useStoredOperatorUserId } from "@/lib/operatorClient";

/**
 * V15R4 年度燈統一：全戶多人多項目報名 picker（信眾詳情／家戶詳情／年度燈活動管理
 * 三入口共用同一元件、同一 /api/registrations/batch 後端、同一資料模型）。
 *
 * - 列出全戶成員，每位可分別勾選：光明燈／太歲燈／祭改。
 * - 全家燈以家戶為一筆：勾選 6～13 位成員，依人數自動顯示建議套版。
 * - 一次送出＝單一 transaction；已存在項目回 ALREADY_EXISTS 不重複建立；
 *   祭改於同一 transaction 建立 PurificationEntry（見後端 registerItemsBatch）。
 */

type Member = { id: string; name: string; role: string; isDeceased: boolean };
type ItemView = { id: string; key: string; name: string };
type OpenYear = { year: number; templeEventId: string; name: string };
type LastYear = { fromYear: number | null; perMember: { memberId: string; itemKeys: string[] }[]; hadFamily: boolean };

type PerMember = { guangming: boolean; taisui: boolean; purification: boolean };
type FamilyContact = { contactName: string | null; contactSource: string };

/** 戶主/主要聯絡人顯示：UNSET（DB 無資料）→「尚未設定」；否則顯示姓名。 */
function contactDisplay(c: FamilyContact | null): string {
  if (!c || c.contactSource === "UNSET" || !c.contactName) return "尚未設定";
  return c.contactName;
}

export default function AnnualLanternHouseholdPicker({
  householdId,
  onClose,
}: {
  householdId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const operatorUserId = useStoredOperatorUserId();

  const [members, setMembers] = useState<Member[]>([]);
  const [householdName, setHouseholdName] = useState<string>("");
  const [householdAddress, setHouseholdAddress] = useState<string | null>(null);
  const [contact, setContact] = useState<FamilyContact | null>(null);
  const [eligibleIds, setEligibleIds] = useState<string[]>([]); // 合格成員（在世且未刪除）id
  const [items, setItems] = useState<Record<string, ItemView>>({});
  const [openYears, setOpenYears] = useState<OpenYear[]>([]);
  const [lastYear, setLastYear] = useState<LastYear | null>(null);
  const [year, setYear] = useState<number | "">("");
  const [perMember, setPerMember] = useState<Record<string, PerMember>>({});
  // 全家燈當年度納入名單（預設全部合格成員；可逐位取消、可全部納入恢復）。
  const [familyMemberIds, setFamilyMemberIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = operatorUserId ? `?operatorUserId=${encodeURIComponent(operatorUserId)}` : "";
      const res = await fetch(`/api/households/${householdId}/annual-lantern-options${q}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "載入失敗");
        return;
      }
      setMembers(data.members ?? []);
      setHouseholdName(data.household?.name ?? "");
      setHouseholdAddress(data.household?.address ?? null);
      setContact(data.familyLantern ? { contactName: data.familyLantern.contactName ?? null, contactSource: data.familyLantern.contactSource ?? "UNSET" } : null);
      // V15R5.3：全家燈預設納入所有合格成員（在世且未刪除；辭世/封存不預設納入）。
      const elig: string[] = data.familyLantern?.eligibleMemberIds ?? [];
      setEligibleIds(elig);
      setFamilyMemberIds(Object.fromEntries(elig.map((id) => [id, true])));
      const byKey: Record<string, ItemView> = {};
      for (const it of data.lanternGroup?.items ?? []) byKey[it.key] = it;
      setItems(byKey);
      setOpenYears(data.openYears ?? []);
      setLastYear(data.lastYear ?? null);
      if ((data.openYears ?? []).length > 0) setYear(data.openYears[0].year);
    } catch {
      setError("網路連線問題，請稍後再試一次。");
    } finally {
      setLoading(false);
    }
  }, [householdId, operatorUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  // V15R5「沿用去年」：把去年各成員勾選的燈套用到本次（送出時以新年度重算單價，
  // 不帶付款/收據/列印狀態/CONFIRMED）。全家燈若去年有，預先勾全戶成員（可再調整）。
  function applyLastYear() {
    if (!lastYear) return;
    const keyToField: Record<string, keyof PerMember> = {
      LANTERN_GUANGMING: "guangming",
      LANTERN_TAISUI: "taisui",
      LANTERN_PURIFICATION: "purification",
    };
    const next: Record<string, PerMember> = {};
    for (const pm of lastYear.perMember) {
      const cur: PerMember = { guangming: false, taisui: false, purification: false };
      for (const k of pm.itemKeys) {
        const f = keyToField[k];
        if (f) cur[f] = true;
      }
      next[pm.memberId] = cur;
    }
    setPerMember(next);
    // V15R5.3：沿用去年只沿用「是否報全家燈」；成員名單一律重讀當下合格成員（不沿用去年取消名單）。
    if (lastYear.hadFamily) includeAllEligible();
    setMessage(`已沿用民國 ${lastYear.fromYear} 年報名內容（金額依本年度單價重算、不含去年付款；全家燈成員重讀當下合格成員）。`);
  }

  // 全部納入：恢復所有合格成員（在世且未刪除）。
  function includeAllEligible() {
    setFamilyMemberIds(Object.fromEntries(eligibleIds.map((id) => [id, true])));
  }

  function startFresh() {
    setPerMember({});
    includeAllEligible(); // 全家燈預設仍為全體合格成員
    setMessage("已清空個人燈；全家燈維持預設全體合格成員。");
  }

  function toggle(memberId: string, field: keyof PerMember) {
    setPerMember((prev) => {
      const cur = prev[memberId] ?? { guangming: false, taisui: false, purification: false };
      return { ...prev, [memberId]: { ...cur, [field]: !cur[field] } };
    });
  }

  // 只計入「合格成員且勾選」者（辭世/封存不可納入，即使殘留旗標也不算）。
  const eligibleSet = useMemo(() => new Set(eligibleIds), [eligibleIds]);
  const familyIncludedIds = useMemo(
    () => eligibleIds.filter((id) => familyMemberIds[id]),
    [eligibleIds, familyMemberIds]
  );
  const familyCount = familyIncludedIds.length;
  const allEligibleIncluded = eligibleIds.length > 0 && familyCount === eligibleIds.length;

  const entries = useMemo(() => {
    if (year === "") return [];
    const out: { memberId: string; registrationItemTypeId: string; year: number; participantMemberIds?: string[] }[] = [];
    const g = items["LANTERN_GUANGMING"];
    const t = items["LANTERN_TAISUI"];
    const p = items["LANTERN_PURIFICATION"];
    for (const m of members) {
      const sel = perMember[m.id];
      if (!sel) continue;
      if (sel.guangming && g) out.push({ memberId: m.id, registrationItemTypeId: g.id, year });
      if (sel.taisui && t) out.push({ memberId: m.id, registrationItemTypeId: t.id, year });
      if (sel.purification && p) out.push({ memberId: m.id, registrationItemTypeId: p.id, year });
    }
    // 全家燈：以家戶一筆，納入名單＝合格且勾選的成員（至少一位）。伺服器會重查資格再寫快照。
    const family = items["LANTERN_FAMILY"];
    if (family && familyIncludedIds.length >= 1) {
      out.push({ memberId: familyIncludedIds[0], registrationItemTypeId: family.id, year, participantMemberIds: familyIncludedIds });
    }
    return out;
  }, [year, items, members, perMember, familyIncludedIds]);

  async function submit() {
    setError(null);
    setMessage(null);
    if (year === "") {
      setError("目前沒有開放中的年度燈活動，請先於活動管理建立年度燈。");
      return;
    }
    if (entries.length === 0) {
      setError("請至少勾選一項報名項目（全家燈需至少納入一位有效成員）。");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/registrations/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId, entries }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "報名失敗");
        return;
      }
      const created = (data.outcomes ?? []).filter((o: { outcome: string }) => o.outcome === "CREATED").length;
      const exists = (data.outcomes ?? []).filter((o: { outcome: string }) => o.outcome === "ALREADY_EXISTS").length;
      setMessage(`已送出：新增 ${created} 筆${exists > 0 ? `，已存在（未重複建立）${exists} 筆` : ""}。`);
      if (data.editorUrl) {
        router.push(data.editorUrl);
        router.refresh();
      }
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="年度燈・全戶多人報名" onClose={onClose}>
      {loading ? (
        <p className="p-4 text-sm text-ink-soft">載入中…</p>
      ) : openYears.length === 0 ? (
        <p className="rounded-2xl bg-cream-100 p-4 text-sm text-ink-soft">
          目前沒有開放中的「年度燈」活動。請先於活動管理建立年度燈（含光明燈／太歲燈／全家燈／祭改）。
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <label className={labelClass}>年度</label>
            <select
              className="min-h-11 w-full rounded-xl border border-cream-300 bg-white px-3 py-2 text-sm"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {openYears.map((y) => (
                <option key={y.templeEventId} value={y.year}>{y.name}</option>
              ))}
            </select>
          </div>

          {/* V15R5：明確提供「沿用去年 / 全新建立」。 */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={applyLastYear}
              disabled={!lastYear || lastYear.fromYear == null}
              className="rounded-full bg-sage-100 px-4 py-1.5 text-sm text-ink transition hover:bg-sage-200 disabled:opacity-40"
            >
              {lastYear?.fromYear != null ? `↩ 沿用去年（民國 ${lastYear.fromYear} 年）` : "↩ 沿用去年（無去年資料）"}
            </button>
            <button type="button" onClick={startFresh} className="rounded-full bg-cream-200 px-4 py-1.5 text-sm text-ink-soft transition hover:bg-cream-300">
              ✎ 全新建立
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-ink-faint">
                  <th className="px-2 py-1 text-left">成員</th>
                  <th className="px-2 py-1">光明燈</th>
                  <th className="px-2 py-1">太歲燈</th>
                  <th className="px-2 py-1">祭改</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const sel = perMember[m.id] ?? { guangming: false, taisui: false, purification: false };
                  return (
                    <tr key={m.id} className="border-t border-cream-200">
                      <td className="px-2 py-1.5 text-ink">
                        {m.name}
                        {m.isDeceased && <span className="ml-1 text-xs text-ink-faint">（歿）</span>}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={sel.guangming} onChange={() => toggle(m.id, "guangming")} />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={sel.taisui} onChange={() => toggle(m.id, "taisui")} />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={sel.purification} onChange={() => toggle(m.id, "purification")} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── 全家燈：以家戶一筆，預設納入全體合格成員（在世且未刪除），可逐位取消／全部納入 ── */}
          <div className="rounded-2xl bg-cream-100 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink">全家燈（以家戶一筆；預設納入全體合格成員）</span>
              <button
                type="button"
                onClick={includeAllEligible}
                disabled={allEligibleIncluded || eligibleIds.length === 0}
                className="min-h-9 whitespace-nowrap rounded-full bg-sage-100 px-3 py-1.5 text-xs text-ink transition hover:bg-sage-200 disabled:opacity-40"
              >
                全部納入
              </button>
            </div>
            {/* 手機：摘要卡置頂；桌機：摘要靠右（flex-row-reverse）。地址只在摘要顯示一次，不逐列重複。 */}
            <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-start">
              <div className="rounded-xl bg-white/70 p-3 text-xs sm:w-56 sm:shrink-0">
                <div className="text-sm font-medium text-ink">{householdName || "（未命名家戶）"}</div>
                <dl className="mt-1 space-y-1 text-ink-soft">
                  <div>戶主／主要聯絡人：<span className={contact && contact.contactSource !== "UNSET" ? "text-ink" : "text-blossom-400"}>{contactDisplay(contact)}</span></div>
                  <div>
                    家戶地址：
                    {householdAddress
                      ? <span className="text-ink">{householdAddress}</span>
                      : <span className="text-blossom-400">缺地址（草稿可存，確認／列印前需補）</span>}
                  </div>
                  <div>全家燈年度：民國 {year === "" ? "—" : year} 年</div>
                  <div>本次納入：<span className="text-ink">{familyCount}</span> / {eligibleIds.length} 位</div>
                </dl>
              </div>

              <div className="min-w-0 flex-1">
                {eligibleIds.length === 0 ? (
                  <p className="rounded-xl bg-white/70 px-3 py-2 text-xs text-blossom-400">
                    此家戶目前沒有可納入的有效成員（皆已辭世或已刪除），無法建立全家燈。
                  </p>
                ) : (
                  <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {members.map((m) => {
                      const eligible = eligibleSet.has(m.id);
                      const included = eligible && !!familyMemberIds[m.id];
                      return (
                        <li key={m.id} className="flex items-center justify-between gap-2 rounded-xl bg-white/70 px-3 py-2">
                          <span className="truncate text-sm text-ink">
                            {m.name}
                            {m.isDeceased && <span className="ml-1 text-xs text-ink-faint">（歿）</span>}
                          </span>
                          {eligible ? (
                            <button
                              type="button"
                              onClick={() => setFamilyMemberIds((prev) => ({ ...prev, [m.id]: !prev[m.id] }))}
                              className={`min-h-9 whitespace-nowrap rounded-full px-3 py-1 text-xs transition ${
                                included ? "bg-sage-200 text-ink hover:bg-blossom-100" : "bg-cream-200 text-ink-soft hover:bg-sage-100"
                              }`}
                            >
                              {included ? "取消納入" : "納入"}
                            </button>
                          ) : (
                            <span className="whitespace-nowrap text-xs text-ink-faint">不可納入</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {error && <p className={errorTextClass}>{error}</p>}
          {message && <p className="text-sm text-sage-400">{message}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" className={secondaryButtonClass} onClick={onClose}>關閉</button>
            <button type="button" className={primaryButtonClass} onClick={submit} disabled={busy}>
              {busy ? "送出中…" : `送出報名（${entries.length} 筆）`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
