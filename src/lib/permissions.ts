/**
 * 財務模組權限定義（架構預留）。
 *
 * ⚠️ 重要：這個檔案目前只是「權限規則的定義」，還沒有真正被任何 API 或畫面呼叫，
 * 因為系統目前沒有登入/session 機制，也沒有財務模組的畫面或 API。
 *
 * 之後財務模組真的要開發時，請務必遵守：
 * 1. 每一支財務相關的 API route，第一步就要呼叫 canFinance()／assertFinancePermission()
 *    檢查權限，「不能只在前端把按鈕藏起來」——這是使用者明確要求的規則。
 * 2. 選單/畫面也要依角色隱藏財務入口（前端隱藏是「使用者體驗」，後端檢查才是「安全防線」，
 *    兩者都要做，但後端這一層絕對不能省略）。
 * 3. getCurrentUser() 目前是一個尚未實作的預留函式（見下方），開發財務模組前，
 *    必須先把系統的登入/session 機制做出來，這個函式才會真的有作用。
 */

/**
 * V11.1.1「全專案建置、權限與正式封版指令」：這個型別現在直接對應
 * prisma/schema.prisma 的 Role enum（新增 ADMIN／READONLY 兩個值，純附加，
 * 既有三個值語意不變）。之前這裡是一個跟 Prisma 完全無關、手寫的 TS
 * 型別，本輪對齊成同一組值，兩邊不會再有可能兜不起來的風險（比照
 * src/lib/recordVersion.ts RecordVersionActionValue 跟
 * schema.prisma RecordVersionAction 對齊的既有作法）。
 *
 *   SUPER_ADMIN   最高管理員：全部操作皆開放
 *   ADMIN         管理員：授權管理人員，可執行需要核准的操作（例如收據
 *                 作廢/換開/標記不需開立），但不能修改最敏感的規則類設定
 *   STAFF         一般工作人員：日常操作，不能執行需要核准的高風險操作
 *   READONLY      唯讀人員：只能查看/匯出，不能執行任何會改變資料的操作
 *   FINANCE_CLERK 財務人員（既有預留角色，尚未開放給任何使用者）
 */
export type Role = "SUPER_ADMIN" | "ADMIN" | "STAFF" | "READONLY" | "FINANCE_CLERK";

export type FinanceAction =
  | "view" // 查看列表／單筆
  | "viewFullReport" // 查看完整報表（FINANCE_CLERK 不開放）
  | "create" // 新增（草稿）
  | "update" // 修改已確認資料
  | "void" // 作廢
  | "export"; // 匯出

/**
 * 權限矩陣。依需求：
 * - SUPER_ADMIN：查看、建立、修改、作廢、匯出全部開放。
 * - STAFF（目前系統操作家戶管理的一般行政人員）：完全不開放財務功能，選單也不應顯示。
 * - FINANCE_CLERK（預留角色，尚未開放給任何使用者）：只能新增草稿；
 *   不能修改已確認資料、不能作廢、不能看完整報表、不能匯出。
 */
const FINANCE_PERMISSIONS: Record<Role, FinanceAction[]> = {
  SUPER_ADMIN: ["view", "viewFullReport", "create", "update", "void", "export"],
  // V11.1.1 新增角色：財務模組本身還沒有開發任何畫面/API，這裡先給
  // ADMIN 跟 SUPER_ADMIN 一樣的權限（沒有既有註解說這個模組要限制成
  // 「僅 SUPER_ADMIN」），READONLY 只給查看類權限，等財務模組真的開發
  // 時再依實際需求調整。
  ADMIN: ["view", "viewFullReport", "create", "update", "void", "export"],
  STAFF: [],
  READONLY: ["view"],
  FINANCE_CLERK: ["create"],
};

/** 檢查某個角色是否能做某個財務操作。 */
export function canFinance(role: Role, action: FinanceAction): boolean {
  return FINANCE_PERMISSIONS[role]?.includes(action) ?? false;
}

