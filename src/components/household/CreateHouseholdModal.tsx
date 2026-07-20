"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
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
  onClose: () => void;
};

/**
 * V12.1「家戶管理中心」指令「八、新增家戶」。
 *
 * 這裡只建立家戶本身的基本資料；建立成功後導向新家戶的詳細頁，家戶成員／
 * 歷代祖先／乙位正魂請直接用該頁面既有的「新增家人」「新增祭祀資料」
 * 按鈕逐一加入——這是刻意的設計決定，不是遺漏：src/lib/householdManagement.ts
 * 的 createHousehold() 本來就只負責建立家戶本身（見函式註解），家戶成員
 * 新增流程（含表單、驗證）已經在 src/components/household/AddMemberModal.tsx
 * 完整存在，這裡如果再做一套「建立家戶時順便輸入多位成員」的表單，會
 * 違反這次指令「不可建立第二套…家戶匯入系統」「若現有功能已存在，必須
 * 直接補強或擴充，不能另外新增一套相同功能」的原則。疑似重複人物提示
 * 目前也只在合併／轉移預覽時出現（見 MergeHouseholdWizard／
 * TransferMembersWizard），逐一新增成員時沒有這個提示，這是既有
 * AddMemberModal 本來就沒有的限制，這次沒有一併補上，會在交付報告清楚
 * 說明。
 */
export default function CreateHouseholdModal({ onClose }: Props) {
  const router = useRouter();
  const { operatorUserId } = useOperator();

  const [householdCode, setHouseholdCode] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [primaryContact, setPrimaryContact] = useState("");
  const [phone, setPhone] = useState("");
  const [mobile, setMobile] = useState("");
  const [address, setAddress] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const trimmedCode = householdCode.trim();
    if (!trimmedCode) {
      setError("家戶編號不可空白");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/households", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorUserId,
          householdCode: trimmedCode,
          householdName,
          primaryContact,
          phone,
          mobile,
          address,
          companyName,
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "建立失敗，請稍後再試一次。");
        return;
      }
      router.push(`/household/${data.data.household.id}`);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="新增家戶" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="rounded-2xl bg-mist-50 px-4 py-3 text-xs text-ink-soft">
          建立完成後會直接進入這個新家戶的詳細頁，家戶成員與祭祀資料請在那裡用「新增家人」「新增祭祀資料」逐一加入。
        </p>
        <div>
          <label className={labelClass}>家戶編號</label>
          <input
            className={inputClass}
            value={householdCode}
            onChange={(e) => setHouseholdCode(e.target.value)}
            placeholder="例如 F00021"
            autoFocus
          />
          <p className="mt-1 text-xs text-ink-faint">建立前會檢查是否與其他家戶重複，重複時不會建立。</p>
        </div>
        <div>
          <label className={labelClass}>戶名</label>
          <input className={inputClass} value={householdName} onChange={(e) => setHouseholdName(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>主要聯絡人</label>
          <input className={inputClass} value={primaryContact} onChange={(e) => setPrimaryContact(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>電話</label>
          <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>手機</label>
          <input className={inputClass} value={mobile} onChange={(e) => setMobile(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>地址</label>
          <input className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>公司名稱</label>
          <input className={inputClass} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>備註</label>
          <textarea className={inputClass} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && <p className={errorTextClass}>{error}</p>}

        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className={secondaryButtonClass} onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button type="submit" className={primaryButtonClass} disabled={submitting || !householdCode.trim()}>
            {submitting ? "建立中…" : "建立家戶"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
