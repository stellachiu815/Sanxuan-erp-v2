"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/Modal";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";
import { printYangshangName, splitYangshangNames, normalizeYangshangName } from "@/lib/printChinese";

/**
 * V13.1 指令五／九：辭世後的兩段式詢問。
 *
 * 只有在信眾**第一次**由「在世」變成「已辭世」且儲存成功後才會出現
 * （由 API 回傳的 justMarkedDeceased 決定）。一般編輯不會彈出。
 *
 * 流程：
 *   詢問①「是否建立乙位正魂？」[建立乙位正魂][暫不處理]
 *     → 建立表單（預覽 → 確認）
 *       → 詢問②「是否加入中元普渡？」[確認加入][修改活動年度][暫不加入]
 *
 * ⚠️ 「暫不處理」會呼叫 API 寫入 soulTabletPromptedAt，之後不再自動詢問。
 */

type YangshangSuggestion = { name: string; source: string };

type Preview = {
  alreadyExists: boolean;
  existingId: string | null;
  displayName: string;
  householdId: string;
  householdName: string;
  suggestedLocation: string | null;
  householdAddress: string | null;
  yangshangSuggestions: YangshangSuggestion[];
  operatorName: string;
};

type SalvationPreview = {
  worshipRecordId: string;
  confirmText: string;
  alreadyJoined: boolean;
  yearDecision:
    | { ok: true; candidate: { year: number; name: string }; reason: string; alternatives: { year: number; name: string }[] }
    | { ok: false; reason: string; alternatives: { year: number; name: string }[] };
};

type Props = {
  memberId: string;
  memberName: string;
  operatorUserId: string | null;
  onClose: () => void;
  onFinished: () => void;
};

type Stage = "ask-tablet" | "tablet-form" | "ask-salvation" | "done";

