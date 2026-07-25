"use client";

import { Component, type ReactNode } from "react";

/**
 * V15R2 首頁效能／穩定性：把資訊卡（系統總覽／待列印）包在錯誤邊界內，
 * 任何一張資訊卡查詢失敗，只在資訊卡區塊顯示提示，**不影響搜尋框與快捷入口**
 * （它們在 Suspense 之外、已先串流送出）。符合「單一資訊卡失敗不阻塞主要操作」。
 */
type Props = { children: ReactNode };
type State = { hasError: boolean };

export default class DashboardErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="w-full max-w-5xl">
          <div className="rounded-3xl bg-cream-100 p-6 text-sm text-ink-soft shadow-card">
            資訊卡暫時無法載入，稍後重新整理即可；搜尋與快捷入口不受影響。
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}
