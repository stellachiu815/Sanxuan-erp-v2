"use client";

import { useOperator } from "@/lib/operatorClient";
import LanternPrintCenter from "@/components/ritual/LanternPrintCenter";

/**
 * V39：把 OperatorProvider 內選到的操作人員，餵給年度燈列印中心。
 *
 * 舊 /lantern 頁只從網址 searchParams 拿 operatorUserId、且頁面上沒有操作人員
 * 選擇器，等於永遠拿不到人、卡在「請先於右上角選擇操作人員」。改由這個小外殼
 * 讀 useOperator()（跟列印中心首頁同一套身分機制），操作人員選了就能載入列印資料。
 */
export default function LanternPrintCenterWithOperator(props: {
  activityType: string;
  activityTypeLabel: string;
  availableYears: number[];
  defaultYear: number;
}) {
  const { operatorUserId } = useOperator();
  return <LanternPrintCenter {...props} operatorUserId={operatorUserId} />;
}