/**
 * 財務模組選單是否要顯示給這個角色看（目前只有 SUPER_ADMIN 看得到財務選單）。
 * 前端用這個函式決定要不要渲染財務入口，但這只是體驗優化，
 * 真正擋權限一定要靠後端 API 的 canFinance() 檢查。
 */
export function canSeeFinanceMenu(role: Role): boolean {
  return canFinance(role, "view");
}

/**
 * 之後財務 API route 的標準用法（範例，目前尚未有任何財務 API route 存在）：
 *
 *   const user = await getCurrentUser(request);
 *   if (!user || !canFinance(user.role, "create")) {
 *     return NextResponse.json({ error: "沒有權限" }, { status: 403 });
 *   }
 *
 * assertFinancePermission 把上面這段判斷包成一個函式，減少每支 API 重複寫錯的機會。
 * 回傳 null 代表通過；回傳字串代表「拒絕原因」，API 直接把它當成 403 錯誤訊息回傳。
 */
export function assertFinancePermission(
  role: Role | null | undefined,
  action: FinanceAction
): string | null {
  if (!role) return "尚未登入";
  if (!canFinance(role, action)) return "沒有權限執行這個操作";
  return null;
}

/**
 * 祭改「禁用編號清單」權限定義（V9.0 新增，架構同上方財務權限）。
 *
 * ⚠️ 需求「六」明確要求：「一般工作人員不可修改」禁用編號規則。跟上面的
 * 財務權限一樣，這裡只先定義規則，還沒辦法在後端真正擋下——系統目前沒有
 * 登入/session 機制，getCurrentUser() 永遠回傳 null。目前只能：
 * 1. 前端畫面把「新增/移除禁用編號」的入口，隱藏成只有管理者身分才看得到
 *    的設定頁（見 docs 的已知限制清單）。
 * 2. 這裡的 canPurification()／assertPurificationPermission() 先把規則寫死，
 *    等登入機制做出來，只要在 API route 呼叫 getCurrentUser() 拿到真正的
 *    角色，就可以直接接上這裡的檢查，不用重寫規則本身。
 */
export type PurificationAction = "manageBannedNumbers";

const PURIFICATION_PERMISSIONS: Record<Role, PurificationAction[]> = {
  SUPER_ADMIN: ["manageBannedNumbers"],
  // V11.1.1 新增角色：需求「六」原文只講「一般工作人員不可修改」，沒有
  // 限制只有 SUPER_ADMIN，所以 ADMIN 也給這個權限；READONLY 不給（唯讀
  // 人員本來就不能執行任何修改類操作）。
  ADMIN: ["manageBannedNumbers"],
  STAFF: [],
  READONLY: [],
  FINANCE_CLERK: [],
};

export function canPurification(role: Role, action: PurificationAction): boolean {
  return PURIFICATION_PERMISSIONS[role]?.includes(action) ?? false;
}

export function assertPurificationPermission(
  role: Role | null | undefined,
  action: PurificationAction
): string | null {
  if (!role) return "尚未登入";
  if (!canPurification(role, action)) return "沒有權限執行這個操作";
  return null;
}

/**
 * V9.1「附加列印項目與多寶袋管理機制」權限定義（架構同上方財務/祭改權限，
 * 一樣先定義規則，實際擋在 API route 前，要等登入/session 機制做出來）。
 *
 * 對應需求「十四」：
 * - SUPER_ADMIN：新增、修改（含已列印後修改）、取消、恢復、永久刪除、
 *   查看全部列印紀錄，全部開放。
 * - STAFF（管理員/櫃台，即上方 PurificationAction 註解裡「一般行政人員」
 *   的同一個角色）：可以新增額外寶袋、修改「尚未列印」的資料、列印、
 *   補印；但不能修改已經列印過的資料（modifyAfterPrint）、不能取消/恢復/
 *   永久刪除，也不能單獨新增「預設寶袋」（預設寶袋由活動精靈依規則自動
 *   建立，不是人工操作項目）。
 *
 * ⚠️ modifyBeforePrint／modifyAfterPrint 的區分，目前只能由呼叫端自行判斷
 * 「這筆項目是否已經列印過」再決定要檢查哪一個 action——canAdditionalPrintItem()
 * 本身不會去查資料庫。等登入機制做出來、真正串接到 API route 時，呼叫端
 * 應該先用 src/lib/additionalPrintItems.ts 查出項目目前的 isPrinted 狀態，
 * 再挑對應的 action 傳進來檢查。
 */
