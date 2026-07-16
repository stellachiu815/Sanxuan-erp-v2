"use client";

import { useState } from "react";
import BirthdayField, { createEmptyBirthdayValue, type BirthdayValue } from "@/components/birthday/BirthdayField";

/**
 * 生日與農曆中心的實際換算工具（V5.0 新增）。
 *
 * 這裡只是把共用的 BirthdayField 元件放進一個獨立頁面使用，不寫入任何資料、
 * 不綁定家戶或成員——純粹的查詢/換算工具。allowNone=false，因為這個頁面
 * 本來就是為了查換算結果才打開的，不需要「先不填」選項。
 */
export default function BirthdayCenterClient() {
  const [birthday, setBirthday] = useState<BirthdayValue>(() => ({
    ...createEmptyBirthdayValue(),
    birthdayType: "solar",
  }));

  return <BirthdayField value={birthday} onChange={setBirthday} allowNone={false} />;
}
