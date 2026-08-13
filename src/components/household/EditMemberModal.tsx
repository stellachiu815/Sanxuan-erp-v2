"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { useOperator } from "@/lib/operatorClient";
import BirthdayField, { createEmptyBirthdayValue, type BirthdayValue } from "@/components/birthday/BirthdayField";
import {
  inputClass,
  labelClass,
  checkboxRowClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "./formStyles";

/**
 * V40「修改成員資料」——編輯一位既有家戶成員的個人資料。
 * 開啟時先 GET 現值預填；送出走 PATCH /api/households/[id]/members/[memberId]。
 * 只改個人資料（姓名／性別／生日／個人地址／是否辭世／備註）；身份與主要聯絡人不在這裡改。
 */
type Props = {
  householdId: string;
  memberId: string;
  memberName: string;
  onClose: () => void;
  onSuccess: () => void;
};

export default function EditMemberModal({ householdId, memberId, memberName, onClose, onSuccess }: Props) {
  const { operatorUserId } = useOperator();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [isDeceased, setIsDeceased] = useState(false);
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [birthday, setBirthday] = useState<BirthdayValue>(createEmptyBirthdayValue());

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 載入目前值預填。
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/households/${householdId}/members/${memberId}${operatorUserId ? `?operatorUserId=${operatorUserId}` : ""}`);
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) { setError(data?.error ?? "載入成員資料失敗"); return; }
        const m = data.member;
        setName(m.name ?? "");
        setGender(m.gender ?? "");
        setIsDeceased(Boolean(m.isDeceased));
        setAddress(m.address ?? "");
        setNotes(m.notes ?? "");
        if (m.solarBirthDate) {
          setBirthday({ birthdayType: "solar", solarBirthDate: m.solarBirthDate, lunarBirthYear: "", lunarBirthMonth: "", lunarBirthDay: "", lunarIsLeapMonth: false });
        } else if (m.lunarBirthYear && m.lunarBirthMonth && m.lunarBirthDay) {
          setBirthday({ birthdayType: "lunar", solarBirthDate: "", lunarBirthYear: String(m.lunarBirthYear), lunarBirthMonth: String(m.lunarBirthMonth), lunarBirthDay: String(m.lunarBirthDay), lunarIsLeapMonth: Boolean(m.lunarIsLeapMonth) });
        } else {
          setBirthday(createEmptyBirthdayValue());
        }
      } catch {
        if (alive) setError("網路錯誤，載入成員資料失敗");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [householdId, memberId, operatorUserId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!name.trim()) { setError("請輸入姓名"); return; }
    setSubmitting(true);
    setError(null);

    const payload: Record<string, unknown> = {
      operatorUserId,
      name: name.trim(),
      gender: gender || null,
      isDeceased,
      address: address.trim() || null,
      notes: notes.trim() || null,
      birthdayType: birthday.birthdayType,
    };
    if (birthday.birthdayType === "solar") {
      payload.solarBirthDate = birthday.solarBirthDate;
    } else if (birthday.birthdayType === "lunar") {
      payload.lunarBirthYear = Number(birthday.lunarBirthYear);
      payload.lunarBirthMonth = Number(birthday.lunarBirthMonth);
      payload.lunarBirthDay = Number(birthday.lunarBirthDay);
      payload.lunarIsLeapMonth = birthday.lunarIsLeapMonth;
    }

    try {
      const res = await fetch(`/api/households/${householdId}/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? "儲存失敗，請稍後再試一次。"); return; }
      onSuccess();
      onClose();
      router.refresh();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`修改成員資料：${memberName}`} onClose={onClose}>
      {loading ? (
        <p className="py-6 text-sm text-ink-faint">載入中…</p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className={labelClass}>姓名</label>
            <input className={`${inputClass} min-h-11`} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>性別</label>
              <select className={`${inputClass} min-h-11`} value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="">未填寫</option>
                <option value="男">男</option>
                <option value="女">女</option>
              </select>
            </div>
            <label className={`${checkboxRowClass} mt-6`}>
              <input type="checkbox" checked={isDeceased} onChange={(e) => setIsDeceased(e.target.checked)} />
              是否已辭世
            </label>
          </div>

          <BirthdayField value={birthday} onChange={setBirthday} />

          <div>
            <label className={labelClass}>個人地址</label>
            <input className={`${inputClass} min-h-11`} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="這位成員的個人地址（可留空）" />
          </div>

          <div>
            <label className={labelClass}>備註</label>
            <textarea className={`${inputClass} min-h-11`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {error && <p className={errorTextClass}>{error}</p>}

          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={`${secondaryButtonClass} min-h-11 w-full sm:w-auto`} onClick={onClose}>取消</button>
            <button type="submit" className={`${primaryButtonClass} min-h-11 w-full sm:w-auto`} disabled={submitting}>
              {submitting ? "儲存中…" : "儲存修改"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
