"use client";

import { useState } from "react";
import AnnualLanternHouseholdPicker from "./AnnualLanternHouseholdPicker";

/**
 * V15R4：開啟「年度燈・全戶多人報名」picker 的共用按鈕。
 * 信眾詳情／家戶詳情／年度燈活動管理三入口皆用這一顆按鈕＋同一個 picker，
 * 不建立第二套流程。三處只是把 householdId 傳進來。
 */
export default function AnnualLanternPickerButton({
  householdId,
  label = "🏮 年度燈・全戶報名",
  className,
}: {
  householdId: string;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "inline-flex min-h-11 items-center gap-1 rounded-full bg-yolk-100 px-4 py-2 text-sm text-ink transition hover:bg-yolk-200"
        }
      >
        {label}
      </button>
      {open && <AnnualLanternHouseholdPicker householdId={householdId} onClose={() => setOpen(false)} />}
    </>
  );
}
