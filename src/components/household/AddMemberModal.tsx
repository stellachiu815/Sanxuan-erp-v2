"use client";

import { useState, type FormEvent } from "react";
import Modal from "@/components/Modal";
import { memberRoleOptions } from "@/lib/labels";
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

type Props = {
  householdId: string;
  onClose: () => void;
  onSuccess: () => void;
};

export default function AddMemberModal({ householdId, onClose, onSuccess }: Props) {
  // V12.1 一次性修正指令「二之4」：POST /api/households/[id]/members 這次
  // 補上了權限檢查，所以這裡必須帶目前操作人員。這個 Modal 只會在已經包了
  // <OperatorProvider> 的 QuickActionsPanel 底下開啟，沿用既有 useOperator()，
  // 不另外做一套身分傳遞。
  const { operatorUserId } = useOperator();
  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [role, setRole] = useState("OTHER");
  const [isPrimaryContact, setIsPrimaryContact] = useState(false);
  const [isDeceased, setIsDeceased] = useState(false);
  const [notes, setNotes] = useState("");

  // V5.0：生日欄位改用共用的「生日工具元件」（BirthdayField），
  // 換算邏輯與國曆/農曆輸入介面跟「生日與農曆中心」、之後年度燈/宮慶共用同一套，
  // 不用重寫。這裡的 value 型別維持跟送出 API 需要的欄位一致。
  const [birthday, setBirthday] = useState<BirthdayValue>(createEmptyBirthdayValue());

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("請輸入姓名");
      return;
    }

    setSubmitting(true);
    setError(null);

    const payload: Record<string, unknown> = {
      operatorUserId,
      name: name.trim(),
      gender: gender || null,
      role,
      isPrimaryContact,
      isDeceased,
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
      const res = await fetch(`/api/households/${householdId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "新增失敗，請稍後再試一次。");
        return;
      }
      onSuccess();
      onClose();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="新增家人" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className={labelClass}>姓名</label>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：王小美"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>性別</label>
            <select className={inputClass} value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">未填寫</option>
              <option value="男">男</option>
              <option value="女">女</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>身份</label>
            <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
              {memberRoleOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-5">
          <label className={checkboxRowClass}>
            <input
              type="checkbox"
              checked={isPrimaryContact}
              onChange={(e) => setIsPrimaryContact(e.target.checked)}
            />
            是否為主要聯絡人
          </label>
          <label className={checkboxRowClass}>
            <input
              type="checkbox"
              checked={isDeceased}
              onChange={(e) => setIsDeceased(e.target.checked)}
            />
            是否已辭世
          </label>
        </div>

        <BirthdayField value={birthday} onChange={setBirthday} />

        <div>
          <label className={labelClass}>備註</label>
          <textarea
            className={inputClass}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error && <p className={errorTextClass}>{error}</p>}

        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className={secondaryButtonClass} onClick={onClose}>
            取消
          </button>
          <button type="submit" className={primaryButtonClass} disabled={submitting}>
            {submitting ? "新增中…" : "新增家人"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
