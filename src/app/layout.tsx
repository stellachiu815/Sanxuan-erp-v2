import type { Metadata } from "next";
import "./globals.css";

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
      </body>
    </html>
  );
}
