import { redirect } from "next/navigation";

/**
 * V12.1「家戶管理中心」驗收修正輪：使用者明確反饋「不要重新建立頁面」，
 * 家戶管理（新增家戶／指定戶長／合併／拆分／轉移／封存）這次直接整合進
 * 既有「信眾名單」頁面（src/app/devotee-center/list/page.tsx），不是另一
 * 個獨立頁面。這個路由保留下來只是為了不讓任何已經存在的書籤或連結變成
 * 死連結，直接導向真正的入口，本身不再有任何獨立的搜尋／列表邏輯，避免
 * 跟信眾名單維護兩套重複的家戶搜尋。
 */
export default function HouseholdsPage() {
  redirect("/devotee-center/list");
}
