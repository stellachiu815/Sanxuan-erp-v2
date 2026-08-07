import type { Metadata, Viewport } from "next";
import "./globals.css";
import GlobalHomeButton from "@/components/layout/GlobalHomeButton";
import AppProviders from "@/components/layout/AppProviders";

export const metadata: Metadata = {
  title: "台北三玄宮行政系統",
  description: "台北三玄宮行政系統（ERP）",
  // V38 PWA：manifest ＋ 圖示 ＋ iOS「加到主畫面」設定（全螢幕、App 名稱、狀態列樣式）。
  manifest: "/manifest.webmanifest",
  applicationName: "三玄宮",
  appleWebApp: {
    capable: true,
    title: "三玄宮",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#8a1f1f",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-TW">
      <body>
        {/* V14.3：全站登入者來源＋401 兜底（單一共用權限層的根） */}
        <AppProviders>
          <div className="min-h-screen">{children}</div>
          {/* V12 指令「八」：全站一鍵回首頁，放在共用 Layout，所有頁面自動套用。 */}
          <GlobalHomeButton />
        </AppProviders>
      </body>
    </html>
  );
}
