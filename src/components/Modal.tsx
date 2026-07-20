"use client";

import { ReactNode } from "react";

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/** 共用的彈出視窗外框，之後所有表單彈窗都用這個，樣式只需要改一個地方。 */
export default function Modal({ title, onClose, children }: ModalProps) {
  return (
    // V12.3 指令九：Modal 在手機不可超出畫面。
    // - 外框改用 items-end（手機從底部貼齊，拇指好操作）、sm 以上才置中
    // - 高度改用 dvh：iOS Safari 網址列會伸縮，vh 會算錯導致底部按鈕被切掉
    // - 內距在手機縮小，避免內容被擠到需要水平捲動
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/20 px-2 py-2 backdrop-blur-sm
                 sm:items-center sm:px-4 sm:py-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-3xl bg-cream-50
                   p-5 shadow-pop sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-medium text-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="min-h-11 min-w-11 rounded-full px-2 py-1 text-ink-faint transition hover:bg-cream-200 hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
