import type { Metadata } from "next";
import "./globals.css";
import GlobalHomeButton from "@/components/layout/GlobalHomeButton";

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
        <div className="min-h-screen">{children}</div>
        {/* V12 指令「八」：全站一鍵回首頁，放在共用 Layout，所有頁面自動套用。 */}
        <GlobalHomeButton />
      </body>
    </html>
  );
}