export type AdditionalPrintItemAction =
  | "create" // 建立預設寶袋（一般由活動精靈/系統規則自動建立）
  | "createExtra" // 手動新增額外寶袋
  | "modifyBeforePrint" // 修改尚未列印過的項目
  | "modifyAfterPrint" // 修改已經列印過的項目（需求「十四」：需顯示警告＋版本紀錄）
  | "cancel" // 取消
  | "restore" // 恢復已取消的項目
  | "permanentlyDelete" // 永久刪除（需求「十三」：僅 SUPER_ADMIN，且需雙重確認）
  | "viewAll" // 查看全部列印紀錄
  | "print" // 列印
  | "reprint"; // 補印

const ADDITIONAL_PRINT_ITEM_PERMISSIONS: Record<Role, AdditionalPrintItemAction[]> = {
  SUPER_ADMIN: [
    "create",
    "createExtra",
    "modifyBeforePrint",
    "modifyAfterPrint",
    "cancel",
    "restore",
    "permanentlyDelete",
    "viewAll",
    "print",
    "reprint",
  ],
  // V11.1.1 新增角色：ADMIN 給 SUPER_ADMIN 的全部權限，除了
  // permanentlyDelete——需求「十三」原文明確寫「僅 SUPER_ADMIN，且需雙重
  // 確認」，所以 ADMIN 不能永久刪除。READONLY 只給查看類權限。
  ADMIN: [
    "create",
    "createExtra",
    "modifyBeforePrint",
    "modifyAfterPrint",
    "cancel",
    "restore",
    "viewAll",
    "print",
    "reprint",
  ],
  STAFF: ["createExtra", "modifyBeforePrint", "print", "reprint"],
  READONLY: ["viewAll"],
  FINANCE_CLERK: [],
};

export function canAdditionalPrintItem(role: Role, action: AdditionalPrintItemAction): boolean {
  return ADDITIONAL_PRINT_ITEM_PERMISSIONS[role]?.includes(action) ?? false;
}

export function assertAdditionalPrintItemPermission(
  role: Role | null | undefined,
  action: AdditionalPrintItemAction
): string | null {
  if (!role) return "尚未登入";
  if (!canAdditionalPrintItem(role, action)) return "沒有權限執行這個操作";
  return null;
}

/**
 * V10.1「供品認捐中心」權限定義（架構同上方財務/祭改/附加列印項目權限，
 * 一樣先定義規則，實際擋在 API route 前，要等登入/session 機制做出來）。
 *
 * 對應需求「二十一」：
 * - SUPER_ADMIN：新增/修改供品種類、修改年度數量與價格、修改單筆價格、
 *   設定免收、取消認捐、執行退款或轉款、查看完整歷史與操作紀錄，全部開放。
 * - STAFF（管理員/櫃台）：新增認捐、選擇認捐人、登錄收款、開立收據、
 *   列印與補印、登錄爐主與副爐主；不能修改供品種類設定/年度數量與價格、
 *   不能設定免收、不能取消認捐、不能執行退款或轉款。
 */
export type OfferingAction =
  | "manageOfferingTypes" // 新增/修改/停用供品種類
  | "manageActivityOfferings" // 修改活動年度數量/價格/認捐期間/狀態
  | "createClaim" // 新增認捐
  | "modifyClaimBeforePayment" // 修改尚未收款的認捐（例如備註/預計付款日期）
  | "recordPayment" // 登錄收款、開立/補印收據
  | "waiveClaim" // 設定免收
  | "cancelClaim" // 取消認捐
  | "refundClaim" // 執行退款或轉款
  | "permanentlyDelete" // 從回收區永久刪除
  | "viewFullHistory" // 查看完整歷史與操作紀錄
  | "manageStoveMaster"; // 登錄爐主/副爐主

