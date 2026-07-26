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
import { familyLanternTierLabel } from "@/lib/familyLanternTier";

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

const FAMILY_MIN = 6;
const FAMILY_MAX = 13;

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
  const [householdAddress, setHouseholdAddress] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, ItemView>>({});
  const [openYears, setOpenYears] = useState<OpenYear[]>([]);
  const [lastYear, setLastYear] = useState<LastYear | null>(null);
  const [year, setYear] = useState<number | "">("");
  const [perMember, setPerMember] = useState<Record<string, PerMember>>({});
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
      setHouseholdAddress(data.household?.address ?? null);
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
    if (lastYear.hadFamily) {
      const fam: Record<string, boolean> = {};
      for (const m of members) fam[m.id] = true;
      setFamilyMemberIds(fam);
    }
    setMessage(`已沿用民國 ${lastYear.fromYear} 年報名內容（金額將依本年度單價重新計算，不含去年付款）。`);
  }

  function startFresh() {
    setPerMember({});
    setFamilyMemberIds({});
    setMessage("已清空，改為全新建立。");
  }

  function toggle(memberId: string, field: keyof PerMember) {
    setPerMember((prev) => {
      const cur = prev[memberId] ?? { guangming: false, taisui: false, purification: false };
      return { ...prev, [memberId]: { ...cur, [field]: !cur[field] } };
    });
  }

  const familyCount = useMemo(
    () => Object.values(familyMemberIds).filter(Boolean).length,
    [familyMemberIds]
  );
  const familyValid = familyCount === 0 || (familyCount >= FAMILY_MIN && familyCount <= FAMILY_MAX);

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
    const family = items["LANTERN_FAMILY"];
    const famIds = members.filter((m) => familyMemberIds[m.id]).map((m) => m.id);
    if (family && famIds.length >= FAMILY_MIN && famIds.length <= FAMILY_MAX) {
      out.push({ memberId: famIds[0], registrationItemTypeId: family.id, year, participantMemberIds: famIds });
    }
    return out;
  }, [year, items, members, perMember, familyMemberIds]);

  async function submit() {
    setError(null);
    setMessage(null);
    if (year === "") {
      setError("目前沒有開放中的年度燈活動，請先於活動管理建立年度燈。");
      return;
    }
    if (familyCount > 0 && !familyValid) {
      setError(`全家燈需勾選 ${FAMILY_MIN}～${FAMILY_MAX} 位成員（目前 ${familyCount} 位）。`);
      return;
    }
    if (entries.length === 0) {
      setError("請至少勾選一項報名項目。");
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

          <div className="rounded-2xl bg-cream-100 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">全家燈（以家戶一筆，勾選 6～13 位）</span>
              <span className={`text-xs ${familyValid ? "text-ink-soft" : "text-blossom-400"}`}>
                已選 {familyCount} 位{familyCount > 0 ? `｜${familyLanternTierLabel(familyCount)}` : ""}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-1.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={!!familyMemberIds[m.id]}
                    onChange={() => setFamilyMemberIds((prev) => ({ ...prev, [m.id]: !prev[m.id] }))}
                  />
                  {m.name}
                </label>
              ))}
            </div>
            {/* V15R5：全家燈報名時明確顯示列印地址與來源供確認；缺地址可存草稿、正式確認/列印擋。 */}
            <div className="mt-2 text-xs">
              <span className="text-ink-faint">目前列印地址：</span>
              {householdAddress
                ? <>{householdAddress}<span className="ml-2 text-ink-faint">（來源：家戶地址）</span></>
                : <span className="text-blossom-400">缺地址（可暫存草稿，正式確認／列印前需補家戶地址）</span>}
            </div>
            {!familyValid && (
              <p className="mt-1 text-xs text-blossom-400">全家燈需勾選 {FAMILY_MIN}～{FAMILY_MAX} 位成員。</p>
            )}
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
