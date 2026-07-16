"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import {
  checkboxRowClass,
  errorTextClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/household/formStyles";
import { templeEventActivityTypeOptions } from "@/lib/labels";

type ExistingEvent = { id: string; activityType: string; year: number; name: string };

type Props = {
  existingEvents: ExistingEvent[];
  onClose: () => void;
};

type Method = "BLANK" | "COPY" | "IMPORT" | "DIRECT";

/**
 * 宮務活動中心「活動精靈」（需求「二」）：固定四步驟。
 *
 * Step1 選擇活動 → Step2 建立活動基本資料 → Step3 建立方式 → 建立完成。
 * 建立完成後自動導向對應的管理畫面（祭改沿用既有的 /purification/[id]
 * 完整畫面；其他活動類型導向新的通用 /activities/[id] 畫面），不需要
 * 使用者逐步操作（需求「四」：不得要求使用者逐步完成）。
 */
export default function ActivityWizard({ existingEvents, onClose }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [activityType, setActivityType] = useState("");
  const [year, setYear] = useState("");
  const [name, setName] = useState("");
  const [solarDate, setSolarDate] = useState("");
  const [lunarYear, setLunarYear] = useState("");
  const [lunarMonth, setLunarMonth] = useState("");
  const [lunarDay, setLunarDay] = useState("");
  const [lunarIsLeap, setLunarIsLeap] = useState(false);
  const [note, setNote] = useState("");
  const [operatorName, setOperatorName] = useState("");

  const [method, setMethod] = useState<Method>("BLANK");
  const [sourceEventId, setSourceEventId] = useState("");
  const [copyParticipants, setCopyParticipants] = useState(true);
  const [copySettings, setCopySettings] = useState(true);
  const [copyFees, setCopyFees] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sameTypeEvents = existingEvents.filter((e) => e.activityType === activityType);

  function goToStep2() {
    if (!activityType) {
      setError("請選擇活動類型");
      return;
    }
    setError(null);
    setStep(2);
  }

  function goToStep3() {
    const yearNum = Number(year);
    if (!Number.isInteger(yearNum) || yearNum < 1) {
      setError("請輸入正確的民國年度");
      return;
    }
    setError(null);
    setStep(3);
  }

  async function handleFinish() {
    setError(null);
    const yearNum = Number(year);
    setSubmitting(true);
    try {
      if (method === "COPY") {
        if (!sourceEventId) {
          setError("請選擇來源活動年度");
          setSubmitting(false);
          return;
        }
        const res = await fetch("/api/temple-events/copy-from-previous", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            activityType,
            newYear: yearNum,
            sourceEventId,
            copyParticipants,
            copySettings,
            copyFees,
            operatorName: operatorName || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "建立失敗");
          setSubmitting(false);
          return;
        }
        redirectToEvent(data.id);
        return;
      }

      const res = await fetch("/api/temple-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityType,
          year: yearNum,
          name: name || null,
          solarDate: solarDate || null,
          lunarDateYear: lunarYear ? Number(lunarYear) : null,
          lunarDateMonth: lunarMonth ? Number(lunarMonth) : null,
          lunarDateDay: lunarDay ? Number(lunarDay) : null,
          lunarDateIsLeap: lunarIsLeap,
          note: note || null,
          operatorName: operatorName || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "建立失敗");
        setSubmitting(false);
        return;
      }
      redirectToEvent(data.id);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
      setSubmitting(false);
    }
  }

  function redirectToEvent(id: string) {
    const base = activityType === "PURIFICATION" ? `/purification/${id}` : `/activities/${id}`;
    const suffix = method === "IMPORT" && activityType !== "PURIFICATION" ? "?tab=import" : "";
    router.push(base + suffix);
    router.refresh();
  }

  return (
    <Modal title="＋ 建立宮務活動" onClose={onClose}>
      <div className="mb-4 flex items-center gap-2 text-xs text-ink-faint">
        <span className={step === 1 ? "text-ink" : ""}>① 選擇活動</span>
        <span>→</span>
        <span className={step === 2 ? "text-ink" : ""}>② 基本資料</span>
        <span>→</span>
        <span className={step === 3 ? "text-ink" : ""}>③ 建立方式</span>
      </div>

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-soft">所有宮務活動都從這裡建立，不會另外開發新的建立流程。</p>
          <div className="grid grid-cols-2 gap-3">
            {templeEventActivityTypeOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setActivityType(opt.value)}
                className={`rounded-2xl px-4 py-3 text-sm transition ${
                  activityType === opt.value ? "bg-ink-soft text-cream-50" : "bg-cream-100 text-ink-soft hover:bg-cream-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {error && <p className={errorTextClass}>{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className={secondaryButtonClass} onClick={onClose}>
              取消
            </button>
            <button type="button" className={primaryButtonClass} onClick={goToStep2}>
              下一步
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div>
            <label className={labelClass}>民國年度</label>
            <input className={inputClass} type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="例如 115" autoFocus />
          </div>
          <div>
            <label className={labelClass}>活動名稱（選填，不填自動組字）</label>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>國曆日期（選填）</label>
            <input className={inputClass} type="date" value={solarDate} onChange={(e) => setSolarDate(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>農曆日期（選填）</label>
            <div className="flex gap-2">
              <input className={inputClass} type="number" placeholder="年" value={lunarYear} onChange={(e) => setLunarYear(e.target.value)} />
              <input className={inputClass} type="number" placeholder="月" value={lunarMonth} onChange={(e) => setLunarMonth(e.target.value)} />
              <input className={inputClass} type="number" placeholder="日" value={lunarDay} onChange={(e) => setLunarDay(e.target.value)} />
            </div>
            <label className={checkboxRowClass + " mt-2"}>
              <input type="checkbox" checked={lunarIsLeap} onChange={(e) => setLunarIsLeap(e.target.checked)} />
              閏月
            </label>
          </div>
          <div>
            <label className={labelClass}>備註（選填）</label>
            <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>操作人姓名（選填）</label>
            <input className={inputClass} value={operatorName} onChange={(e) => setOperatorName(e.target.value)} />
          </div>
          {error && <p className={errorTextClass}>{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className={secondaryButtonClass} onClick={() => setStep(1)}>
              上一步
            </button>
            <button type="button" className={primaryButtonClass} onClick={goToStep3}>
              下一步
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <MethodCard label="① 空白建立" active={method === "BLANK"} onClick={() => setMethod("BLANK")} />
            <MethodCard
              label="② 複製去年活動"
              active={method === "COPY"}
              onClick={() => setMethod("COPY")}
              disabled={sameTypeEvents.length === 0}
            />
            <MethodCard label="③ Excel／CSV匯入" active={method === "IMPORT"} onClick={() => setMethod("IMPORT")} />
            <MethodCard label="④ ERP直接輸入" active={method === "DIRECT"} onClick={() => setMethod("DIRECT")} />
          </div>

          {method === "COPY" && (
            <div className="flex flex-col gap-3 rounded-2xl bg-cream-100 p-4">
              <div>
                <label className={labelClass}>來源年度</label>
                <select className={inputClass} value={sourceEventId} onChange={(e) => setSourceEventId(e.target.value)}>
                  <option value="">請選擇</option>
                  {sameTypeEvents.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>
              <label className={checkboxRowClass}>
                <input type="checkbox" checked={copyParticipants} onChange={(e) => setCopyParticipants(e.target.checked)} />
                去年參加名單
              </label>
              <label className={checkboxRowClass}>
                <input type="checkbox" checked={copySettings} onChange={(e) => setCopySettings(e.target.checked)} />
                去年設定
              </label>
              <label className={checkboxRowClass}>
                <input type="checkbox" checked={copyFees} onChange={(e) => setCopyFees(e.target.checked)} />
                去年收費
              </label>
            </div>
          )}

          {method === "IMPORT" && (
            <p className="rounded-2xl bg-cream-100 p-4 text-xs text-ink-soft">
              建立完成後會直接進入這個活動的「Excel／CSV匯入」畫面，上傳檔案後系統會先分析新增/更新/重複/缺少資料，
              確認無誤才會真正建立資料。
            </p>
          )}

          {method === "DIRECT" && (
            <p className="rounded-2xl bg-cream-100 p-4 text-xs text-ink-soft">
              建立完成後會直接進入這個活動的管理畫面，可以立即開始一筆一筆輸入資料。
            </p>
          )}

          {error && <p className={errorTextClass}>{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className={secondaryButtonClass} onClick={() => setStep(2)}>
              上一步
            </button>
            <button type="button" className={primaryButtonClass} onClick={handleFinish} disabled={submitting}>
              {submitting ? "建立中…" : "建立活動"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function MethodCard({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-2xl px-4 py-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-ink-soft text-cream-50" : "bg-cream-100 text-ink-soft hover:bg-cream-200"
      }`}
    >
      {label}
    </button>
  );
}
