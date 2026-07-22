"use client";

import { useEffect, useRef, useState } from "react";
import { inputClass, labelClass, checkboxRowClass, errorTextClass } from "@/components/household/formStyles";
// V13.4 驗收：生日預覽的國曆／農曆都用「唯一共用」的民國格式函式，
// 與信眾詳情頁、convert API 同一套，元件內不自行拼字串、不用西元。
import { formatIsoDateToMinguoLong, formatLunarDateToMinguoLong } from "@/lib/minguoDate";

export type BirthdayType = "none" | "solar" | "lunar";

export type BirthdayValue = {
  birthdayType: BirthdayType;
  solarBirthDate: string; // "yyyy-MM-dd"，未填為 ""
  lunarBirthYear: string; // 用字串存，方便直接綁定 <input>
  lunarBirthMonth: string;
  lunarBirthDay: string;
  lunarIsLeapMonth: boolean;
};

export function createEmptyBirthdayValue(): BirthdayValue {
  return {
    birthdayType: "none",
    solarBirthDate: "",
    lunarBirthYear: "",
    lunarBirthMonth: "",
    lunarBirthDay: "",
    lunarIsLeapMonth: false,
  };
}

type ConvertResult = {
  solarDate: string;
  solarFormatted: string;
  lunar: { year: number; month: number; day: number; isLeapMonth: boolean };
  lunarFormatted: string;
  zodiac: string;
  actualAge: number;
  nominalAge: number;
};

type Props = {
  value: BirthdayValue;
  onChange: (value: BirthdayValue) => void;
  /** 是否顯示「先不填」選項，預設 true（新增家人等情境通常允許先不填）。 */
  allowNone?: boolean;
};

/**
 * 生日工具元件（V5.0「生日與農曆中心」新增）。
 *
 * 國曆／農曆輸入後即時換算顯示另一種曆法、生肖、實歲、虛歲；農曆模式支援
 * 閏月；如果只記得生肖，可以展開「只知道生肖？」查詢候選出生年。
 *
 * 這是「生日資料全部共用同一套」的具體實作：家戶新增家人（AddMemberModal）
 * 已經改用這個元件；之後年度燈、宮慶如果需要輸入生日，直接 import 這個元件
 * 即可，不用重寫一次輸入介面或換算邏輯。換算邏輯本身仍集中在
 * src/lib/lunar.ts，這個元件透過 /api/birthday/convert 呼叫，不直接依賴
 * lunar-javascript（該套件是給伺服器端使用的 CommonJS 模組）。
 */
