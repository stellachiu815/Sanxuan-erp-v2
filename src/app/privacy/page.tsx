import Link from "next/link";

/**
 * 隱私權政策（公開頁，免登入）。
 * 供 Google OAuth 同意畫面／驗證引用；說明本系統如何蒐集、使用與保護資料，
 * 以及對 Google 使用者資料（Google Drive 備份授權）的處理方式。
 */
export const metadata = {
  title: "隱私權政策｜台北三玄宮 ERP",
  description: "台北三玄宮 ERP 行政系統隱私權政策。",
};

const UPDATED = "民國 115 年 7 月";

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-ink">
      <h1 className="text-2xl font-medium">隱私權政策</h1>
      <p className="mt-1 text-sm text-ink-soft">最後更新：{UPDATED}</p>

      <section className="mt-6 flex flex-col gap-5 text-sm leading-relaxed">
        <p>
          台北三玄宮 ERP（以下稱「本系統」）是台北三玄宮內部使用的行政管理系統，
          僅供本宮授權之管理與行政人員登入使用，不對外開放註冊。本政策說明本系統
          蒐集、使用與保護資料的方式。
        </p>

        <div>
          <h2 className="text-base font-medium">一、蒐集的資料</h2>
          <p className="mt-1 text-ink-soft">
            為辦理宮廟行政作業，本系統會處理下列資料：信眾與家戶基本資料（姓名、
            聯絡方式、地址、生日等）、法會與活動報名資料、收款與財務紀錄、以及系統
            操作人員的登入帳號與操作紀錄。這些資料由本宮行政人員於日常作業中建立與
            維護。
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium">二、資料的使用目的</h2>
          <p className="mt-1 text-ink-soft">
            所蒐集的資料僅用於本宮的行政管理，包括信眾與家戶管理、活動與法會報名、
            收款與收據、財務記帳與報表、列印作業，以及系統安全與稽核。本系統不會將
            這些資料販售或提供給與宮務無關的第三方。
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium">三、Google 使用者資料（Google Drive 備份）</h2>
          <p className="mt-1 text-ink-soft">
            本系統提供「資料備份至 Google Drive」功能。當管理員以 Google 帳號授權後，
            本系統僅要求 <code>drive.file</code> 權限範圍，此範圍<strong>只能存取由本系統
            自己建立的備份檔案與資料夾</strong>（例如「三玄宮ERP_Backup」資料夾），
            無法讀取或變更您 Google Drive 上的其他任何檔案。
          </p>
          <p className="mt-2 text-ink-soft">
            授權後取得的 Google 更新權杖（refresh token）會以 AES-256-GCM 加密後存放於
            本系統資料庫，僅用於定期自動上傳備份檔；存取權杖（access token）不長期保存，
            每次使用時即時換發、用畢即棄。管理員可隨時於系統的【Google Drive 連線】頁面
            解除授權，或至 Google 帳號的
            {" "}
            <a href="https://myaccount.google.com/permissions" className="underline" target="_blank" rel="noopener noreferrer">
              第三方應用程式權限
            </a>
            {" "}
            頁面撤銷本系統的存取權。本系統對 Google 使用者資料的使用，符合
            {" "}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" className="underline" target="_blank" rel="noopener noreferrer">
              Google API Services User Data Policy
            </a>
            （含 Limited Use 要求）。
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium">四、資料的保護與保存</h2>
          <p className="mt-1 text-ink-soft">
            本系統採用登入帳號與角色權限控管，敏感操作均留存稽核紀錄。資料保存於本宮
            使用的雲端主機與備份空間，保存期間以宮務行政與法定需要為限。
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium">五、聯絡方式</h2>
          <p className="mt-1 text-ink-soft">
            如對本政策或資料處理方式有任何疑問，請聯絡台北三玄宮管理單位。
          </p>
        </div>
      </section>

      <div className="mt-8 flex gap-4 text-sm text-ink-faint">
        <Link href="/terms" className="underline-offset-4 hover:underline">使用條款</Link>
        <Link href="/login" className="underline-offset-4 hover:underline">返回登入</Link>
      </div>
    </main>
  );
}
