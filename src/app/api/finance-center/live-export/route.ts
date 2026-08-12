import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listLedger, rocYearNow, getBalances } from "@/lib/financeCenter";

/**
 * V40 財務「即時試算表」唯讀資料端點（給 Google 試算表 IMPORTDATA 接）。
 *
 * 設計重點：
 *  - 單向、唯讀：只吐出財務流水帳的 CSV，永遠不接受寫入。財務數字唯一源頭仍是 ERP，
 *    試算表只是鏡子（在試算表改東西不會回寫、下次刷新會被系統正確數字蓋回）。
 *  - 資料來源與財務中心「完全一致」：直接重用 listLedger（FinanceRecord ∪ 已完成收款），
 *    所以活動收款、感謝狀收款只要在系統「收款完成」就會自動出現，不另建第二套帳。
 *  - 權限：因為 Google 試算表的 IMPORTDATA 沒辦法帶登入身分，改用一組長亂碼 token
 *    （環境變數 FINANCE_LIVE_EXPORT_TOKEN）當通行證。網址會帶這組 token，務必保密、
 *    那份試算表也不要公開分享。沒設定 token 時端點直接關閉。
 *
 *  用法：GET /api/finance-center/live-export?token=XXXX[&year=115][&all=1]
 *   預設＝只出「當年度」（民國年），讓試算表維持精簡、不會無限長；每年自然換新的。
 *   &year=114 指定看某一年（過去年度另開分頁）；&all=1 才會出全部年度。
 */
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  OPENING: "期初",
  INCOME: "收入",
  EXPENSE: "支出",
  TRANSFER_IN: "轉入",
  TRANSFER_OUT: "轉出",
  ADJUSTMENT: "調整",
};

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// 定長比較，避免用 === 比較 token 洩漏長度／時間差資訊。
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function GET(request: NextRequest) {
  const expected = process.env.FINANCE_LIVE_EXPORT_TOKEN;
  if (!expected) {
    return new NextResponse("此功能尚未啟用：請先在 Render 設定環境變數 FINANCE_LIVE_EXPORT_TOKEN。", { status: 503 });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  if (!safeEqual(token, expected)) {
    return new NextResponse("token 不正確，無法讀取財務資料。", { status: 401 });
  }

  // 預設只出當年度（避免試算表無限長變卡）；&all=1 才全部；&year=NNN 指定年度。
  const all = url.searchParams.get("all") === "1";
  const yearParam = url.searchParams.get("year");
  const year = yearParam && /^\d+$/.test(yearParam) ? Number(yearParam) : all ? undefined : rocYearNow();

  const entries = await listLedger({ includePayments: true, includeVoid: false, ...(year ? { year } : {}) });
  // 餘額固定用「全部年度」計算（getBalances），與財務中心「總結餘」完全一致——
  // 即使下面的流水帳只列當年度，餘額仍是正確的累計總額（跨年也不會算錯）。
  const bal = await getBalances();

  const header = ["日期", "年度", "類型", "類別", "說明", "活動", "方向", "金額", "帳戶", "狀態", "操作人"];
  const rows = entries.map((e) => {
    const isTransfer = e.entryKind === "TRANSFER_IN" || e.entryKind === "TRANSFER_OUT";
    const direction = isTransfer ? "轉帳" : e.direction === "IN" ? "收入" : "支出";
    return [
      e.date,
      e.year,
      KIND_LABEL[e.entryKind] ?? e.entryKind,
      e.category,
      e.description ?? "",
      e.activityLabel ?? "",
      direction,
      e.amount,
      e.account === "CASH" ? "現金" : "銀行",
      e.status,
      e.operator ?? "",
    ];
  });

  // 表最上面放「目前餘額」三行（銀行＋現金＝總結餘），空一行後才是流水帳表頭與明細。
  const summary: (string | number)[][] = [
    ["目前餘額（銀行＋現金）", bal.total],
    ["　銀行存款", bal.bank],
    ["　現金", bal.cash],
    [],
  ];
  const csv = [...summary, header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  // 加 UTF-8 BOM：Excel 直接開不亂碼；Google 試算表 IMPORTDATA 也正常。
  return new NextResponse("﻿" + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
