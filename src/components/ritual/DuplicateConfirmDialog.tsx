"use client";

import Modal from "@/components/Modal";
import { primaryButtonClass, secondaryButtonClass } from "@/components/household/formStyles";

type Props = {
  displayName: string;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * V3.2「大量登記優化」——重複提醒：本年度已經有同名的登記項目時，
 * 新增前先跳出這個提示，避免手誤重複建立；行政人員確認要繼續才會真的新增。
 */
export default function DuplicateConfirmDialog({ displayName, onCancel, onConfirm }: Props) {
  return (
    <Modal title="重複提醒" onClose={onCancel}>
      <p className="text-sm text-ink">
        本年度已存在：
        <br />
        <span className="font-medium">{displayName}</span>
      </p>
      <p className="mt-3 text-sm text-ink-soft">是否仍要新增？</p>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className={secondaryButtonClass} onClick={onCancel} autoFocus>
          取消
        </button>
        <button type="button" className={primaryButtonClass} onClick={onConfirm}>
          是，仍要新增
        </button>
      </div>
    </Modal>
  );
}
