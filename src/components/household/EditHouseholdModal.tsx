"use client";

import { useState, type FormEvent } from "react";
import Modal from "@/components/Modal";
import { useOperator } from "@/lib/operatorClient";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "./formStyles";

type Props = {
  householdId: string;
  initial: {
    name: string;
    contactName: string | null;
    phone: string | null;
    mobile: string | null;
    address: string | null;
    companyName: string | null;
    notes: string | null;
  };
  onClose: () => void;
  onSuccess: () => void;
};

/**
 * V12.1「家戶管理中心」擴充：原本只能改主要聯絡人／電話／地址／公司名稱／
 * 備註，這次加入家戶編號（householdCode）、戶名（householdName）、手機
 * （mobile，既有 Household.mobile 欄位，V11.3 已建立）。
 *
 * 家戶編號修改前會由伺服器端檢查是否與其他家戶重複（見
 * src/lib/householdManagement.ts validateHouseholdCode），這裡前端只做
 * 「不可空白」的基本檢查，真正的唯一性判斷一律以 API 回傳結果為準。
 */
export default function EditHouseholdModal({ householdId, initial, onClose, onSuccess }: Props) {
  const { operatorUserId } = useOperator();

  const [householdCode, setHouseholdCode] = useState(householdId);
  const [householdName, setHouseholdName] = useState(initial.name ?? "");
  const [contactName, setContactName] = useState(initial.contactName ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [mobile, setMobile] = useState(initial.mobile ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [companyName, setCompanyName] = useState(initial.companyName ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return; // 儲存期間避免重複點擊

    const trimmedCode = householdCode.trim();
    if (!trimmedCode) {
      setError("家戶編號不可空白");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/households/${householdId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorUserId,
          householdCode: trimmedCode,
          householdName,
          contactName,
          phone,
          mobile,
          address,
          companyName,
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "修改失敗，請稍後再試一次。");
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
    <Modal title="修改家戶資料" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className={labelClass}>家戶編號</label>
          <input
            className={`${inputClass} min-h-11`}
            value={householdCode}
            onChange={(e) => setHouseholdCode(e.target.value)}
            autoFocus
          />
          <p className="mt-1 text-xs text-ink-faint">修改前會檢查是否與其他家戶重複，重複時不會儲存。</p>
        </div>
        <div>
          <label className={labelClass}>戶名</label>
          <input
            className={`${inputClass} min-h-11`}
            value={householdName}
            onChange={(e) => setHouseholdName(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>主要聯絡人</label>
          <input
            className={`${inputClass} min-h-11`}
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>電話</label>
          <input className={`${inputClass} min-h-11`} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>手機</label>
          <input className={`${inputClass} min-h-11`} value={mobile} onChange={(e) => setMobile(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>地址</label>
          <input
            className={`${inputClass} min-h-11`}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>公司名稱</label>
          <input
            className={`${inputClass} min-h-11`}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>備註</label>
          <textarea
            className={`${inputClass} min-h-11`}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error && <p className={errorTextClass}>{error}</p>}

        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className={`${secondaryButtonClass} min-h-11 w-full sm:w-auto`} onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button type="submit" className={`${primaryButtonClass} min-h-11 w-full sm:w-auto`} disabled={submitting}>
            {submitting ? "儲存中…" : "儲存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
