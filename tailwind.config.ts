import type { Config } from "tailwindcss";

// 台北三玄宮 ERP — 莫蘭迪 / 日系柔和配色
// 原則：不使用大面積純黑、純白、高飽和色。長時間使用不刺眼。
const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: {
          DEFAULT: "#FAF6EE",
          50: "#FDFBF6",
          100: "#FAF6EE",
          150: "#F7F1E5", // 中間色（V40：卡片靜態色，比 100 深比 200 淺）
          200: "#F3ECDC",
          300: "#EAE0C8",
        },
        yolk: {
          // 淡鵝黃
          50: "#FBF6E8",
          75: "#F8F0D9", // 中間色
          100: "#F5E9C9",
          200: "#EEDCA8",
          300: "#E3C97E",
        },
        blossom: {
          // 淡粉
          50: "#FBF1F1",
          75: "#F7E8E8", // 中間色
          100: "#F3DEDE",
          200: "#E9C9CB",
          300: "#DBACAF",
        },
        mist: {
          // 淡藍
          50: "#F1F6F7",
          75: "#E7EFF2", // 中間色
          100: "#DCE8EC",
          200: "#C3D8DE",
          300: "#A3C1C9",
        },
        sage: {
          // 淡綠
          50: "#F2F6F1",
          75: "#E8EFE6", // 中間色
          100: "#DEE8DA",
          200: "#C7D8C0",
          300: "#AAC3A0",
        },
        lilac: {
          // 淡紫（V40 首頁色彩分區新增）
          50: "#F5F2F8",
          75: "#EEE9F4", // 中間色
          100: "#E7E0F0",
          200: "#D5C9E4",
          300: "#BCA9D2",
        },
        apricot: {
          // 淡蜜桃（V40 首頁色彩分區新增）
          50: "#FBF2EC",
          75: "#F8E9DE", // 中間色
          100: "#F5DFD0",
          200: "#EDC9B2",
          300: "#DEAD8C",
        },
        ink: {
          // 文字色（非純黑）
          DEFAULT: "#4A4642",
          soft: "#726C65",
          faint: "#9C968D",
        },
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.5rem",
        "3xl": "2rem",
      },
      boxShadow: {
        soft: "0 2px 12px 0 rgba(74, 70, 66, 0.06)",
        card: "0 4px 20px 0 rgba(74, 70, 66, 0.08)",
        pop: "0 8px 30px 0 rgba(74, 70, 66, 0.12)",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"PingFang TC"',
          '"Hiragino Sans"',
          '"Noto Sans TC"',
          '"Microsoft JhengHei"',
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
