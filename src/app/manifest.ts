import type { MetadataRoute } from "next";

/**
 * V38 PWA「加到主畫面」設定（Web App Manifest）。
 * 讓 iOS/iPadOS（Safari）、Android（Chrome）、Mac（Chrome/Edge/Safari）都能把本系統
 * 加成獨立圖示、全螢幕開啟（standalone），不必再貼網址。圖示用三玄宮 Logo。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "台北三玄宮行政系統",
    short_name: "三玄宮",
    description: "台北三玄宮行政系統（ERP）",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#8a1f1f",
    lang: "zh-TW",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
