import type { Metadata } from "next";
import "./globals.css";
import GlobalHomeButton from "@/components/layout/GlobalHomeButton";
import AppProviders from "@/components/layout/AppProviders";

export const metadata: Metadata = {
  title: "台北三玄宮行政系統",
  description: "台北三玄宮行政系統（ERP）",
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
