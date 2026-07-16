"use client";

import { useState, type FormEvent } from "react";
import Modal from "@/components/Modal";
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
    contactName: string | null;
    phone: string | null;
    address: string | null;
    companyName: string | null;
    notes: string | null;
  };
  onClose: () => void;
  onSuccess: () => void;
};

export default function EditHouseholdModal({ householdId, initial, onClose, onSuccess }: Props) {
  const [contactName, setContactName] = useState(initial.contactName ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [companyName, setCompanyName] = useState(initial.companyName ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/households/${householdId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactName, phone, address, companyName, notes }),
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
          <label className={labelClass}>主要聯絡人</label>
          <input
            className={inputClass}
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className={labelClass}>電話</label>
          <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>地址</label>
          <input
            className={inputClass}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>公司名稱</label>
          <input
            className={inputClass}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
        </div>
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
            {submitting ? "儲存中…" : "儲存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
