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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-cream-50 p-8 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="rounded-full px-2 py-1 text-ink-faint transition hover:bg-cream-200 hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
