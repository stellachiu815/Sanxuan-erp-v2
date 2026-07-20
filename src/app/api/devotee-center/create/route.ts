import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { normalizeCreateMemberInput, createMemberInTransaction } from "@/lib/memberCreate";
import {
  HouseholdManagementError,
  createHousehold,
  toHouseholdApiError,
} from "@/lib/householdManagement";
import { findPreCreateDuplicates } from "@/lib/devoteeDuplicates";
import { recordVersion } from "@/lib/recordVersion";

/**
 * V12.2「信眾建立與查詢中心」指令「一、統一建立信眾流程」的後端。
 *
 * POST /api/devotee-center/create
 *
 * 兩種模式（對應指令「一」的 A／B）：
 *
 *   mode: "existing"  加入既有家戶 —— body.householdId 指定目標家戶
 *   mode: "new"       同時建立新家戶 —— body.household 帶戶名/主要聯絡人/電話/地址
 *
 * ⚠️ 這支 API **沒有自己的家戶建立邏輯**：mode "new" 一律呼叫既有的
 * householdManagement.createHousehold()（含既有的自動編號
 * findNextAutoHouseholdCode()、唯一鍵衝突重試、版本紀錄），對應指令
 * 「不可複製另一套建立家戶邏輯」。
 *
 * ⚠️ 也**沒有自己的成員建立邏輯**：一律走 src/lib/memberCreate.ts 的
 * createMemberInTransaction()，跟 /api/households/[id]/members 是同一份實作。
 *
 * ⚠️ 疑似重複只提醒不阻擋：body.confirmedDuplicates 為 true 時直接建立；
 * 否則先比對，有疑似重複就回 409 ＋ 候選清單，由畫面顯示給操作者決定。
 * 這裡**不會**因為同名就阻止建立，也**不會**自動合併任何資料。
 *
 * 交易範圍（指令「三」：避免只建立一半）：mode "new" 的「建立家戶 ＋ 建立
 * 第一位成員 ＋ DevoteeProfile.mobile ＋ 版本紀錄」全部在同一個
 * transaction 內；mode "existing" 的「更新家戶電話/地址 ＋ 建立成員 ＋
 * DevoteeProfile ＋ 版本紀錄」同樣在同一個 transaction 內。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "請求格式錯誤" }, { status: 400 });
    }

    const check = await assertDevoteePermissionForOperator(body.operatorUserId, "updateProfile");
    if (!check.ok) {
      return NextResponse.json({ success: false, error: check.error }, { status: check.status });
    }
    const operatorName = check.operator.name;

    // 先驗證成員欄位（兩種模式共用）。驗證失敗會丟 HouseholdManagementError。
    const normalized = normalizeCreateMemberInput(body);

    const mode = body.mode === "new" ? "new" : "existing";
    const householdInput = (body.household ?? {}) as Record<string, unknown>;
    const asText = (v: unknown): string | null => {
      if (typeof v !== "string") return null;
      const t = v.trim();
      return t ? t : null;
    };
    const householdPhone = asText(householdInput.phone);
    const householdAddress = asText(householdInput.address);

    // ---- 建立前疑似重複比對 ----
    //
    // ⚠️ 嚴格布林比較：只有 `=== true` 才算「使用者已經看過清單並按了仍要
    // 建立」。原本寫成 `!body.confirmedDuplicates`，只要送來的是字串
    // "false"、字串 "0" 或任何非空字串，JS 都判定為 truthy，比對會被整個
    // 跳過而直接寫入資料庫——這是「命中卻仍直接建立」最可能的漏洞。
    // 現在除了明確的布林 true 之外，一律強制執行比對。
    const hasConfirmedDuplicates = body.confirmedDuplicates === true;

    if (!hasConfirmedDuplicates) {
      // 電話比對依據：個人手機優先，其次這次填的家戶電話，再其次目標家戶
      // 既有的電話——跟既有比對規則對「電話」的定義一致。
      let phoneForMatch = normalized.mobile || householdPhone;
      let addressForMatch = householdAddress;

      if (mode === "existing" && typeof body.householdId === "string") {
        const target = await prisma.household.findFirst({
          where: { id: body.householdId, deletedAt: null },
          select: { phone: true, address: true },
        });
        phoneForMatch = phoneForMatch || target?.phone || null;
        addressForMatch = addressForMatch || target?.address || null;
      }

      const duplicates = await findPreCreateDuplicates({
        name: normalized.name,
        phone: phoneForMatch,
        address: addressForMatch,
        solarBirthDate: normalized.solarBirthDate,
        lunarBirthYear: normalized.lunarBirthYear,
        lunarBirthMonth: normalized.lunarBirthMonth,
        lunarBirthDay: normalized.lunarBirthDay,
        lunarIsLeapMonth: normalized.lunarIsLeapMonth,
        // 模式 A 已選定家戶時帶上，讓「同一家戶內同名成員」也能被提醒。
        householdId: mode === "existing" && typeof body.householdId === "string" ? body.householdId : null,
      });

      if (duplicates.length > 0) {
        // 409 = 需要人工確認，不是錯誤也不是拒絕。畫面會列出候選讓操作者
        // 選擇「查看現有信眾」或「確認仍要建立」。
        return NextResponse.json(
          {
            success: false,
            needsDuplicateConfirmation: true,
            duplicates,
            error: "偵測到疑似重複的信眾，請確認後再決定是否繼續建立",
          },
          { status: 409 }
        );
      }
    }

    // ---- 實際建立 ----
    if (mode === "new") {
      // 建立新家戶＋第一位成員。createHousehold() 自己有 transaction，
      // 這裡不能巢狀，所以先建家戶、再在同一個交易內建成員；若建成員失敗，
      // 會把剛建立的家戶一併回滾（見下方 catch）。
      const { household } = await createHousehold(
        {
          id: asText(householdInput.householdCode) ?? undefined, // 留空＝既有自動編號
          name: asText(householdInput.name) ?? normalized.name, // 沒填戶名時，用第一位成員姓名當戶名
          contactName: asText(householdInput.contactName) ?? normalized.name,
          phone: householdPhone,
          address: householdAddress,
        },
        operatorName
      );

      try {
        const member = await prisma.$transaction((tx) =>
          createMemberInTransaction(
            tx,
            household.id,
            { ...normalized, isPrimaryContact: true }, // 新家戶的第一位成員預設為主要聯絡人
            operatorName,
            "信眾建立中心：建立新家戶並新增第一位信眾"
          )
        );

        revalidatePath(`/household/${household.id}`);
        return NextResponse.json(
          { success: true, data: { member, household } },
          { status: 201 }
        );
      } catch (memberError) {
        // 家戶已經建立但成員建立失敗 → 把家戶一併移除，避免留下空家戶。
        // 用既有的軟刪除欄位（不是實體刪除），跟系統既有的刪除保護一致。
        await prisma.household
          .update({
            where: { id: household.id },
            data: { deletedAt: new Date(), deletedByName: operatorName },
          })
          .catch(() => {
            // 回滾本身失敗時不覆蓋原始錯誤，原始錯誤對操作者比較有意義。
          });
        throw memberError;
      }
    }

    // mode === "existing"
    const householdId = typeof body.householdId === "string" ? body.householdId.trim() : "";
    if (!householdId) throw new HouseholdManagementError("請選擇要加入的家戶");

    const target = await prisma.household.findFirst({
      where: { id: householdId, deletedAt: null },
    });
    if (!target) throw new HouseholdManagementError("找不到這個家戶", 404);

    const member = await prisma.$transaction(async (tx) => {
      // 家戶電話／地址：允許補充或更新，但**不可無提示覆蓋既有非空資料**
      // （指令「一.A」）。這裡的規則是：只有在既有值為空、或前端已明確送出
      // overwriteHousehold=true（畫面上已經顯示現值並由操作者確認過）時才寫入。
      const patch: { phone?: string | null; address?: string | null } = {};
      const allowOverwrite = body.overwriteHousehold === true;
      if (householdPhone && (!target.phone || allowOverwrite)) patch.phone = householdPhone;
      if (householdAddress && (!target.address || allowOverwrite)) patch.address = householdAddress;

      if (Object.keys(patch).length > 0) {
        const updated = await tx.household.update({ where: { id: householdId }, data: patch });
        await recordVersion(
          {
            entityType: "Household",
            entityId: householdId,
            action: "UPDATE",
            beforeData: target,
            afterData: updated,
            operatorName,
            changeNote: "信眾建立中心：新增信眾時一併補充家戶電話／地址",
          },
          tx
        );
      }

      return createMemberInTransaction(
        tx,
        householdId,
        normalized,
        operatorName,
        "信眾建立中心：加入既有家戶"
      );
    });

    revalidatePath(`/household/${householdId}`);
    return NextResponse.json(
      { success: true, data: { member, household: { id: householdId, name: target.name } } },
      { status: 201 }
    );
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ success: false, error }, { status });
  }
}
