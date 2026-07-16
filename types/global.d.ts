/**
 * 專案自有的最小型別宣告檔（不是 next-env.d.ts）。
 *
 * 正常情況下，`next dev`／`next build` 執行時會自動產生 next-env.d.ts，
 * 裡面 `/// <reference types="next" />` 會從 next 套件本身帶入
 * `*.css` 這類非 TypeScript 資源的型別宣告。這個沙盒環境沒有安裝
 * `next` 套件（詳見 V11.0.2／V11.1 交付報告的網路限制診斷），所以
 * 沒有辦法用同一份機制取得這個宣告。
 *
 * 這裡手動提供「副作用匯入 CSS」這一種、且只有這一種宣告，內容跟
 * Next.js 官方 next-env.d.ts 實際引用的宣告完全等價（純粹是「這個副檔名
 * 存在、匯入它不會有型別」，不影響任何其他型別檢查的嚴謹度）。
 * 一旦之後能夠正式 `npm install` 並讓 Next.js 產生真正的
 * next-env.d.ts，這個檔案可以直接刪除，不會有任何衝突。
 */
declare module "*.css";