const OFFERING_PERMISSIONS: Record<Role, OfferingAction[]> = {
  SUPER_ADMIN: [
    "manageOfferingTypes",
    "manageActivityOfferings",
    "createClaim",
    "modifyClaimBeforePayment",
    "recordPayment",
    "waiveClaim",
    "cancelClaim",
    "refundClaim",
    "permanentlyDelete",
    "viewFullHistory",
    "manageStoveMaster",
  ],
  // V11.1.1 新增角色：這個模組沒有任何「僅 SUPER_ADMIN」的既有限定註解，
  // ADMIN 給跟 SUPER_ADMIN 一樣的權限；READONLY 只給查看類權限。
  ADMIN: [
    "manageOfferingTypes",
    "manageActivityOfferings",
    "createClaim",
    "modifyClaimBeforePayment",
    "recordPayment",
    "waiveClaim",
    "cancelClaim",
    "refundClaim",
    "permanentlyDelete",
    "viewFullHistory",
    "manageStoveMaster",
  ],
  STAFF: ["createClaim", "modifyClaimBeforePayment", "recordPayment", "manageStoveMaster"],
  READONLY: ["viewFullHistory"],
  FINANCE_CLERK: [],
};

export function canOffering(role: Role, action: OfferingAction): boolean {
  return OFFERING_PERMISSIONS[role]?.includes(action) ?? false;
}

export function assertOfferingPermission(
  role: Role | null | undefined,
  action: OfferingAction
): string | null {
  if (!role) return "尚未登入";
  if (!canOffering(role, action)) return "沒有權限執行這個操作";
  return null;
}

/**
 * 取得目前操作者（session 版本，尚未實作）。
 *
 * ⚠️ 系統目前沒有登入功能，沒有 session 可以讀，所以這個「無參數、從
 * session 讀取」的版本永遠回傳 null，維持刻意設計成「預設拒絕」。
 *
 * V11.1.1 開始，收據中心不再等待這個函式：真正的伺服器端權限檢查改用
 * `src/lib/operator.ts` 的 `resolveOperator(userId)`——由呼叫端（畫面／
 * API 呼叫）帶入使用者目前選擇的 userId，伺服器查詢既有的 User 資料表
 * 確認這個 id 真的存在且 isActive，取得真正的 role 再檢查權限。這仍然
 * 不是「登入」（沒有密碼驗證這個 id 背後是本人），但已經是比「完全沒有
 * 身分」更進一步、伺服器端真正查資料庫驗證過的機制，詳見該檔案開頭的
 * 說明與限制。之後其他模組（財務/祭改/供品認捐/附加列印項目）要做真正
 * 的後端權限檢查時，應該直接沿用同一套 resolveOperator() 機制，不要
 * 重新設計一套。
 */
export async function getCurrentUser(): Promise<{ id: string; role: Role } | null> {
  return null;
}

/**
 * V11.1「全宮共用收據中心」權限定義。
 *
 * V11.1.1「全專案建置、權限與正式封版指令」開始，這裡的規則不再只是
 * 「先定義、等之後才擋」——收據中心每一支 API route 現在都會真的呼叫
 * `src/lib/operator.ts` 的 `assertReceiptPermissionForOperator()`，查詢
 * 真實的 User 資料表拿到角色，再用下面這個矩陣檢查，未通過會回傳 403
 * 並拒絕執行（不再只是前端隱藏按鈕）。
 *
 * 對應需求「十八、收據權限」與「三、補齊『標記不需開立』權限」：
 * - SUPER_ADMIN（最高管理員）：全部操作皆開放，包含只有最高管理員能做的
 *   「管理收據號碼規則」（manageNumbering，需求「七」「二、只有最高管理
 *   員可以修改收據號碼規則/起始號碼/重設流水號設定」）。
 * - ADMIN（管理員／授權管理人員）：跟 SUPER_ADMIN 一樣可以執行需要核准的
 *   高風險操作——作廢（void）、換開（reissue）、標記不需開立
 *   （markNoReceiptRequired，需求「三」明確要求獨立於一般開立權限之外、
 *   限制授權人員操作）——但不能修改收據號碼規則（manageNumbering，需求
 *   「二」明確限定僅最高管理員）。
 * - STAFF（一般工作人員）：查看、開立（合併/分項開立，但不含標記不需
 *   開立）、列印、補印、匯出、查看異動紀錄；不能作廢、不能換開、不能
 *   標記不需開立、不能修改任何收據設定。
 * - READONLY（唯讀人員）：只能查看、匯出、查看異動紀錄，不能執行任何
 *   會改變資料的操作。
 * - FINANCE_CLERK：跟其餘模組一致，這個角色尚未開放給任何使用者，收據
 *   相關操作全部不開放。
 */
