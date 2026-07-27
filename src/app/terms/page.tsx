import Link from "next/link";

/**
 * 使用條款（公開頁，免登入）。
 * 供 Google OAuth 同意畫面／驗證引用；說明本系統之使用範圍、使用者責任與服務性質。
 */
export const metadata = {
  title: "使用條款｜台北三玄宮 ERP",
  description: "台北三玄宮 ERP 行政系統使用條款。",
};

const UPDATED = "民國 115 年 7 月";

export default function TermsOfServicePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-ink">
      <h1 className="text-2xl font-medium">使用條款</h1>
      <p className="mt-1 text-sm text-ink-soft">最後更新：{UPDATED}</p>

      <section className="mt-6 flex flex-col gap-5 text-sm leading-relaxed">
        <p>
          台北三玄宮 ERP（以下稱「本系統」）為台北三玄宮內部使用之行政管理系統。
          使用本系統即表示您同意遵守本使用條款。
        </p>

        <div>
          <h2 className="text-base font-medium">一、使用資格</h2>
          <p className="mt-1 text-ink-soft">
            本系統僅供台北三玄宮授權之管理與行政人員使用，須以本宮核發的帳號登入，
            不對外開放公眾註冊或使用。
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium">二、使用範圍</h2>
          <p className="mt-1 text-ink-soft">
            本系統提供信眾與家戶管理、活動與法會報名、收款與收據、財務記帳與報表、
            列印作業，以及資料備份等宮務行政功能。使用者應僅為執行宮務行政之目的使用
            本系統。
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium">三、使用者責任</h2>
          <p className="mt-1 text-ink-soft">
            使用者應妥善保管登入帳號與密碼，不得將帳號提供他人使用；應依授權角色範圍
            操作，不得擅自存取、外洩或不當使用系統內的信眾、財務等資料。使用者於系統
            內的操作將留存稽核紀錄。
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium">四、資料備份與 Google Drive</h2>
          <p className="mt-1 text-ink-soft">
            本系統的 Google Drive 備份功能僅存取由本系統建立的備份檔案（<code>drive.file</code>
            {" "}權限範圍）。相關資料處理方式詳見
            {" "}
            <Link href="/privacy" className="underline">隱私權政策</Link>。
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium">五、服務性質與免責</h2>
          <p className="mt-1 text-ink-soft">
            本系統為本宮內部行政工具，依現狀（as-is）提供。本宮將盡力維持系統正常運作與
            資料安全，但不對因不可抗力、網路或第三方服務中斷所造成的資料或作業影響負擔
            額外責任。本宮得視需要調整、維護或更新系統功能。
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium">六、聯絡方式</h2>
          <p className="mt-1 text-ink-soft">
            如對本條款有任何疑問，請聯絡台北三玄宮管理單位。
          </p>
        </div>
      </section>

      <div className="mt-8 flex gap-4 text-sm text-ink-faint">
        <Link href="/privacy" className="underline-offset-4 hover:underline">隱私權政策</Link>
        <Link href="/login" className="underline-offset-4 hover:underline">返回登入</Link>
      </div>
    </main>
  );
}
