import BackButton from "@/components/navigation/BackButton";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import SystemCenterGate from "@/components/system-center/SystemCenterGate";
import DevoteeImportWizard from "@/components/system-center/DevoteeImportWizard";

/**
 * V11.3「信眾資料匯入預檢中心」頁面（需求：入口必須放在系統管理中心）。
 *
 * 跟系統管理中心其餘子頁面（備份／還原／設定…）同一種頁面結構：
 * Server Component 只負責外框，實際內容全部是「先看操作人員身分，才透過
 * API 抓資料」的 Client Component（DevoteeImportWizard），避免還沒選操作
 * 人員的瀏覽器就能在 HTML 原始碼看到任何匯入資料。
 */
export default function DevoteeDataImportPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <BackButton fallbackHref="/system-center" />
          <h1 className="text-sm text-ink-soft">📥 信眾資料匯入</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-medium text-ink">正式資料匯入預檢中心</h2>
          <div className="flex flex-col gap-2 text-sm text-ink-faint">
            <p>
              <span className="font-medium text-ink-soft">正式家戶檔（一列一戶，固定七欄）：</span>
              家戶編號｜戶名｜主要聯絡人｜地址｜歷代祖先｜乙位正魂｜家戶成員。其中「家戶成員／
              歷代祖先／乙位正魂」同一格內可有多筆，逗號（半形 , 全形 ，）、頓號（、）或換行皆可，
              空白代表沒有資料。家戶成員→建立／更新信眾（Member）；歷代祖先／乙位正魂→建立永久牌位
              （WorshipRecord），不會被誤建成在世信眾。
            </p>
            <p>
              <span className="font-medium text-ink-soft">正式信眾檔（一列一人，可與家戶檔一起上傳）：</span>
              姓名｜性別｜國曆生日｜農曆生日｜年齡｜生肖｜身份｜聯絡電話｜通訊地址。依「家戶編號＋姓名／
              姓名＋地址／姓名＋生日」等既有保守規則比對，補足家戶成員的詳細欄位（含身份→成員角色）。
              年齡僅供參考，系統仍以生日與活動年度計算實際年齡／虛歲。
            </p>
            <p>
              家戶編號已存在時更新戶名／主要聯絡人／地址；成員依姓名比對，已存在者只補空白欄位、
              不覆蓋、不刪除、不重複建立；無法確定者列「待確認」。正式檔可直接上傳預檢，全程單一交易，
              任何失敗整批取消、不會半成功。
            </p>
          </div>
        </div>

        <OperatorProvider>
          <OperatorBar />
          {/* V12 指令「九」：ADMIN「可匯入」，這裡改成檢查 manageDataImport
              （SUPER_ADMIN／ADMIN 皆可），不再是只有 SUPER_ADMIN 能看到的
              viewSystemCenter，見 SystemCenterGate 與 permissions.ts 的說明。 */}
          <SystemCenterGate action="manageDataImport">
            <DevoteeImportWizard />
          </SystemCenterGate>
        </OperatorProvider>
      </main>
    </div>
  );
}