export type ReceiptAction =
  | "view" // 查看收據
  | "issue" // 開立收據（合併/分項開立，不含「標記不需開立」——見下方獨立的 markNoReceiptRequired）
  | "markNoReceiptRequired" // 標記／撤銷「不需開立」（V11.1.1 新增，需求「三」明確要求跟一般開立權限分開）
  | "print" // 列印收據（正式列印）
  | "reprint" // 補印收據
  | "void" // 作廢收據
  | "reissue" // 換開收據
  | "manageSettings" // 修改收據版型等一般設定
  | "manageNumbering" // 管理收據號碼規則（前綴/年制/位數/起訖/重編政策）——僅 SUPER_ADMIN
  | "exportData" // 匯出收據資料
  | "viewAuditLog"; // 查看收據異動紀錄

const RECEIPT_PERMISSIONS: Record<Role, ReceiptAction[]> = {
  SUPER_ADMIN: [
    "view",
    "issue",
    "markNoReceiptRequired",
    "print",
    "reprint",
    "void",
    "reissue",
    "manageSettings",
    "manageNumbering",
    "exportData",
    "viewAuditLog",
  ],
  ADMIN: [
    "view",
    "issue",
    "markNoReceiptRequired",
    "print",
    "reprint",
    "void",
    "reissue",
    "manageSettings",
    "exportData",
    "viewAuditLog",
  ],
  STAFF: ["view", "issue", "print", "reprint", "exportData", "viewAuditLog"],
  READONLY: ["view", "exportData", "viewAuditLog"],
  FINANCE_CLERK: [],
};

export function canReceipt(role: Role, action: ReceiptAction): boolean {
  return RECEIPT_PERMISSIONS[role]?.includes(action) ?? false;
}

export function assertReceiptPermission(role: Role | null | undefined, action: ReceiptAction): string | null {
  if (!role) return "尚未登入";
  if (!canReceipt(role, action)) return "沒有權限執行這個操作";
  return null;
}

/**
 * 收據作廢／換開需要的「核准人角色」檢查（對應需求「四、補齊收據作廢與
 * 換開的核准控制」：核准人必須是「授權管理人員」，不能隨便一個 STAFF/
 * READONLY 帳號就能核准）。獨立於 canReceipt() 之外，因為「核准人是否
 * 有資格核准」跟「操作人是否有權限發起這個操作」是兩個不同的檢查。
 */
