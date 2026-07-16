"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/system/ConfirmDialog";
import Toast from "@/components/ritual/Toast";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/household/formStyles";
import {
  purificationPaymentStatusLabel,
  purificationRegistrationStatusLabel,
} from "@/lib/labels";
import RegisterEntrantModal from "./RegisterEntrantModal";
import type { PurificationYearOverviewJson } from "./types";

type Props = {
  purificationYearId: string;
  initialOverview: PurificationYearOverviewJson;
};

const GENDER_LABEL: Record<string, string> = { MALE: "男", FEMALE: "女", UNKNOWN: "未填寫" };

export default function PurificationYearScreen({ purificationYearId, initialOverview }: Props) {
  const router = useRouter();
  const [overview, setOverview] = useState(initialOverview);
  const [showRegister, setShowRegister] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [renumberStep, setRenumberStep] = useState<0 | 1 | 2>(0); // 0=不顯示 1=第一次警告 2=第二次確認
  const [renumbering, setRenumbering] = useState(false);
  const [toastMessage, setToastMessage] = useState("已完成");
  const [toastVisible, setToastVisible] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "CANCELLED" | "SUPPLEMENTARY">("ALL");
  const [paymentFilter, setPaymentFilter] = useState<"ALL" | "UNPAID" | "PARTIAL" | "PAID">("ALL");
  const [nameQuery, setNameQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);

  function showToast(message: string) {
    setToastMessage(message);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2000);
  }

  async function refreshOverview() {
    const res = await fetch(`/api/purification/years/${purificationYearId}`);
    if (res.ok) {
      const data = await res.json();
      setOverview(data);
    }
    router.refresh();
  }

  const filteredRegistrations = useMemo(() => {
    return overview.registrations.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (paymentFilter !== "ALL" && r.paymentStatus !== paymentFilter) return false;
      if (nameQuery.trim() && !r.displayName.includes(nameQuery.trim())) return false;
      return true;
    });
  }, [overview.registrations, statusFilter, paymentFilter, nameQuery]);

  async function handleCancel(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/purification/registrations/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "取消失敗");
        return;
      }
      showToast("已取消（保留原編號）");
      await refreshOverview();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setCancelTargetId(null);
    }
  }

  async function handleRenumberConfirm() {
    setRenumbering(true);
    setError(null);
    try {
      const res = await fetch(`/api/purification/years/${purificationYearId}/renumber`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "重新編號失敗");
        return;
      }
      showToast(`已重新編號（共 ${data.reassignedCount} 筆）`);
      await refreshOverview();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setRenumbering(false);
      setRenumberStep(0);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {overview.isLocked && (
        <p className="rounded-2xl bg-yolk-50 px-5 py-3 text-sm text-ink-soft">
          此年度已經開始列印，編號已鎖定；新增報名者會自動列為「補報」，接續最後編號繼續編列。
        </p>
      )}

      {overview.needsConfirmation.length > 0 && (
        <button
          type="button"
          onClick={() => setShowConfirmation((v) => !v)}
          className="rounded-2xl bg-blossom-50 px-5 py-3 text-left text-sm text-ink-soft shadow-soft transition hover:bg-blossom-100"
        >
          ⚠ 有 {overview.needsConfirmation.length} 筆資料尚未通過列印前檢查，點此{showConfirmation ? "收合" : "展開"}清單
        </button>
      )}

      {showConfirmation && (
        <ul className="flex flex-col gap-2 rounded-2xl bg-white/70 p-5 text-sm shadow-soft">
          {overview.needsConfirmation.map((item) => (
            <li key={item.registration.id} className="rounded-xl bg-cream-100 px-4 py-2.5">
              <span className="font-medium text-ink">{item.registration.displayName}</span>
              <span className="ml-2 text-xs text-ink-faint">
                {item.registration.number !== null ? `編號 ${item.registration.number}` : "尚未編號"}
              </span>
              <ul className="mt-1 list-inside list-disc text-xs text-ink-soft">
                {item.issues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={primaryButtonClass} onClick={() => setShowRegister(true)}>
          ＋ 祭改報名
        </button>
        <Link href={`/purification/${purificationYearId}/print`} className={secondaryButtonClass + " border border-cream-300"}>
          小人頭貼紙列印中心 →
        </Link>
        <button
          type="button"
          className={secondaryButtonClass + " border border-cream-300"}
          onClick={() => setRenumberStep(1)}
          disabled={overview.isLocked}
          title={overview.isLocked ? "已鎖定編號，不能重新編號" : undefined}
        >
          重新編號
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          className={inputClass + " w-auto"}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="ALL">全部狀態</option>
          {Object.entries(purificationRegistrationStatusLabel).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          className={inputClass + " w-auto"}
          value={paymentFilter}
          onChange={(e) => setPaymentFilter(e.target.value as typeof paymentFilter)}
        >
          <option value="ALL">全部收款狀態</option>
          {Object.entries(purificationPaymentStatusLabel).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input
          className={inputClass + " w-48"}
          placeholder="搜尋姓名"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
        />
        <span className="text-xs text-ink-faint">共 {filteredRegistrations.length} 筆</span>
      </div>

      {error && <p className="rounded-xl bg-blossom-50 px-4 py-2.5 text-sm text-ink-soft">{error}</p>}

      <div className="overflow-x-auto rounded-2xl bg-white/70 shadow-soft">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-cream-200 text-xs text-ink-faint">
              <th className="px-4 py-3">編號</th>
              <th className="px-4 py-3">姓名</th>
              <th className="px-4 py-3">性別</th>
              <th className="px-4 py-3">地址</th>
              <th className="px-4 py-3">收款</th>
              <th className="px-4 py-3">狀態</th>
              <th className="px-4 py-3">已列印</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredRegistrations.map((r) => (
              <tr key={r.id} className="border-b border-cream-100 last:border-0">
                <td className="px-4 py-3">{r.number ?? "—"}</td>
                <td className="px-4 py-3">{r.displayName}</td>
                <td className="px-4 py-3">{GENDER_LABEL[r.gender]}</td>
                <td className="px-4 py-3 max-w-xs truncate" title={r.address ?? ""}>
                  {r.address ?? "—"}
                </td>
                <td className="px-4 py-3">{purificationPaymentStatusLabel[r.paymentStatus]}</td>
                <td className="px-4 py-3">{purificationRegistrationStatusLabel[r.status]}</td>
                <td className="px-4 py-3">{r.isPrinted ? "是" : "否"}</td>
                <td className="px-4 py-3">
                  {r.status !== "CANCELLED" && (
                    <button
                      type="button"
                      className="text-xs text-blossom-300 underline-offset-4 hover:underline"
                      onClick={() => setCancelTargetId(r.id)}
                    >
                      取消
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filteredRegistrations.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-ink-faint">
                  沒有符合條件的資料
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showRegister && (
        <RegisterEntrantModal
          purificationYearId={purificationYearId}
          onClose={() => setShowRegister(false)}
          onRegistered={async ({ number }) => {
            setShowRegister(false);
            showToast(`報名完成，編號 ${number}`);
            await refreshOverview();
          }}
        />
      )}

      {cancelTargetId && (
        <ConfirmDialog
          title="取消祭改報名"
          message="取消後會保留原編號、狀態改為取消，不會把編號讓給其他人使用。確定要取消嗎？"
          confirmLabel="確定取消"
          danger
          onCancel={() => setCancelTargetId(null)}
          onConfirm={() => handleCancel(cancelTargetId)}
        />
      )}

      {renumberStep === 1 && (
        <ConfirmDialog
          title="重新編號（第 1 次確認）"
          message="重新編號會把目前所有有效報名者的編號，依報名時間重新排列。這個動作只能在還沒開始列印時執行，執行後無法復原到重新編號之前的編號。確定要繼續嗎？"
          confirmLabel="繼續"
          danger
          onCancel={() => setRenumberStep(0)}
          onConfirm={() => setRenumberStep(2)}
        />
      )}

      {renumberStep === 2 && (
        <ConfirmDialog
          title="重新編號（第 2 次確認）"
          message="請再次確認：這是最後一次警告，按下「確定重新編號」後會立即執行，無法復原。"
          confirmLabel={renumbering ? "執行中…" : "確定重新編號"}
          danger
          onCancel={() => setRenumberStep(0)}
          onConfirm={handleRenumberConfirm}
        />
      )}

      <Toast visible={toastVisible} message={toastMessage} />
    </div>
  );
}
