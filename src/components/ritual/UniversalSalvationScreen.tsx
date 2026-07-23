"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { errorTextClass } from "@/components/household/formStyles";
import UniversalSalvationDetailForm from "./UniversalSalvationDetailForm";
import EntryCategorySection from "./EntryCategorySection";
import DebtCreditorMemberPicker, { type PickerMember } from "./DebtCreditorMemberPicker";
import Toast from "./Toast";
import { CATEGORY_SECTIONS, type RecordJSON, type WorshipOptionJSON } from "./types";

import { fetchUniversalSalvation } from "@/lib/universalSalvationFetch";
import { submitDebtCreditorBatch } from "@/lib/debtCreditorBatch";
type Props = {
  householdId: string;
  householdName: string;
  year: number;
  initialRecord?: RecordJSON | null;
  /**
   * V13.4：從共用報名編輯器 /registration/[id] 進入時傳入。
   *
   * 有值代表**報名主檔已經存在**（由信眾詳情頁或家戶頁建立），
   * 這個元件只負責編輯內容——不會再顯示一次「今年跟去年一樣嗎」的
   * 沿用／全新建立選擇畫面（那個選擇已經在新增報名對話框做過了）。
   */
  existingRitualRecordId?: string;
  /** V13.4：列印連結的返回目標。未提供時沿用家戶路徑（相容既有呼叫端） */
  printBasePath?: string;
  /**
   * V14.2「全戶加入累世冤親債主」的預設納入模式：
   *   家戶入口 → true（預設全戶，可取消少數）
   *   信眾入口（/registration?from=memberId）→ false（預設只本人，可切全戶）
   */
  debtCreditorDefaultAll?: boolean;
  /** 信眾入口的「本人」；提供時「只本人」預設只勾這位。 */
  currentMemberId?: string | null;
};

/**
 * 普渡登記畫面（V3.0 建立，V3.1「行政流程優化」調整畫面順序，
 * V3.2「大量登記優化」加上右上角完成提示）。
 *
 * 尚未有本年度資料時，先問「今年跟去年一樣嗎？」；選「是」呼叫既有的
 * copy-from-previous-year API 建立草稿，選「否」建立一筆全新空白資料。
 * 建立好之後，畫面依實際行政填寫流程排列：先填「登記名冊」（歷代祖先→
 * 個人乙位正魂→冤親債主→無緣子女），最後才是整體的陽上姓名／安奉位置／
 * 贊普／普渡桌／備註（在 UniversalSalvationDetailForm 裡）。
 *
 * 新增／修改／刪除成功後，統一由這裡觸發右上角的「✓ 已完成」提示
 * （2 秒後自動消失，不用 alert），子元件只需要照舊呼叫 onSaved /
 * onRecordUpdated，不用各自處理提示。
 */