export default function BirthdayField({ value, onChange, allowNone = true }: Props) {
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  const [showZodiacHelper, setShowZodiacHelper] = useState(false);
  const [zodiacOptions, setZodiacOptions] = useState<string[]>([]);
  const [selectedZodiac, setSelectedZodiac] = useState("");
  const [candidates, setCandidates] = useState<{ lunarYear: number; nominalAge: number }[] | null>(
    null
  );
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  const requestIdRef = useRef(0);

  function update(patch: Partial<BirthdayValue>) {
    onChange({ ...value, ...patch });
  }

  // 即時換算（debounce 300ms），國曆/農曆模式各自的必填欄位齊全才呼叫。
  useEffect(() => {
    setConvertError(null);

    let body: Record<string, unknown> | null = null;
    if (value.birthdayType === "solar" && value.solarBirthDate) {
      body = { mode: "solar", solarDate: value.solarBirthDate };
    } else if (
      value.birthdayType === "lunar" &&
      value.lunarBirthYear &&
      value.lunarBirthMonth &&
      value.lunarBirthDay
    ) {
      body = {
        mode: "lunar",
        lunarYear: Number(value.lunarBirthYear),
        lunarMonth: Number(value.lunarBirthMonth),
        lunarDay: Number(value.lunarBirthDay),
        lunarIsLeapMonth: value.lunarIsLeapMonth,
      };
    }

    if (!body) {
      setResult(null);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    const timer = setTimeout(async () => {
      setConverting(true);
      try {
        const res = await fetch("/api/birthday/convert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (currentRequestId !== requestIdRef.current) return; // 過期的回應，忽略
        if (!res.ok) {
          setConvertError(data.error ?? "換算失敗");
          setResult(null);
          return;
        }
        setResult(data);
      } catch {
        if (currentRequestId === requestIdRef.current) {
          setConvertError("網路錯誤，換算失敗");
          setResult(null);
        }
      } finally {
        if (currentRequestId === requestIdRef.current) setConverting(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [
    value.birthdayType,
    value.solarBirthDate,
    value.lunarBirthYear,
    value.lunarBirthMonth,
    value.lunarBirthDay,
    value.lunarIsLeapMonth,
  ]);

  // 展開「只知道生肖」時才載入 12 生肖選項，不用一開始就打 API。
  useEffect(() => {
    if (!showZodiacHelper || zodiacOptions.length > 0) return;
    fetch("/api/birthday/zodiac-options")
      .then((res) => res.json())
      .then((data) => setZodiacOptions(data.options ?? []))
      .catch(() => {});
  }, [showZodiacHelper, zodiacOptions.length]);

  async function handlePickZodiac(zodiac: string) {
    setSelectedZodiac(zodiac);
    setCandidates(null);
    setCandidatesLoading(true);
    try {
      const res = await fetch(`/api/birthday/zodiac-candidates?zodiac=${encodeURIComponent(zodiac)}`);
      const data = await res.json();
      if (res.ok) setCandidates(data.candidates ?? []);
    } catch {
      // 查詢失敗就不顯示候選清單，行政人員可以再點一次
    } finally {
      setCandidatesLoading(false);
    }
  }

  function handlePickCandidateYear(lunarYear: number) {
    update({
      birthdayType: "lunar",
      lunarBirthYear: String(lunarYear),
      // 月、日維持行政人員現有的輸入（如果之後補得到確切月日可以自己再填），
      // 這裡只帶入年份。
    });
    setShowZodiacHelper(false);
  }

  return (
    <fieldset className="rounded-2xl bg-white/60 p-4">
      <legend className="px-1 text-xs text-ink-soft">生日（國曆或農曆擇一即可）</legend>

      <div className="flex flex-wrap gap-4 text-sm text-ink">
        {allowNone && (
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={value.birthdayType === "none"}
              onChange={() => update({ birthdayType: "none" })}
            />
            先不填
          </label>
        )}
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={value.birthdayType === "solar"}
            onChange={() => update({ birthdayType: "solar" })}
          />
          國曆
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={value.birthdayType === "lunar"}
            onChange={() => update({ birthdayType: "lunar" })}
          />
          農曆
        </label>
      </div>

      {value.birthdayType === "solar" && (
        <div className="mt-3">
          <input
            type="date"
            className={inputClass}
            value={value.solarBirthDate}
            onChange={(e) => update({ solarBirthDate: e.target.value })}
          />
        </div>
      )}

      {value.birthdayType === "lunar" && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <input
              type="number"
              placeholder="年（西元）"
              className={inputClass}
              value={value.lunarBirthYear}
              onChange={(e) => update({ lunarBirthYear: e.target.value })}
            />
            <input
              type="number"
              placeholder="月"
              className={inputClass}
              value={value.lunarBirthMonth}
              onChange={(e) => update({ lunarBirthMonth: e.target.value })}
            />
            <input
              type="number"
              placeholder="日"
              className={inputClass}
              value={value.lunarBirthDay}
              onChange={(e) => update({ lunarBirthDay: e.target.value })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className={checkboxRowClass}>
              <input
                type="checkbox"
                checked={value.lunarIsLeapMonth}
                onChange={(e) => update({ lunarIsLeapMonth: e.target.checked })}
              />
              閏月
            </label>
            <button
              type="button"
              className="text-xs text-ink-faint underline-offset-4 hover:text-ink-soft hover:underline"
              onClick={() => setShowZodiacHelper((v) => !v)}
            >
              {showZodiacHelper ? "收合生肖查詢" : "只知道生肖？點此查詢候選出生年"}
            </button>
          </div>

          {showZodiacHelper && (
            <div className="rounded-xl bg-cream-100/70 p-3">
              <p className={labelClass}>選擇生肖</p>
              <div className="flex flex-wrap gap-2">
                {zodiacOptions.length === 0 && (
                  <p className="text-xs text-ink-faint">載入生肖選項中…</p>
                )}
                {zodiacOptions.map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => handlePickZodiac(z)}
                    className={
                      "rounded-full px-3 py-1 text-xs transition " +
                      (selectedZodiac === z
                        ? "bg-ink-soft text-cream-50"
                        : "bg-white/80 text-ink-soft hover:bg-cream-200")
                    }
                  >
                    {z}
                  </button>
                ))}
              </div>

              {candidatesLoading && (
                <p className="mt-2 text-xs text-ink-faint">查詢候選出生年中…</p>
              )}

              {candidates && candidates.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-ink-faint">
                    點選一個候選出生年，會帶入農曆年欄位（月、日請自行確認後補填）：
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {candidates.map((c) => (
                      <button
                        key={c.lunarYear}
                        type="button"
                        onClick={() => handlePickCandidateYear(c.lunarYear)}
                        className="rounded-full bg-white/80 px-3 py-1 text-xs text-ink-soft transition hover:bg-mist-100"
                      >
                        西元 {c.lunarYear} 年（虛歲 {c.nominalAge} 歲）
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {candidates && candidates.length === 0 && (
                <p className="mt-2 text-xs text-ink-faint">近百年內查無符合的年份。</p>
              )}
            </div>
          )}
        </div>
      )}

      {(value.birthdayType === "solar" || value.birthdayType === "lunar") && (
        <div className="mt-3 rounded-xl bg-mist-50 px-4 py-3 text-sm text-ink">
          {converting && <p className="text-ink-faint">換算中…</p>}
          {!converting && convertError && <p className={errorTextClass}>{convertError}</p>}
          {!converting && !convertError && result && (
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {/* 顯示一律民國：國曆走 formatIsoDateToMinguoLong、農曆走
                  formatLunarDateToMinguoLong，資料取自 convert API 回傳的
                  原始 solarDate（ISO）與 lunar 物件，不用 *Formatted 字串。 */}
              <span>國曆：{formatIsoDateToMinguoLong(result.solarDate) || "—"}</span>
              <span>
                農曆：
                {formatLunarDateToMinguoLong({
                  year: result.lunar.year,
                  month: result.lunar.month,
                  day: result.lunar.day,
                  isLeapMonth: result.lunar.isLeapMonth,
                }) || "—"}
              </span>
              <span>生肖：{result.zodiac}</span>
              <span>實歲：{result.actualAge}</span>
              <span>虛歲：{result.nominalAge}</span>
            </div>
          )}
          {!converting && !convertError && !result && (
            <p className="text-ink-faint">
              {value.birthdayType === "solar" ? "請選擇國曆生日" : "請完整輸入農曆年、月、日"}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}
