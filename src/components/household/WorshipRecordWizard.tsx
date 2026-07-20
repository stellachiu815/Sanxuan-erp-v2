"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "@/components/Modal";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "./formStyles";
import { printYangshangName, splitYangshangNames, normalizeYangshangName } from "@/lib/printChinese";

/**
 * V13.1 指令六／七／十四／十六：歷代祖先建立精靈。
 *
 * 取代舊的 AddWorshipModal（單純三個輸入框）——指令要求建立畫面至少提供：
 *   手動輸入陽上人／快速帶入陽上人／手動編輯牌位地址／帶入家戶地址／
 *   完整列印預覽／重複檢查／確認建立／取消
 *
 * ── 兩個必須守住的互動規則 ──────────────────────────────
 * 1. 陽上人輸入框是**自由文字**，不是下拉選單。快速帶入只是把姓名塞進
 *    輸入框，塞完之後使用者可以任意刪改（指令六：不得要求姓名存在於
 *    信眾資料庫）。
 * 2. 所有自動帶入的內容（家戶地址、建議名稱）在儲存前都可以修改
 *    （指令十六）。
 *
 * ⚠️「叩薦」只出現在**列印預覽**，不會進到輸入框、也不會存進資料庫。
 */

type YangshangSuggestion = {
  name: string;
  source: string;
  hint?: string;
};

type ExistingRecord = {
  id: string;
  type: "ANCESTOR_LINE" | "INDIVIDUAL";
  displayName: string;
  location: string | null;
};

type Duplicate = {
  id: string;
  displayName: string;
  location: string | null;
  reason: string;
};

type Props = {
  householdId: string;
  operatorUserId: string | null;
  onClose: () => void;
  onCreated: () => void;
};