export default function DeceasedFollowUpDialog({
  memberId,
  memberName,
  operatorUserId,
  onClose,
  onFinished,
}: Props) {
  const [stage, setStage] = useState<Stage>("ask-tablet");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [location, setLocation] = useState("");
  const [yangshangName, setYangshangName] = useState("");
  const [notes, setNotes] = useState("");

  const [worshipRecordId, setWorshipRecordId] = useState<string | null>(null);
  const [salvation, setSalvation] = useState<SalvationPreview | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [finalMessage, setFinalMessage] = useState<string | null>(null);

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
          `/api/devotee-center/${memberId}/soul-tablet?operatorUserId=${encodeURIComponent(operatorUserId)}`
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data?.error ?? "載入資料失敗");
          return;
        }
        const p = data.preview as Preview;
        setPreview(p);
        setDisplayName(p.displayName);
        setLocation(p.suggestedLocation ?? "");
      } catch {
        if (!cancelled) setError("載入資料時發生連線問題");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [memberId, operatorUserId]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/devotee-center/${memberId}/soul-tablet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId, ...body }),
      });
      return { res, data: await res.json() };
    },
    [memberId, operatorUserId]
  );

  /** 暫不處理：記錄後就不再自動詢問 */
  const defer = useCallback(async () => {
    setBusy(true);
    try {
      await post({ action: "defer" });
      onFinished();
      onClose();
    } finally {
      setBusy(false);
    }
  }, [post, onFinished, onClose]);

  const createTablet = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { res, data } = await post({
        action: "create",
        displayName: displayName.trim(),
        location: location.trim() || null,
        yangshangName: normalizeYangshangName(yangshangName),
        notes: notes.trim() || null,
      });
      if (!res.ok) {
        setError(data?.error ?? "建立失敗");
        return;
      }
      setWorshipRecordId(data.worshipRecordId);

      // 建立成功 → 進入詢問②
      const { res: r2, data: d2 } = await post({
        action: "salvation-preview",
        worshipRecordId: data.worshipRecordId,
      });
      if (r2.ok) {
        const p = d2.preview as SalvationPreview;
        setSalvation(p);
        setSelectedYear(p.yearDecision.ok ? p.yearDecision.candidate.year : null);
      }
      setStage("ask-salvation");
    } catch {
      setError("建立時發生連線問題");
    } finally {
      setBusy(false);
    }
  }, [post, displayName, location, yangshangName, notes]);

  const joinSalvation = useCallback(async () => {
    if (!worshipRecordId || selectedYear === null) return;
    setBusy(true);
    setError(null);
    try {
      const { res, data } = await post({
        action: "join-salvation",
        worshipRecordId,
        year: selectedYear,
      });
      if (!res.ok) {
        setError(data?.error ?? "加入普渡失敗");
        return;
      }
      setFinalMessage(data.message ?? "已加入中元普渡");
      setStage("done");
      onFinished();
    } catch {
      setError("加入普渡時發生連線問題");
    } finally {
      setBusy(false);
    }
  }, [post, worshipRecordId, selectedYear, onFinished]);

  const yearOptions = salvation
    ? [
        ...(salvation.yearDecision.ok ? [salvation.yearDecision.candidate] : []),
        ...salvation.yearDecision.alternatives,
      ]
    : [];

  return (
    <Modal title={`${memberName} 已標記為辭世`} onClose={onClose}>
      {loading ? (
        <p className="py-8 text-center text-sm text-ink-soft">載入中…</p>
      ) : (
        <div className="space-y-4">
          {error && <p className={errorTextClass}>{error}</p>}

          {/* ── 詢問①：是否建立乙位正魂 ── */}
          {stage === "ask-tablet" && preview && (
            <>
              {preview.alreadyExists ? (
                <>
                  <p className="rounded-2xl bg-mist-100 px-4 py-3 text-sm text-ink">
                    此信眾已有乙位正魂資料，不需要重複建立。
                  </p>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" className={secondaryButtonClass} onClick={onClose}>
                      關閉
                    </button>
                    <a
                      href={`/household/${preview.householdId}`}
                      className={primaryButtonClass}
                    >
                      查看既有資料
                    </a>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-ink">是否要為這位信眾建立乙位正魂？</p>
                  <p className="text-xs text-ink-faint">
                    系統不會自動建立。選擇「暫不處理」之後不會再重複詢問，
                    信眾詳情頁仍保留「建立乙位正魂」按鈕，日後隨時可以建立。
                  </p>
                  <div className="flex flex-wrap justify-end gap-2 pt-2">
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      disabled={busy}
                      onClick={() => void defer()}
                    >
                      暫不處理
                    </button>
                    <button
                      type="button"
                      className={primaryButtonClass}
                      onClick={() => setStage("tablet-form")}
                    >
                      建立乙位正魂
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── 乙位正魂建立表單 ── */}
          {stage === "tablet-form" && preview && (
            <>
              <div>
                <label className={labelClass}>亡者姓名（牌位名稱）</label>
                <input
                  className={inputClass}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>

              <div className="rounded-2xl bg-cream-100 px-4 py-3 text-xs text-ink-soft">
                所屬家戶：{preview.householdName}（{preview.householdId}）
                <br />
                建立人：{preview.operatorName}
              </div>

              <div>
                <label className={labelClass}>
                  牌位地址
                  <span className="ml-1 text-ink-faint">（建議填寫，可留空）</span>
                </label>
                <input
                  className={inputClass}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {preview.householdAddress && (
                    <button
                      type="button"
                      onClick={() => setLocation(preview.householdAddress ?? "")}
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
                <p className="mt-1 text-xs text-ink-faint">
                  這是牌位安奉的地址，不是亡者生前的居住地址。
                </p>
              </div>

              <div>
                <label className={labelClass}>陽上人（可多位，用頓號分隔）</label>
                <textarea
                  className={`${inputClass} min-h-20`}
                  value={yangshangName}
                  onChange={(e) => setYangshangName(e.target.value)}
                  placeholder="例如：王大明、陳小美"
                />
                {preview.yangshangSuggestions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {preview.yangshangSuggestions.map((s) => {
                      const active = splitYangshangNames(yangshangName).includes(s.name);
                      return (
                        <button
                          key={`${s.source}-${s.name}`}
                          type="button"
                          onClick={() =>
                            setYangshangName((prev) => {
                              const names = splitYangshangNames(prev);
                              return (
                                names.includes(s.name)
                                  ? names.filter((n) => n !== s.name)
                                  : [...names, s.name]
                              ).join("、");
                            })
                          }
                          className={`min-h-9 rounded-full px-3 py-1.5 text-xs transition ${
                            active ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft hover:bg-cream-200"
                          }`}
                        >
                          {s.name}
                          <span className="ml-1 text-ink-faint">{s.source}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {yangshangName.trim() && (
                  <p className="mt-1.5 text-xs text-ink-faint">
                    列印時顯示為：{printYangshangName(yangshangName)}
                  </p>
                )}
              </div>

              <div>
                <label className={labelClass}>備註</label>
                <textarea
                  className={`${inputClass} min-h-16`}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => setStage("ask-tablet")}
                >
                  返回
                </button>
                <button
                  type="button"
                  className={primaryButtonClass}
                  disabled={busy || !displayName.trim()}
                  onClick={() => void createTablet()}
                >
                  {busy ? "建立中…" : "確認建立"}
                </button>
              </div>
            </>
          )}

          {/* ── 詢問②：是否加入中元普渡 ── */}
          {stage === "ask-salvation" && (
            <>
              <p className="rounded-2xl bg-sage-100 px-4 py-3 text-sm text-ink">
                乙位正魂已建立完成。
              </p>

              {salvation?.yearDecision.ok === false ? (
                <>
                  <p className="rounded-2xl bg-yolk-100 px-4 py-3 text-sm text-ink">
                    {salvation.yearDecision.reason}
                  </p>
                  <p className="text-xs text-ink-faint">
                    系統不會自動建立不存在的活動年度，請先於活動中心建立中元普渡活動。
                  </p>
                  <div className="flex justify-end pt-2">
                    <button type="button" className={primaryButtonClass} onClick={onClose}>
                      關閉
                    </button>
                  </div>
                </>
              ) : salvation?.alreadyJoined ? (
                <>
                  <p className="text-sm text-ink">{salvation.confirmText}</p>
                  <div className="flex justify-end pt-2">
                    <button type="button" className={primaryButtonClass} onClick={onClose}>
                      關閉
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-ink">是否要加入中元普渡？</p>
                  {salvation?.yearDecision.ok && (
                    <p className="text-xs text-ink-faint">{salvation.yearDecision.reason}</p>
                  )}

                  <div>
                    <label className={labelClass}>活動年度（可修改）</label>
                    <select
                      className={inputClass}
                      value={selectedYear ?? ""}
                      onChange={(e) => setSelectedYear(Number(e.target.value))}
                    >
                      {yearOptions.map((c) => (
                        <option key={c.year} value={c.year}>
                          民國 {c.year} 年{c.name ? `　${c.name}` : ""}
                        </option>
                      ))}
                    </select>
                    {selectedYear !== null && (
                      <p className="mt-1.5 text-sm text-ink">
                        將加入民國 {selectedYear} 年中元普渡
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap justify-end gap-2 pt-2">
                    <button type="button" className={secondaryButtonClass} onClick={onClose}>
                      暫不加入
                    </button>
                    <button
                      type="button"
                      className={primaryButtonClass}
                      disabled={busy || selectedYear === null}
                      onClick={() => void joinSalvation()}
                    >
                      {busy ? "處理中…" : "確認加入"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── 完成 ── */}
          {stage === "done" && (
            <>
              <p className="rounded-2xl bg-sage-100 px-4 py-3 text-sm text-ink">
                {finalMessage}
              </p>
              <div className="flex justify-end pt-2">
                <button type="button" className={primaryButtonClass} onClick={onClose}>
                  完成
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