export function canApproveReceiptVoidOrReissue(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

// ============================================================
// V11.2「系統管理中心 — 備份與還原中心」權限（對應指令「十四」）。
//
// 指令原文非常明確：「只有最高管理員可以：建立Backup、下載Backup、
// 還原Backup、解除Google授權、重新授權、修改排程。一般使用者：不得看到
// Backup。」——這裡刻意只開放給 SUPER_ADMIN 一個角色，跟收據中心
// 「SUPER_ADMIN／ADMIN 都可以核准」的權限設計不同，不要因為「習慣上
// ADMIN 也很高權限」就誤放寬。系統管理中心其餘子頁面（系統版本／系統
// 健康檢查／系統Log／系統設定）指令沒有明確提到權限，但因為都是系統
// 維運層級的資訊、跟備份中心/還原中心同一個主選單【系統管理】底下，
// 這裡採用「整個系統管理中心一律 SUPER_ADMIN 限定」的保守設計，避免
// 對外洩漏系統健康狀況/Log 這類維運資訊給一般人員——這是本輪的設計
// 判斷，非使用者逐字要求，如果之後要放寬（例如讓 ADMIN 也能看系統
// 健康檢查），需要另外明確確認。
// ============================================================
export type SystemAction =
  | "viewSystemCenter" // 看得到【系統管理】選單與其餘子頁面（版本/健康檢查/Log/設定）
  | "runBackup" // 建立 Backup（手動立即備份）
  | "downloadBackup" // 下載 Backup ZIP
  | "restoreBackup" // 還原 Backup（一鍵還原，覆蓋目前資料）
  | "manageGoogleDriveConnection" // 連結/解除/重新授權 Google Drive
  | "manageBackupSchedule"; // 修改備份排程與保留政策

const SYSTEM_PERMISSIONS: Record<Role, SystemAction[]> = {
  SUPER_ADMIN: [
    "viewSystemCenter",
    "runBackup",
    "downloadBackup",
    "restoreBackup",
    "manageGoogleDriveConnection",
    "manageBackupSchedule",
  ],
  ADMIN: [],
  STAFF: [],
  READONLY: [],
  FINANCE_CLERK: [],
};

export function canSystem(role: Role, action: SystemAction): boolean {
  return SYSTEM_PERMISSIONS[role]?.includes(action) ?? false;
}

// ============================================================
// V12.0「信眾關係中心」權限（對應指令「十六」）。
//
// 指令原文逐句對照：
// - SUPER_ADMIN：查看/新增/修改/標籤管理/互動紀錄管理/關懷名單管理/
//   查看完整收款與捐款統計/查看稽核紀錄——全部開放。
// - ADMIN：查看/修改一般信眾資料/新增互動紀錄/套用既有標籤/查看活動及
//   收款「摘要」——不可：管理系統權限/執行資料合併/刪除歷史財務資料/
//   查看敏感系統設定。
// - READONLY：只能查看，不得新增/修改/刪除/套用標籤/新增互動紀錄。
//
// 【本輪需要自行判斷、非逐字規定的部分，以下是設計理由，供之後檢視】
// 1. 指令把「查看完整收款與捐款統計」（SUPER_ADMIN）跟「查看活動及收款
//    摘要」（ADMIN）明確分成兩種不同深度的查看權限——這裡拆成
//    viewFullFinancialStats（SUPER_ADMIN 專屬，360 總覽的完整捐款統計/
//    歷年金額明細）與 viewFinancialSummary（ADMIN 也能看，360 總覽裡
//    活動/收款/收據等「串接摘要」）兩個獨立動作，而不是把兩者混在同一個
//    view 動作裡，這樣才能讓 API 層精確依指令原文分級。
// 2. 「標籤管理」（新增/修改/停用標籤定義本身）vs「套用既有標籤」（把
//    已存在的標籤加到某位信眾身上）是兩個不同動作——指令對 SUPER_ADMIN
//    只寫「標籤管理」，對 ADMIN 只寫「套用既有標籤」，代表這兩者本來就
//    是分開的權限顆粒度，這裡拆成 manageTags（僅 SUPER_ADMIN）與
//    applyTag（SUPER_ADMIN + ADMIN）。
// 3. 「互動紀錄管理」（SUPER_ADMIN，可修改/軟刪除任何互動紀錄）vs「新增
//    互動紀錄」（ADMIN，只能新增，不能修改或刪除別人建立的紀錄）同理拆成
//    manageInteractions／createInteraction 兩個動作。
// 4. 「關懷名單管理」（正式標記/取消關懷狀態）指令只列在 SUPER_ADMIN 底下，
//    ADMIN 清單沒有提到，所以 manageCareList 僅 SUPER_ADMIN；ADMIN 仍然
//    可以透過 view 看到系統建議的關懷名單，只是不能「正式標記」。
// 5. 「執行資料合併」（mergeDevotees）：指令「十三」本身明確規定本次合併
//    功能先不開放（僅列出疑似重複，不自動合併），這裡定義這個動作只是
//    為了讓權限矩陣跟指令逐字對照時清楚列出「這件事目前沒有任何角色可以
//    做」，不代表系統有任何一支 API 真的執行合併——沒有合併 API，這個
//    action 純粹是文件性質的佔位，供 getFullPermissionSnapshot() 顯示。
// 6. 「刪除歷史財務資料」：信眾關係中心本身沒有任何刪除 PaymentTransaction/
//    Receipt 等既有財務資料的功能（全部是唯讀串接既有模組資料，見指令
//    「二十」不得修改既有財務計算邏輯），所以不需要定義對應的 action——
//    這個限制是靠「根本沒有提供刪除財務資料的 API」達成，不是靠權限矩陣
//    擋下來的，比擋權限更安全（沒有入口，不會有漏擋的風險）。
// 7. READONLY 對「查看活動及收款摘要」是否等同 ADMIN 的層級：指令原文只
//    寫「只能查看」，沒有進一步區分深度，這裡讓 READONLY 也擁有
//    viewFinancialSummary（跟 ADMIN 同一層級的查看深度），但不給
//    viewFullFinancialStats（SUPER_ADMIN 專屬的完整捐款統計）與
//    viewAuditLog（稽核紀錄，指令只提到 SUPER_ADMIN），這是本輪的設計
//    判斷，非使用者逐字要求，如果之後要調整需要另外確認。
// ============================================================
export type DevoteeAction =
  | "view" // 查看信眾名單/360總覽基本資料/首頁統計/全宮搜尋/疑似重複列表/需要關懷建議名單
  | "viewFinancialSummary" // 查看活動及收款「摘要」（ADMIN 可）
  | "viewFullFinancialStats" // 查看完整收款與捐款統計（SUPER_ADMIN 專屬）
  | "viewAuditLog" // 查看信眾關係中心的資料異動稽核紀錄（SUPER_ADMIN 專屬）
  | "createProfile" // 新增信眾延伸資料（SUPER_ADMIN）
  | "updateProfile" // 修改信眾延伸資料（SUPER_ADMIN 全部欄位；ADMIN 僅一般信眾資料，欄位層級限制見 API 層註解）
  | "manageTags" // 標籤管理：新增/修改/停用標籤定義本身（SUPER_ADMIN 專屬）
  | "applyTag" // 套用/移除既有標籤到信眾身上（SUPER_ADMIN + ADMIN）
  | "createInteraction" // 新增互動紀錄（SUPER_ADMIN + ADMIN）
  | "manageInteractions" // 修改/軟刪除互動紀錄（SUPER_ADMIN 專屬）
  | "manageCareList" // 正式標記/取消關懷狀態（SUPER_ADMIN 專屬）
  | "mergeDevotees"; // 執行疑似重複信眾合併——指令明確規定本次不開放，見上方說明 6，目前沒有任何角色擁有、也沒有對應 API

const DEVOTEE_PERMISSIONS: Record<Role, DevoteeAction[]> = {
  SUPER_ADMIN: [
    "view",
    "viewFinancialSummary",
    "viewFullFinancialStats",
    "viewAuditLog",
    "createProfile",
    "updateProfile",
    "manageTags",
    "applyTag",
    "createInteraction",
    "manageInteractions",
    "manageCareList",
  ],
  ADMIN: ["view", "viewFinancialSummary", "updateProfile", "applyTag", "createInteraction"],
  STAFF: [], // 指令「十六」沒有提到 STAFF，比照既有系統管理中心慣例（未提及角色一律不開放），信眾關係中心選單/資料一律不顯示給 STAFF
  READONLY: ["view", "viewFinancialSummary"],
  FINANCE_CLERK: [],
};

export function canDevotee(role: Role, action: DevoteeAction): boolean {
  return DEVOTEE_PERMISSIONS[role]?.includes(action) ?? false;
}

export function assertDevoteePermission(role: Role | null | undefined, action: DevoteeAction): string | null {
  if (!role) return "尚未登入";
  if (!canDevotee(role, action)) return "沒有權限執行這個操作";
  return null;
}

/**
 * 信眾關係中心選單是否顯示給這個角色看（前端體驗優化，後端仍然一律用
 * canDevotee() 重新查驗，不信任前端隱藏按鈕）。
 */
export function canSeeDevoteeMenu(role: Role): boolean {
  return canDevotee(role, "view");
}

/**
 * 完整權限矩陣快照（V11.2 新增，供備份中心的「權限」快照使用，見
 * src/lib/backup.ts）。不直接匯出各模組內部的私有常數（例如
 * RECEIPT_PERMISSIONS），而是即時呼叫每個模組已經匯出的 can*() 純函式
 * 組出完整矩陣——這樣不需要在這裡重複維護一份「有哪些角色/有哪些動作」
 * 的清單跟各模組本體兜不起來，之後任何模組新增角色/動作，這裡會自動
 * 反映最新結果。
 *
 * 這份快照純粹是「備份當下的權限規則存證」，不是可以拿來即時判斷權限的
 * 機制——真正的權限判斷永遠是即時呼叫 canReceipt()/canSystem() 等函式，
 * 不要去讀備份檔案裡的這份快照做判斷。
 */
export function getFullPermissionSnapshot() {
  const roles: Role[] = ["SUPER_ADMIN", "ADMIN", "STAFF", "READONLY", "FINANCE_CLERK"];
  const financeActions: FinanceAction[] = ["view", "viewFullReport", "create", "update", "void", "export"];
  const purificationActions: PurificationAction[] = ["manageBannedNumbers"];
  const additionalPrintItemActions: AdditionalPrintItemAction[] = [
    "create",
    "createExtra",
    "modifyBeforePrint",
    "modifyAfterPrint",
    "cancel",
    "restore",
    "permanentlyDelete",
    "viewAll",
    "print",
    "reprint",
  ];
  const offeringActions: OfferingAction[] = [
    "manageOfferingTypes",
    "manageActivityOfferings",
    "createClaim",
    "modifyClaimBeforePayment",
    "recordPayment",
    "waiveClaim",
    "cancelClaim",
    "refundClaim",
    "permanentlyDelete",
    "viewFullHistory",
    "manageStoveMaster",
  ];
  const receiptActions: ReceiptAction[] = [
    "view",
    "issue",
    "markNoReceiptRequired",
    "print",
    "reprint",
    "void",
    "reissue",
    "manageSettings",
    "manageNumbering",
    "exportData",
    "viewAuditLog",
  ];
  const systemActions: SystemAction[] = [
    "viewSystemCenter",
    "runBackup",
    "downloadBackup",
    "restoreBackup",
    "manageGoogleDriveConnection",
    "manageBackupSchedule",
  ];
  const devoteeActions: DevoteeAction[] = [
    "view",
    "viewFinancialSummary",
    "viewFullFinancialStats",
    "viewAuditLog",
    "createProfile",
    "updateProfile",
    "manageTags",
    "applyTag",
    "createInteraction",
    "manageInteractions",
    "manageCareList",
    "mergeDevotees",
  ];

  return {
    generatedAt: new Date().toISOString(),
    finance: Object.fromEntries(roles.map((r) => [r, financeActions.filter((a) => canFinance(r, a))])),
    purification: Object.fromEntries(roles.map((r) => [r, purificationActions.filter((a) => canPurification(r, a))])),
    additionalPrintItem: Object.fromEntries(
      roles.map((r) => [r, additionalPrintItemActions.filter((a) => canAdditionalPrintItem(r, a))])
    ),
    offering: Object.fromEntries(roles.map((r) => [r, offeringActions.filter((a) => canOffering(r, a))])),
    receipt: Object.fromEntries(roles.map((r) => [r, receiptActions.filter((a) => canReceipt(r, a))])),
    system: Object.fromEntries(roles.map((r) => [r, systemActions.filter((a) => canSystem(r, a))])),
    devotee: Object.fromEntries(roles.map((r) => [r, devoteeActions.filter((a) => canDevotee(r, a))])),
    approveReceiptVoidOrReissue: Object.fromEntries(roles.map((r) => [r, canApproveReceiptVoidOrReissue(r)])),
  };
}