export default function WorshipRecordWizard({
  householdId,
  operatorUserId,
  onClose,
  onCreated,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [householdAddress, setHouseholdAddress] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<YangshangSuggestion[]>([]);
  const [existing, setExisting] = useState<ExistingRecord[]>([]);

  const [displayName, setDisplayName] = useState("");
  const [location, setLocation] = useState("");
  const [yangshangName, setYangshangName] = useState("");
  const [notes, setNotes] = useState("");

  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null);
  const [step, setStep] = useState<"edit" | "preview">("edit");

  // ── 載入預覽資料 ──
  useEffect(() => {
    if (!operatorUserId) {
      setError("請先於右上角選擇操作人員");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/worship-records?householdId=${encodeURIComponent(householdId)}&operatorUserId=${encodeURIComponent(operatorUserId)}`
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data?.error ?? "載入資料失敗");
          return;
        }
        setHouseholdAddress(data.householdAddress ?? null);
        setSuggestions(data.yangshangSuggestions ?? []);
        setExisting(data.existing ?? []);
        // 由既有牌位推出建議名稱；沒有就留空讓使用者自己填
        const firstAncestor = (data.existing ?? []).find(
          (e: ExistingRecord) => e.type === "ANCESTOR_LINE"
        );
        if (!firstAncestor && data.household?.name) {
          const surname = String(data.household.name).trim().charAt(0);
          if (surname) setDisplayName(`${surname}姓歷代祖先`);
        }
      } catch {
        if (!cancelled) setError("載入資料時發生連線問題");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [householdId, operatorUserId]);

  const currentNames = useMemo(() => splitYangshangNames(yangshangName), [yangshangName]);

  /** 快速帶入：把姓名加進輸入框（可重複點擊移除）。純粹是輸入輔助。 */
  const toggleSuggestion = useCallback(
    (name: string) => {
      setYangshangName((prev) => {
        const names = splitYangshangNames(prev);
        const next = names.includes(name)
          ? names.filter((n) => n !== name)
          : [...names, name];
        return next.join("、");
      });
    },
    []
  );

  const submit = useCallback(
    async (confirmedDuplicate: boolean) => {
      if (!operatorUserId) return;
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch("/api/worship-records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operatorUserId,
            householdId,
            displayName: displayName.trim(),
            location: location.trim() || null,
            // 儲存的是**正規化後的姓名**，不含「叩薦」、不含任何稱謂
            yangshangName: normalizeYangshangName(yangshangName),
            notes: notes.trim() || null,
            confirmedDuplicate,
          }),
        });
        const data = await res.json();

        if (res.status === 409 && data?.needsDuplicateConfirmation) {
          setDuplicates(data.duplicates ?? []);
          return;
        }
        if (!res.ok) {
          setError(data?.error ?? "建立失敗");
          return;
        }
        onCreated();
        onClose();
      } catch {
        setError("建立時發生連線問題，請稍後再試");
      } finally {
        setSubmitting(false);
      }
    },
    [operatorUserId, householdId, displayName, location, yangshangName, notes, onCreated, onClose]
  );

  const canProceed = displayName.trim().length > 0;

  return (
    <Modal title="新增歷代祖先牌位" onClose={onClose}>
      {loading ? (
        <p className="py-8 text-center text-sm text-ink-soft">載入中…</p>
      ) : (
        <div className="space-y-4">
          {error && <p className={errorTextClass}>{error}</p>}

          {/* ── 重複確認 ── */}
          {duplicates && duplicates.length > 0 ? (
            <div className="space-y-4">
              <div className="rounded-2xl bg-yolk-100 px-4 py-3 text-sm text-ink">
                <p className="mb-2 font-medium">這一戶已有相似的牌位</p>
                <ul className="space-y-1 text-xs text-ink-soft">
                  {duplicates.map((d) => (
                    <li key={d.id}>
                      {d.displayName}
                      {d.location && `（${d.location}）`}－{d.reason}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-soft">
                  確認不是同一筆資料的話，可以繼續建立。
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => setDuplicates(null)}
                >
                  返回修改
                </button>
                <button
                  type="button"
                  className={primaryButtonClass}
                  disabled={submitting}
                  onClick={() => void submit(true)}
                >
                  仍要建立
                </button>
              </div>
            </div>
          ) : step === "edit" ? (
            <>
              {/* ── 名稱 ── */}
              <div>
                <label className={labelClass}>歷代祖先名稱</label>
                <input
                  className={inputClass}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="例如：王姓歷代祖先"
                />
                {existing.length > 0 && (
                  <p className="mt-1 text-xs text-ink-faint">
                    這一戶既有牌位：{existing.map((e) => e.displayName).join("、")}
                  </p>
                )}
              </div>

              {/* ── 牌位地址 ── */}
              <div>
                <label className={labelClass}>
                  牌位地址
                  <span className="ml-1 text-ink-faint">（建議填寫，暫時不知道可留空）</span>
                </label>
                <input
                  className={inputClass}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="牌位安奉的地址"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {householdAddress && (
                    <button
                      type="button"
                      onClick={() => setLocation(householdAddress)}
                      className="min-h-9 rounded-full bg-mist-100 px-3 py-1.5 text-xs text-ink transition hover:bg-mist-200"
                    >
                      帶入家戶地址
                    </button>
                  )}
                  {location && (
                    <button
                      type="button"
                      onClick={() => setLocation("")}
                      className="min-h-9 rounded-full px-3 py-1.5 text-xs text-ink-soft transition hover:bg-cream-200"
                    >
                      清空
                    </button>
                  )}
                </div>
                {!location.trim() && (
                  <p className="mt-1 text-xs text-ink-faint">
                    留空會標示為「待補資料」，之後仍可補上，不影響建立。
                  </p>
                )}
              </div>

              {/* ── 陽上人 ── */}
              <div>
                <label className={labelClass}>
                  陽上人
                  <span className="ml-1 text-ink-faint">（可多位，用頓號分隔）</span>
                </label>
                <textarea
                  className={`${inputClass} min-h-20`}
                  value={yangshangName}
                  onChange={(e) => setYangshangName(e.target.value)}
                  placeholder="例如：王大明、陳小美"
                />
                <p className="mt-1 text-xs text-ink-faint">
                  只需要填姓名。「叩薦」會在列印時自動加上，不用輸入；也不需要填孝男、孝女等稱謂。
                </p>

                {suggestions.length > 0 && (
                  <div className="mt-2">
                    <p className="mb-1.5 text-xs text-ink-soft">快速帶入（點選後仍可自由修改）</p>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestions.map((s) => {
                        const active = currentNames.includes(s.name);
                        return (
                          <button
                            key={`${s.source}-${s.name}`}
                            type="button"
                            onClick={() => toggleSuggestion(s.name)}
                            className={`min-h-9 rounded-full px-3 py-1.5 text-xs transition ${
                              active
                                ? "bg-sage-200 text-ink"
                                : "bg-cream-100 text-ink-soft hover:bg-cream-200"
                            }`}
                          >
                            {s.name}
                            <span className="ml-1 text-ink-faint">{s.source}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* ── 備註 ── */}
              <div>
                <label className={labelClass}>備註</label>
                <textarea
                  className={`${inputClass} min-h-16`}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button type="button" className={secondaryButtonClass} onClick={onClose}>
                  取消
                </button>
                <button
                  type="button"
                  className={primaryButtonClass}
                  disabled={!canProceed}
                  onClick={() => setStep("preview")}
                >
                  下一步：確認內容
                </button>
              </div>
            </>
          ) : (
            /* ── 列印預覽與確認 ── */
            <>
              <div className="rounded-2xl border border-cream-200 bg-cream-50 p-4">
                <p className="mb-3 text-xs text-ink-soft">列印時的內容</p>
                <dl className="space-y-2 text-sm">
                  <div className="flex gap-3">
                    <dt className="w-20 shrink-0 text-ink-faint">名稱</dt>
                    <dd className="text-ink">{displayName.trim()}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-20 shrink-0 text-ink-faint">牌位地址</dt>
                    <dd className="text-ink">
                      {location.trim() || (
                        <span className="text-ink-faint">未填（待補資料）</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-20 shrink-0 text-ink-faint">陽上人</dt>
                    <dd className="text-ink">
                      {printYangshangName(yangshangName) || (
                        <span className="text-ink-faint">未填（待補資料）</span>
                      )}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-ink-faint">
                  資料庫只會儲存姓名本身；「叩薦」與門牌國字轉換都只發生在列印輸出。
                </p>
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => setStep("edit")}
                >
                  返回修改
                </button>
                <button
                  type="button"
                  className={primaryButtonClass}
                  disabled={submitting}
                  onClick={() => void submit(false)}
                >
                  {submitting ? "建立中…" : "確認建立"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
