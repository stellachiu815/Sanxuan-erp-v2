"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { memberRoleOptions } from "@/lib/labels";
import { useOperator } from "@/lib/operatorClient";
import DuplicateConfirmDialog, { type DuplicateView } from "@/components/devotee/DuplicateConfirmDialog";
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
  const router = useRouter();
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

  /**
   * V12.2 最後一個缺口：這條「家戶詳情頁 → 新增家人」流程原本完全沒有疑似
   * 重複檢查，同名＋同生日會直接建立，等於可以繞過 V12.2 的重複保護。現在
   * POST /api/households/[id]/members 命中時會回 409，這裡負責顯示確認畫面。
   */
  const [duplicates, setDuplicates] = useState<DuplicateView[] | null>(null);

  /**
   * ⚠️ 用 useRef 而不是 useState，理由跟 CreateDevoteeModal 完全相同：
   * 「確認仍要建立」按鈕會在同一個 tick 內設旗標並立刻送出，setState 是
   * 非同步的，submit 會讀到舊值 false 而被自己的保險擋住。ref 是同步寫入。
   *
   * 只有「確認仍要建立」那顆按鈕會設成 true。
   */
  const duplicatesAcknowledgedRef = useRef(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await submit(false);
  }

  async function submit(confirmedDuplicates: boolean) {
    if (submitting) return;
    if (!name.trim()) {
      setError("請輸入姓名");
      return;
    }

    // 前端硬性保險：confirmedDuplicates = true 只有在使用者真的看過疑似重複
    // 清單並按下「確認仍要建立」之後才允許送出。
    const reallyConfirmed = confirmedDuplicates === true && duplicatesAcknowledgedRef.current;
    if (confirmedDuplicates && !duplicatesAcknowledgedRef.current) {
      setError("請先確認疑似重複清單後再建立");
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
      // 一律送出明確布林值；後端用 `=== true` 嚴格比較，字串會被視為未確認。
      confirmedDuplicates: reallyConfirmed === true,
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

      if (res.status === 409 && data.needsDuplicateConfirmation) {
        // 命中疑似重複：後端此時尚未寫入任何資料。顯示清單並確保旗標歸零，
        // 使用者一定要再明確按一次「確認仍要建立」才會真的建立。
        setDuplicates(data.duplicates ?? []);
        duplicatesAcknowledgedRef.current = false;
        return;
      }

      if (!res.ok) {
        setError(data.error ?? "新增失敗，請稍後再試一次。");
        return;
      }

      // 建立成功：旗標歸零，避免下次開啟時沿用上一次的確認。
      duplicatesAcknowledgedRef.current = false;
      setDuplicates(null);
      onSuccess();
      onClose();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  /** 關閉 Modal 時一律清除確認旗標與清單。 */
  function handleClose() {
    duplicatesAcknowledgedRef.current = false;
    setDuplicates(null);
    onClose();
  }

  // ---- 疑似重複確認畫面（與 CreateDevoteeModal 共用同一個元件）----
  if (duplicates) {
    return (
      <DuplicateConfirmDialog
        title="偵測到疑似重複的信眾"
        duplicates={duplicates}
        submitting={submitting}
        error={error}
        onBack={() => {
          // 返回修改＝取消這次確認，旗標必須歸零。
          setDuplicates(null);
          duplicatesAcknowledgedRef.current = false;
        }}
        onViewExisting={(memberId) => {
          duplicatesAcknowledgedRef.current = false;
          handleClose();
          router.push(`/devotee-center/${memberId}`);
        }}
        onConfirm={() => {
          // 這是唯一一個會把「已確認」旗標設成 true 的地方。
          duplicatesAcknowledgedRef.current = true;
          submit(true);
        }}
      />
    );
  }

  return (
    <Modal title="新增家人" onClose={handleClose}>
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
          <button type="button" className={secondaryButtonClass} onClick={handleClose}>
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
