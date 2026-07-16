"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import {
  errorTextClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/household/formStyles";
import BirthdayField, { createEmptyBirthdayValue, type BirthdayValue } from "@/components/birthday/BirthdayField";
import { purificationPaymentStatusOptions } from "@/lib/labels";

type SearchResult = { memberId: string | null; name: string; householdId: string };

type Props = {
  purificationYearId: string;
  onClose: () => void;
  onRegistered: (result: { id: string; number: number }) => void;
};

/**
 * 祭改報名表單（需求「二」）。
 *
 * 兩種模式：
 * 1. 一般報名——從信眾主資料搜尋選人，姓名/性別/生日一律引用信眾主資料，
 *    不會在這裡重複輸入或另外儲存一份。
 * 2. 臨時報名（isTemporaryName）——信眾主資料還沒有建立的人，才需要手動
 *    輸入姓名/性別/生日/地址/電話。
 *
 * 編號由系統自動編列，這裡不提供編號欄位。
 */
export default function RegisterEntrantModal({ purificationYearId, onClose, onRegistered }: Props) {
  const [mode, setMode] = useState<"member" | "temporary">("member");

  // 一般報名：信眾搜尋
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedMember, setSelectedMember] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  // 臨時報名欄位
  const [manualDisplayName, setManualDisplayName] = useState("");
  const [manualGender, setManualGender] = useState<"" | "男" | "女">("");
  const [birthday, setBirthday] = useState<BirthdayValue>(createEmptyBirthdayValue());
  const [manualAddress, setManualAddress] = useState("");
  const [manualPhone, setManualPhone] = useState("");

  // 臨時報名——所屬家戶搜尋（V8.1 起，每一位報名者都必須掛在某一戶底下，
  // 見 src/lib/purification.ts 檔案頂端的說明；一般報名選信眾時已經會
  // 一併帶出所屬家戶，這裡只有「臨時報名」模式才需要另外搜尋/選擇）。
  const [householdQuery, setHouseholdQuery] = useState("");
  const [householdResults, setHouseholdResults] = useState<SearchResult[]>([]);
  const [selectedHousehold, setSelectedHousehold] = useState<{ id: string; label: string } | null>(null);
  const [householdSearching, setHouseholdSearching] = useState(false);

  // 共同欄位
  const [householdId, setHouseholdId] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<"UNPAID" | "PARTIAL" | "PAID">("UNPAID");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [operatorName, setOperatorName] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q || mode !== "member") {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults((data.results ?? []).filter((r: SearchResult) => r.memberId));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, mode]);

  useEffect(() => {
    const q = householdQuery.trim();
    if (!q || mode !== "temporary") {
      setHouseholdResults([]);
      return;
    }
    setHouseholdSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        // 家戶搜尋不限定要不要對到特定成員，重複的家戶編號只留一筆。
        const seen = new Set<string>();
        const deduped: SearchResult[] = [];
        for (const r of (data.results ?? []) as SearchResult[]) {
          if (seen.has(r.householdId)) continue;
          seen.add(r.householdId);
          deduped.push(r);
        }
        setHouseholdResults(deduped);
      } catch {
        setHouseholdResults([]);
      } finally {
        setHouseholdSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [householdQuery, mode]);

  function pickMember(r: SearchResult) {
    setSelectedMember(r);
    setHouseholdId(r.householdId);
    setQuery(r.name);
    setResults([]);
  }

  function pickHousehold(r: SearchResult) {
    setSelectedHousehold({ id: r.householdId, label: `${r.name}（${r.householdId}）` });
    setHouseholdId(r.householdId);
    setHouseholdQuery(r.name);
    setHouseholdResults([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "member" && !selectedMember) {
      setError("請先從搜尋結果選擇一位信眾");
      return;
    }
    if (mode === "temporary" && !manualDisplayName.trim()) {
      setError("臨時報名請填寫姓名");
      return;
    }
    if (mode === "temporary" && !householdId) {
      setError("請先搜尋並選擇這位報名者所屬的家戶");
      return;
    }

    const body: Record<string, unknown> = {
      householdId: householdId || null,
      paymentStatus,
      paymentAmount: paymentAmount ? Number(paymentAmount) : null,
      notes: notes || null,
      operatorName: operatorName || null,
    };

    if (mode === "member") {
      body.memberId = selectedMember!.memberId;
      body.isTemporaryName = false;
    } else {
      body.isTemporaryName = true;
      body.manualDisplayName = manualDisplayName.trim();
      body.manualGender = manualGender || null;
      body.manualAddress = manualAddress || null;
      body.manualPhone = manualPhone || null;
      if (birthday.birthdayType === "solar" && birthday.solarBirthDate) {
        body.manualSolarBirthDate = birthday.solarBirthDate;
      } else if (
        birthday.birthdayType === "lunar" &&
        birthday.lunarBirthYear &&
        birthday.lunarBirthMonth &&
        birthday.lunarBirthDay
      ) {
        body.manualLunarBirthYear = Number(birthday.lunarBirthYear);
        body.manualLunarBirthMonth = Number(birthday.lunarBirthMonth);
        body.manualLunarBirthDay = Number(birthday.lunarBirthDay);
        body.manualLunarIsLeapMonth = birthday.lunarIsLeapMonth;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/purification/years/${purificationYearId}/registrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "報名失敗");
        return;
      }
      onRegistered({ id: data.id, number: data.number });
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="祭改報名" onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex gap-2">
          <button
            type="button"
            className={`rounded-full px-4 py-2 text-sm transition ${
              mode === "member" ? "bg-ink-soft text-cream-50" : "bg-cream-200 text-ink-soft"
            }`}
            onClick={() => {
              setMode("member");
              setHouseholdId("");
              setSelectedHousehold(null);
              setHouseholdQuery("");
            }}
          >
            一般報名（從信眾資料選人）
          </button>
          <button
            type="button"
            className={`rounded-full px-4 py-2 text-sm transition ${
              mode === "temporary" ? "bg-ink-soft text-cream-50" : "bg-cream-200 text-ink-soft"
            }`}
            onClick={() => {
              setMode("temporary");
              setHouseholdId("");
              setSelectedMember(null);
              setQuery("");
            }}
          >
            臨時報名（尚無信眾資料）
          </button>
        </div>

        {mode === "member" ? (
          <div className="relative">
            <label className={labelClass}>搜尋姓名／電話／地址／家戶編號</label>
            <input
              className={inputClass}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedMember(null);
              }}
              placeholder="輸入關鍵字搜尋信眾"
              autoFocus
            />
            {searching && <p className="mt-1 text-xs text-ink-faint">搜尋中…</p>}
            {results.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-xl border border-cream-300 bg-white shadow-card">
                {results.map((r) => (
                  <li key={`${r.householdId}-${r.memberId}`}>
                    <button
                      type="button"
                      className="w-full px-4 py-2 text-left text-sm hover:bg-cream-100"
                      onClick={() => pickMember(r)}
                    >
                      {r.name}
                      <span className="ml-2 text-xs text-ink-faint">{r.householdId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selectedMember && (
              <p className="mt-2 text-xs text-sage-300">
                已選擇：{selectedMember.name}（{selectedMember.householdId}）
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="relative">
              <label className={labelClass}>所屬家戶（搜尋家戶編號／電話／地址／聯絡人）</label>
              <input
                className={inputClass}
                value={householdQuery}
                onChange={(e) => {
                  setHouseholdQuery(e.target.value);
                  setSelectedHousehold(null);
                  setHouseholdId("");
                }}
                placeholder="輸入關鍵字搜尋家戶"
              />
              {householdSearching && <p className="mt-1 text-xs text-ink-faint">搜尋中…</p>}
              {householdResults.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-xl border border-cream-300 bg-white shadow-card">
                  {householdResults.map((r) => (
                    <li key={r.householdId}>
                      <button
                        type="button"
                        className="w-full px-4 py-2 text-left text-sm hover:bg-cream-100"
                        onClick={() => pickHousehold(r)}
                      >
                        {r.name}
                        <span className="ml-2 text-xs text-ink-faint">{r.householdId}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {selectedHousehold && (
                <p className="mt-2 text-xs text-sage-300">已選擇：{selectedHousehold.label}</p>
              )}
              <p className="mt-1 text-xs text-ink-faint">
                這位報名者信眾主資料還沒建立，但仍需要指定所屬家戶（新家戶請先到家戶管理建立）。
              </p>
            </div>
            <div>
              <label className={labelClass}>姓名</label>
              <input
                className={inputClass}
                value={manualDisplayName}
                onChange={(e) => setManualDisplayName(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>性別</label>
              <select
                className={inputClass}
                value={manualGender}
                onChange={(e) => setManualGender(e.target.value as "" | "男" | "女")}
              >
                <option value="">未填寫</option>
                <option value="男">男</option>
                <option value="女">女</option>
              </select>
              <p className="mt-1 text-xs text-ink-faint">
                性別未填寫的資料，列印前會列入「待確認清單」，不會自動猜測建生／瑞生。
              </p>
            </div>
            <BirthdayField value={birthday} onChange={setBirthday} />
            <div>
              <label className={labelClass}>地址</label>
              <input className={inputClass} value={manualAddress} onChange={(e) => setManualAddress(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>電話</label>
              <input className={inputClass} value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>收款狀態</label>
            <select
              className={inputClass}
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value as "UNPAID" | "PARTIAL" | "PAID")}
            >
              {purificationPaymentStatusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>收款金額</label>
            <input
              className={inputClass}
              type="number"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>備註</label>
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div>
          <label className={labelClass}>操作人姓名（選填）</label>
          <input className={inputClass} value={operatorName} onChange={(e) => setOperatorName(e.target.value)} />
        </div>

        {error && <p className={errorTextClass}>{error}</p>}

        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className={secondaryButtonClass} onClick={onClose}>
            取消
          </button>
          <button type="submit" className={primaryButtonClass} disabled={submitting}>
            {submitting ? "報名中…" : "確認報名"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
