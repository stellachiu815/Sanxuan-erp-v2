import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * V8.0「資料版本紀錄」核心邏輯。
 *
 * 設計原則（對應需求「四、資料版本紀錄」）：
 * 1. entityType/entityId 是通用格式，不是外鍵——這樣同一套機制可以套用在
 *    任何資料表上，之後年度燈/收款/支出等模組上線時，只需要在該模組的
 *    建立/修改/刪除邏輯裡呼叫這裡的函式，不需要重新設計版本紀錄的資料表。
 * 2. 每一筆版本紀錄都保留「修改前」「修改後」的完整快照（JSON），不是只記錄
 *    被改了哪個欄位——這樣「回復到指定版本」才能直接套用，不用重新拼欄位。
 * 3. ⚠️ operatorName 是自由文字欄位：系統目前沒有登入/session 機制
 *    （src/lib/permissions.ts 的 getCurrentUser() 目前固定回傳 null），
 *    沒有辦法保證「操作人」的真實性，暫時由前端表單自行輸入姓名。
 *    等系統做出登入/session 機制後，這裡應該改成從 session 讀出真正的
 *    User，記錄真實且不可竄改的操作者身份。
 */

// V11.1「全宮共用收據中心」新增 PRINT/VOID/REISSUE 三個值（純附加，跟
// schema.prisma RecordVersionAction enum 的擴充同步，既有 CREATE/UPDATE/
// DELETE/RESTORE/PURGE 語意完全不變，見該 enum 上方註解）。
export type RecordVersionActionValue = "CREATE" | "UPDATE" | "DELETE" | "RESTORE" | "PURGE" | "PRINT" | "VOID" | "REISSUE";

/** 把 Prisma 查詢結果轉成可以安全存進 Json 欄位的純資料（Decimal/Date 轉字串）。 */
export function toJsonSnapshot<T>(data: T): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(data, (_key, value) => {
      // Prisma.Decimal 有 toJSON()，JSON.stringify 預設會呼叫到，這裡明確處理
      // 是為了避免依賴這個隱含行為；Date 也明確轉成 ISO 字串，避免時區疑慮。
      if (value && typeof value === "object" && typeof value.toJSON === "function") {
        return value.toJSON();
      }
      return value;
    })
  );
}

export type RecordVersionInput = {
  entityType: string;
  entityId: string;
  action: RecordVersionActionValue;
  beforeData?: unknown;
  afterData?: unknown;
  operatorName?: string | null;
  changeNote?: string | null;
};

/** 寫入一筆版本紀錄。呼叫端負責在同一個資料庫交易（transaction）裡跟實際的
 *  資料異動一起送出，確保「改了資料」跟「留下紀錄」不會其中一邊失敗。 */
export async function recordVersion(
  input: RecordVersionInput,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  await tx.recordVersion.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      beforeData:
        input.beforeData === undefined ? undefined : toJsonSnapshot(input.beforeData),
      afterData: input.afterData === undefined ? undefined : toJsonSnapshot(input.afterData),
      operatorName: input.operatorName?.trim() || null,
      changeNote: input.changeNote?.trim() || null,
    },
  });
}

export type RecordVersionView = {
  id: string;
  entityType: string;
  entityId: string;
  action: RecordVersionActionValue;
  beforeData: unknown;
  afterData: unknown;
  operatorName: string | null;
  changeNote: string | null;
  createdAt: Date;
};

/** 查詢某一筆資料的完整修改歷史，由新到舊排序。 */
export async function getVersionHistory(
  entityType: string,
  entityId: string
): Promise<RecordVersionView[]> {
  const rows = await prisma.recordVersion.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    action: r.action,
    beforeData: r.beforeData,
    afterData: r.afterData,
    operatorName: r.operatorName,
    changeNote: r.changeNote,
    createdAt: r.createdAt,
  }));
}
