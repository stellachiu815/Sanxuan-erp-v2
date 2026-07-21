"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { errorTextClass } from "@/components/household/formStyles";
import UniversalSalvationDetailForm from "./UniversalSalvationDetailForm";
import EntryCategorySection from "./EntryCategorySection";
import Toast from "./Toast";
import { CATEGORY_SECTIONS, type RecordJSON } from "./types";

import { fetchUniversalSalvation } from "@/lib/universalSalvationFetch";
type Props = {
  householdId: string;
  householdName: string;
  year: number;
  initialRecord: RecordJSON | null;
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
}: Props) {
  const [record, setRecord] = useState<RecordJSON | null>(initialRecord);
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
            />
          ))}
        </div>
      </section>

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
