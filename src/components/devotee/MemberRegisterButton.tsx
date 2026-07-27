"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import NewActivityRegistrationDialog from "./NewActivityRegistrationDialog";

/**
 * V15R5（P0 回歸）：家戶成員卡片的「報名活動」入口。
 *
 * 直接沿用**與信眾詳情頁完全相同**的 NewActivityRegistrationDialog（同一套
 * 多人多項目報名流程、同一 /api/registrations/batch 後端），只是把該成員的
 * memberId 傳進去——不建立第二套流程。支援年度燈（光明燈／太歲燈／全家燈／
 * 祭改）、普渡、宮慶等所有以 RegistrationItemType 定義的活動項目。
 */
export default function MemberRegisterButton({
  memberId,
  initialActivityType,
  initialYear,
}: {
  memberId: string;
  /** V17.4：由「活動報名」流程帶進家戶頁的活動上下文——點此成員報名時直接預選對應活動與年度。 */
  initialActivityType?: string | null;
  initialYear?: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-9 items-center gap-1 rounded-full bg-yolk-100 px-3 py-1.5 text-xs text-ink transition hover:bg-yolk-200"
      >
        📝 報名活動
      </button>
      {open && (
        <NewActivityRegistrationDialog
          memberId={memberId}
          initialActivityType={initialActivityType}
          initialYear={initialYear}
          onClose={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