export default function UniversalSalvationScreen({
  householdId,
  householdName,
  year,
  initialRecord,
  existingRitualRecordId,
  debtCreditorDefaultAll = false,
  currentMemberId = null,
}: Props) {
  const router = useRouter();
  const [record, setRecord] = useState<RecordJSON | null>(initialRecord ?? null);
  /**
   * V14.1：陽上人「家戶成員快速加入」與「帶入家戶地址」所需的家戶資料，
   * 由本畫面**自行**用既有的 GET /api/households/[id] 取得（成員姓名＋地址），
   * 不再從外層一路傳 props（避免增加傳遞層數）。只讀不寫，不會動到家戶主檔。
   */
  const [householdAddress, setHouseholdAddress] = useState<string | null>(null);
  /**
   * V14.2：兩組**不同**的本戶固定選項，由 GET /api/households/[id]/registration-options
   * 一次取回：
   *   ancestorNames        本戶歷代祖先牌位名稱（歷代祖先新增區塊一鍵帶入）
   *   yangshangCandidates  本戶固定陽上人（字庫＋戶主＋主要聯絡人＋成員，去重）
   * 新增字庫成員後（addToHouseholdYangshang）重新載入，讓下一個牌位馬上帶得到。
   */
  const [ancestorOptions, setAncestorOptions] = useState<WorshipOptionJSON[]>([]);
  const [individualSoulOptions, setIndividualSoulOptions] = useState<WorshipOptionJSON[]>([]);
  const [debtCreditorNames, setDebtCreditorNames] = useState<string[]>([]);
  const [yangshangCandidates, setYangshangCandidates] = useState<string[]>([]);
  /** V14.2「全戶加入累世冤親債主」：本戶成員、US_YUANQIN 項目 id、勾選狀態。 */
  const [members, setMembers] = useState<PickerMember[]>([]);
  const [yuanqinItemTypeId, setYuanqinItemTypeId] = useState<string | null>(null);
  const [yuanqinSelected, setYuanqinSelected] = useState<Record<string, boolean>>({});
  const [yuanqinSeeded, setYuanqinSeeded] = useState(false);
  const [yuanqinBusy, setYuanqinBusy] = useState(false);
  const [yuanqinMsg, setYuanqinMsg] = useState<string | null>(null);
  const [yuanqinError, setYuanqinError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchUniversalSalvation(`/api/households/${householdId}`);
        const data = await res.json();
        if (cancelled || !res.ok || !data?.data) return;
        const h = data.data as { address?: string | null };
        setHouseholdAddress(h.address ?? null);
      } catch {
        /* 取不到不影響報名；只是少了「帶入地址」的便利 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [householdId]);

  const loadRegistrationOptions = useCallback(async () => {
    try {
      const res = await fetchUniversalSalvation(
        `/api/households/${householdId}/registration-options`
      );
      const data = await res.json();
      if (!res.ok) return;
      setAncestorOptions(Array.isArray(data?.ancestors) ? data.ancestors : []);
      setIndividualSoulOptions(Array.isArray(data?.individualSouls) ? data.individualSouls : []);
      setDebtCreditorNames(Array.isArray(data?.debtCreditorNames) ? data.debtCreditorNames : []);
      setYangshangCandidates(Array.isArray(data?.yangshangNames) ? data.yangshangNames : []);
      setMembers(Array.isArray(data?.members) ? data.members : []);
      setYuanqinItemTypeId(typeof data?.yuanqinItemTypeId === "string" ? data.yuanqinItemTypeId : null);
    } catch {
      /* 取不到不影響報名；只是少了固定選項的便利 */
    }
  }, [householdId]);

  useEffect(() => {
    void loadRegistrationOptions();
  }, [loadRegistrationOptions]);

  // 成員載入後，依入口預設種一次勾選：家戶入口＝全戶；信眾入口＝只本人。
  useEffect(() => {
    if (yuanqinSeeded || members.length === 0) return;
    const seed: Record<string, boolean> = {};
    if (debtCreditorDefaultAll) {
      for (const m of members) seed[m.id] = true;
    } else if (currentMemberId) {
      seed[currentMemberId] = true;
    }
    setYuanqinSelected(seed);
    setYuanqinSeeded(true);
  }, [members, yuanqinSeeded, debtCreditorDefaultAll, currentMemberId]);

  async function submitWholeHouseholdDebtCreditor() {
    if (!yuanqinItemTypeId) return;
    const ids = Object.keys(yuanqinSelected).filter((k) => yuanqinSelected[k]);
    if (ids.length === 0) {
      setYuanqinError("請至少勾選一位成員");
      return;
    }
    setYuanqinBusy(true);
    setYuanqinError(null);
    setYuanqinMsg(null);
    try {
      const result = await submitDebtCreditorBatch(ids, year, yuanqinItemTypeId);
      if (!result.ok) {
        setYuanqinError(result.error ?? "加入失敗，請稍後再試一次。");
        return;
      }
      // 尚未有報名編輯頁（家戶新建）→ 導到共用編輯器看已報名項目；已在編輯器 → 重新整理。
      if (!existingRitualRecordId && result.editorUrl) {
        router.push(result.editorUrl);
        return;
      }
      const parts = [];
      if (result.created > 0) parts.push(`新增 ${result.created} 位`);
      if (result.alreadyExists > 0) parts.push(`${result.alreadyExists} 位先前已加入`);
      setYuanqinMsg(`累世冤親債主：${parts.join("、") || "已處理"}。`);
      router.refresh();
    } catch {
      setYuanqinError("網路連線問題，請稍後再試一次。");
    } finally {
      setYuanqinBusy(false);
    }
  }

  function selectAllMembers() {
    const next: Record<string, boolean> = {};
    for (const m of members) next[m.id] = true;
    setYuanqinSelected(next);
  }
  function toggleMember(id: string) {
    setYuanqinSelected((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  }

  async function addToHouseholdYangshang(name: string) {
    try {
      const res = await fetchUniversalSalvation(`/api/households/${householdId}/yangshang`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) await loadRegistrationOptions();
    } catch {
      /* 存不進本戶固定名單不影響本牌位——姓名已加入本牌位 value */
    }
  }
  /** V13.4：從共用編輯器進入時自行載入資料（那條路由沒有 SSR 預載） */
  const [loading, setLoading] = useState(
    Boolean(existingRitualRecordId) && !initialRecord
  );

  useEffect(() => {
    if (!existingRitualRecordId || initialRecord) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchUniversalSalvation(
          `/api/households/${householdId}/rituals/universal-salvation/${year}`
        );
        const data = await res.json();
        if (!cancelled && res.ok) setRecord(data.record ?? data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [existingRitualRecordId, initialRecord, householdId, year]);
  const [toastTick, setToastTick] = useState(0);
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    if (toastTick === 0) return;
    setToastVisible(true);
    const timer = setTimeout(() => setToastVisible(false), 2000);
    return () => clearTimeout(timer);
  }, [toastTick]);

  function handleUpdated(nextRecord: RecordJSON) {
    setRecord(nextRecord);
    setToastTick((tick) => tick + 1);
  }

  if (loading) {
    return (
      <section className="rounded-3xl bg-white/70 p-10 text-center shadow-card">
        <p className="text-sm text-ink-faint">讀取普渡登記資料…</p>
      </section>
    );
  }

  /**
   * V13.4：從共用報名編輯器進入時，報名主檔已經存在——
   * 不再顯示「今年跟去年一樣嗎」的選擇畫面（指令六）。
   * 若此時仍讀不到明細，代表資料還在建立中，顯示提示而不是選擇畫面。
   */
  if (existingRitualRecordId && (!record || !record.universalSalvation)) {
    return (
      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <p className="text-sm text-ink-soft">
          這筆普渡報名尚未建立登記明細，請重新整理頁面；若持續發生請聯絡系統管理者。
        </p>
      </section>
    );
  }

  if (!record || !record.universalSalvation) {
    return (
      <AskSameAsLastYear householdId={householdId} year={year} onCreated={setRecord} />
    );
  }

  const detail = record.universalSalvation;

  return (
    <div className="flex flex-col gap-8">
      <Toast visible={toastVisible} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-faint">{householdName}</p>
          <h1 className="mt-1 text-2xl font-medium text-ink">🙏 {year} 年普渡登記</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/household/${householdId}/rituals/universal-salvation/print`}
            className="rounded-full bg-cream-200/70 px-4 py-2 text-sm text-ink-soft transition hover:bg-cream-300/70 hover:text-ink"
          >
            🖨 前往列印中心
          </Link>
          <Link
            href={`/universal-salvation/${year}/print-center`}
            className="rounded-full bg-mist-100 px-4 py-2 text-sm text-ink-soft transition hover:bg-mist-200 hover:text-ink"
          >
            📦 寶袋列印中心（跨家戶）
          </Link>
        </div>
      </div>

      <section className="rounded-3xl bg-white/70 p-8 shadow-card">
        <h2 className="text-lg font-medium text-ink">登記名冊</h2>
        <p className="mt-1 text-sm text-ink-faint">
          依歷代祖先、個人乙位正魂、冤親債主、無緣子女分類登記，可分別新增／編輯／刪除。
        </p>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {CATEGORY_SECTIONS.map((section) => (
            <EntryCategorySection
              key={section.category}
              householdId={householdId}
              year={year}
              category={section.category}
              title={section.title}
              tone={section.tone}
              addMode={section.addMode}
              fixedDisplayName={section.fixedDisplayName}
              entries={detail.entries.filter((e) => e.category === section.category)}
              onRecordUpdated={handleUpdated}
              householdAddress={householdAddress}
              ancestorOptions={ancestorOptions}
              individualSoulOptions={individualSoulOptions}
              debtCreditorNames={debtCreditorNames}
              householdYangshangNames={yangshangCandidates}
              onAddToHouseholdYangshang={addToHouseholdYangshang}
            />
          ))}
        </div>
      </section>

      {/* V14.2：全戶加入累世冤親債主——每位成員各建一筆（分別列印／取消／收款）。
          與信眾入口共用同一個 DebtCreditorMemberPicker 與同一支 batch API。
          家戶入口預設全戶、信眾入口預設本人（由 debtCreditorDefaultAll 決定種子）。 */}
      {members.length > 0 && yuanqinItemTypeId && (
        <section className="rounded-3xl bg-white/70 p-8 shadow-card">
          <h2 className="text-lg font-medium text-ink">累世冤親債主（全戶）</h2>
          <p className="mt-1 text-sm text-ink-faint">
            每位勾選的成員各建立一筆「累世冤親債主」報名，可分別列印、取消與收款。已加入者不會重複建立。
          </p>
          <div className="mt-4">
            <DebtCreditorMemberPicker
              members={members}
              selectedIds={yuanqinSelected}
              onToggle={toggleMember}
              onAll={selectAllMembers}
              onSelf={currentMemberId ? () => setYuanqinSelected({ [currentMemberId]: true }) : undefined}
              disabled={yuanqinBusy}
            />
          </div>
          {yuanqinError && <p className={`mt-2 ${errorTextClass}`}>{yuanqinError}</p>}
          {yuanqinMsg && <p className="mt-2 text-sm text-sage-300">{yuanqinMsg}</p>}
          <div className="mt-3">
            <button
              type="button"
              onClick={() => void submitWholeHouseholdDebtCreditor()}
              disabled={yuanqinBusy}
              className="rounded-full bg-sage-200 px-5 py-2 text-sm text-ink transition hover:bg-sage-300 disabled:opacity-50"
            >
              {yuanqinBusy ? "處理中…" : "加入累世冤親債主"}
            </button>
          </div>
        </section>
      )}

      <UniversalSalvationDetailForm
        householdId={householdId}
        year={year}
        status={record.status}
        detail={detail}
        onSaved={handleUpdated}
      />
    </div>
  );
}

function AskSameAsLastYear({
  householdId,
  year,
  onCreated,
}: {
  householdId: string;
  year: number;
  onCreated: (record: RecordJSON) => void;
}) {
  const [submitting, setSubmitting] = useState<"copy" | "blank" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCopy() {
    setSubmitting("copy");
    setError(null);
    try {
      const res = await fetchUniversalSalvation(
        `/api/households/${householdId}/rituals/universal-salvation/copy-from-previous-year`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetYear: year }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "複製失敗，請稍後再試一次。");
        return;
      }
      onCreated(data.record);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleBlank() {
    setSubmitting("blank");
    setError(null);
    try {
      const res = await fetchUniversalSalvation(`/api/households/${householdId}/rituals/universal-salvation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "建立失敗，請稍後再試一次。");
        return;
      }
      onCreated(data.record);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <section className="rounded-3xl bg-white/70 p-10 text-center shadow-card">
      <p className="text-sm text-ink-faint">🙏 {year} 年普渡登記</p>
      <p className="mt-2 text-xl text-ink">今年跟去年一樣嗎？</p>

      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <button
          type="button"
          onClick={handleCopy}
          disabled={submitting !== null}
          className="rounded-full bg-sage-100 px-8 py-3 text-sm text-ink transition hover:bg-sage-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting === "copy" ? "複製中…" : "是，複製去年資料"}
        </button>
        <button
          type="button"
          onClick={handleBlank}
          disabled={submitting !== null}
          className="rounded-full bg-mist-100 px-8 py-3 text-sm text-ink transition hover:bg-mist-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting === "blank" ? "建立中…" : "否，從空白開始"}
        </button>
      </div>

      {error && (
        <div className="mt-6">
          <p className={`inline-block ${errorTextClass}`}>{error}</p>
          {error.includes("找不到") && (
            <p className="mt-2 text-sm text-ink-faint">
              可以改選「否，從空白開始」直接手動登記。
            </p>
          )}
        </div>
      )}
    </section>
  );
}
