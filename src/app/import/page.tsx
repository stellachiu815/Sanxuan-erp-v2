import { redirect } from "next/navigation";

/**
 * V24 正式匯入收斂：家戶匯入不再維護舊的 16 欄流程。
 *
 * 唯一正式匯入入口＝信眾資料匯入預檢中心（/system-center/data-import）：
 * 家戶檔（七欄，一列一戶）與信眾檔（九欄，一列一人）都在那裡上傳、預檢、正式匯入，
 * 沿用既有 DevoteeImportWizard 與 /api/import/devotee-precheck/*，不建立第二套。
 *
 * 舊網址 /import 一律導向新入口，避免使用者誤入第二套匯入。
 */
export default function ImportPage() {
  redirect("/system-center/data-import");
}
