"use client";

import { useEffect, useRef, useState } from "react";

/**
 * V15R4 中文輸入法（注音）安全搜尋共用 Hook。
 *
 * 根因：controlled input 在注音「組字」期間每個 onChange 都 setState，會打斷
 * IME 組字（畫面卡在注音、送出的是注音符號而非完整中文字），因此搜尋不到。
 *
 * 這支 Hook 是首頁、新活動報名、活動詳情頁「同一套」搜尋邏輯的唯一實作：
 *  - onCompositionStart / onCompositionEnd 追蹤 isComposing。
 *  - 組字期間**不觸發** committedQuery（不送出錯誤的注音查詢）。
 *  - compositionEnd 後以「完整中文字」立即更新 committedQuery（一次）。
 *  - debounce 後才更新 committedQuery，呼叫端據此發查詢。
 *  - trim 後才輸出；Enter 立即送出（略過 debounce）。
 *
 * 呼叫端只要監看 committedQuery 發自己的 API，並各自用 useRequestSeq() 防「舊回應
 * 覆蓋新結果」（快速連續輸入時）。
 */
export function useComposedSearch(delayMs = 250) {
  const [value, setValue] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const composingRef = useRef(false);
  // 供 compositionEnd 立即取用最新輸入值。
  const latestRef = useRef("");
  latestRef.current = value;

  useEffect(() => {
    // 組字中不送查詢（避免把注音符號當查詢字串）。
    if (composingRef.current) return;
    const q = value.trim();
    const timer = setTimeout(() => setCommittedQuery(q), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  const inputProps = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value),
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: (e: React.CompositionEvent<HTMLInputElement>) => {
      composingRef.current = false;
      // 組字完成：用完整中文字立即送出一次（不等 debounce，避免漏查）。
      const finalValue = e.currentTarget.value;
      setValue(finalValue);
      setCommittedQuery(finalValue.trim());
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Enter：若正在組字（IME 尚未確認）不送出；否則立即以完整字送查詢。
      if (e.key === "Enter" && !composingRef.current) {
        setCommittedQuery(latestRef.current.trim());
      }
    },
  };

  const reset = () => {
    setValue("");
    setCommittedQuery("");
    composingRef.current = false;
  };

  return { value, setValue, committedQuery, inputProps, reset };
}

/**
 * 防「舊回應覆蓋新結果」：每次發查詢前呼叫 next() 取得序號，回應回來時用
 * isLatest(seq) 判斷是否為最新一次查詢，只有最新才可套用結果。
 */
export function useRequestSeq() {
  const seqRef = useRef(0);
  return {
    next: () => ++seqRef.current,
    isLatest: (seq: number) => seq === seqRef.current,
  };
}
