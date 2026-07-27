"use client";

import { useState } from "react";
import HouseholdUniversalSalvationPicker from "./HouseholdUniversalSalvationPicker";

/**
 * V15R6：開啟「整戶中元普渡・多人多項目報名」picker 的按鈕（家戶詳情入口）。
 * 送出走既有 /api/registrations/batch，不建第二套報名架構。
 */
export default function HouseholdUniversalSalvationButton({
  householdId,
  label = "🕯️ 中元普渡・整戶報名",
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
          "inline-flex min-h-11 items-center gap-1 rounded-full bg-sage-100 px-4 py-2 text-sm text-ink transition hover:bg-sage-200"
        }
      >
        {label}
      </button>
      {open && <HouseholdUniversalSalvationPicker householdId={householdId} onClose={() => setOpen(false)} />}
    </>
  );
}
