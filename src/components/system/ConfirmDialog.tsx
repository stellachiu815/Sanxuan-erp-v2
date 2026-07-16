"use client";

import Modal from "@/components/Modal";
import { primaryButtonClass, secondaryButtonClass } from "@/components/household/formStyles";

type Props = {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * V8.0 新增的通用確認彈窗——回收區的「還原」「永久刪除」、版本紀錄的
 * 「回復到此版本」都用這個，取代瀏覽器原生的 window.confirm()（跟這個
 * 專案從 V3.2 起「用畫面提示取代原生 alert/confirm」的一貫風格一致）。
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "確定",
  danger = false,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="text-sm text-ink">{message}</div>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className={secondaryButtonClass} onClick={onCancel} autoFocus>
          取消
        </button>
        <button
          type="button"
          className={
            danger
              ? "rounded-full bg-blossom-200 px-5 py-2.5 text-sm text-ink transition hover:bg-blossom-300"
              : primaryButtonClass
          }
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
