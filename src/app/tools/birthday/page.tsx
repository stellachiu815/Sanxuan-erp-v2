import Link from "next/link";
import BirthdayCenterClient from "./BirthdayCenterClient";

export const metadata = {
  title: "生日與農曆中心｜台北三玄宮行政系統",
};

/**
 * 生日與農曆中心（V5.0 新增）。
 *
 * 獨立的生日換算工具頁面，不綁定任何特定家戶／成員：行政人員接電話時如果
 * 信眾只報農曆生日、或只記得生肖，都可以直接在這裡查換算結果，不用先開一筆
 * 家戶資料。實際換算元件（含國曆/農曆輸入、生肖候選年查詢）跟「新增家人」
 * 用的是同一個 BirthdayField 元件（src/components/birthday/），共用同一套
 * 換算邏輯，不重複寫。
 */
export default function BirthdayCenterPage() {
  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <Link href="/" className="text-sm text-ink-soft transition hover:text-ink">
            ← 返回首頁
          </Link>
        </div>

        <div>
          <h1 className="text-2xl font-medium text-ink">🎂 生日與農曆中心</h1>
          <p className="mt-1 text-sm text-ink-faint">
            輸入國曆或農曆生日，即時換算生肖、實歲、虛歲；只記得生肖也可以查詢候選出生年。
          </p>
        </div>

        <section className="rounded-3xl bg-white/70 p-8 shadow-card">
          <BirthdayCenterClient />
        </section>
      </div>
    </div>
  );
}
