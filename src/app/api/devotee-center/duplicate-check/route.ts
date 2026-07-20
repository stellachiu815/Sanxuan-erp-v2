import { NextRequest, NextResponse } from "next/server";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { findPreCreateDuplicates } from "@/lib/devoteeDuplicates";
import { parseSolarDateString } from "@/lib/lunar";

/**
 * V12.4「信眾中心」指令三：建立信眾時的**即時**疑似重複提示。
 *
 * POST /api/devotee-center/duplicate-check
 * body: { operatorUserId, name, mobile?, phone?, address?, birthdayType?, solarBirthDate?, lunar… }
 *
 * ⚠️ 這不是第二套重複比對邏輯：實際比對完全交給既有的
 * findPreCreateDuplicates()（其內部使用既有的 findDuplicateMatches() 三條規則
 * 與 buildBirthdayKey() 日期正規化）。這支 route 只是提供一個「還沒送出、
 * 邊打字就能查」的唯讀入口，讓行政人員在輸入當下就看到「已有相似信眾」。
 *
 * 與送出時的 409 檢查的關係：
 *   - 這支是**提示**：唯讀、不寫入、不阻擋、可以完全忽略。
 *   - POST /api/devotee-center/create 送出時仍會再檢查一次並回 409，
 *     那才是真正的把關（避免有人繞過前端直接呼叫 create）。
 *   兩者共用同一份比對實作，不會出現「打字時說沒有、送出卻被擋」的矛盾。
 *
 * 權限：沿用既有 DevoteeAction "view"（唯讀查詢，跟信眾名單同一個動作），
 * 不新增第二套權限。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "請求格式錯誤" }, { status: 400 });
    }

    const check = await assertDevoteePermissionForOperator(body.operatorUserId, "view");
    if (!check.ok) {
      return NextResponse.json({ success: false, error: check.error }, { status: check.status });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    // 姓名太短時不查——一個字的片段會撈出大量無意義的結果，而且三條比對規則
    // 都要求姓名完全相同，片段本來就不會命中。
    if (name.length < 2) {
      return NextResponse.json({ success: true, data: { duplicates: [] } });
    }

    const asText = (v: unknown): string | null => {
      if (typeof v !== "string") return null;
      const t = v.trim();
      return t ? t : null;
    };

    // 電話比對依據：個人手機優先，其次市話——跟既有比對規則對「電話」的
    // 定義（devoteeDuplicates.ts 內 mobile || household.phone）一致。
    const phoneForMatch = asText(body.mobile) || asText(body.phone);

    let solarBirthDate: Date | null = null;
    let lunarBirthYear: number | null = null;
    let lunarBirthMonth: number | null = null;
    let lunarBirthDay: number | null = null;
    let lunarIsLeapMonth = false;

    if (body.birthdayType === "solar" && typeof body.solarBirthDate === "string") {
      solarBirthDate = parseSolarDateString(body.solarBirthDate);
    } else if (body.birthdayType === "lunar") {
      const y = Number(body.lunarBirthYear);
      const m = Number(body.lunarBirthMonth);
      const d = Number(body.lunarBirthDay);
      if (Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d)) {
        lunarBirthYear = y;
        lunarBirthMonth = m;
        lunarBirthDay = d;
        lunarIsLeapMonth = Boolean(body.lunarIsLeapMonth);
      }
    }

    const duplicates = await findPreCreateDuplicates({
      name,
      phone: phoneForMatch,
      address: asText(body.address),
      solarBirthDate,
      lunarBirthYear,
      lunarBirthMonth,
      lunarBirthDay,
      lunarIsLeapMonth,
      householdId: typeof body.householdId === "string" ? body.householdId : null,
    });

    return NextResponse.json({ success: true, data: { duplicates } });
  } catch {
    // 即時提示失敗不應該干擾建立流程——回空清單即可，送出時的 409 仍會把關。
    return NextResponse.json({ success: true, data: { duplicates: [] } });
  }
}
