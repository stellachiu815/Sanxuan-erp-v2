import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { assertFinancePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { getFinanceReport, resolveReportRange } from "@/lib/financeCenter";

/**
 * V22 財務報表匯出 Excel（查帳，完整明細）。與報表 API 共用同一 getFinanceReport 查詢來源。
 * PDF（正式列印）走列印頁 /finance-center/reports/print（print CSS），兩者資料一致。
 * query: 同 reports（mode/rocYear/month/from/to）。
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

export async function GET(request: NextRequest) {
  const check = await assertFinancePermissionForOperator(await readOperatorUserId(request), "export");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const range = resolveReportRange(request.nextUrl.searchParams);
  if (!range) return NextResponse.json({ error: "報表區間參數錯誤" }, { status: 400 });
  const r = await getFinanceReport(range.from, range.to, range.label);

  const wb = XLSX.utils.book_new();

  const summary = [
    ["三玄宮 財務報表", r.range.label],
    [],
    ["期初總結餘", r.opening.total, "期初銀行", r.opening.bank, "期初現金", r.opening.cash],
    ["期末總結餘", r.closing.total, "期末銀行", r.closing.bank, "期末現金", r.closing.cash],
    ["收入合計", r.income, "支出合計", r.expense, "淨額", r.net],
    ["銀行異動(進/出/淨)", r.bankMovement.inflow, r.bankMovement.outflow, r.bankMovement.net],
    ["現金異動(進/出/淨)", r.cashMovement.inflow, r.cashMovement.outflow, r.cashMovement.net],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "財務摘要");

  const incomeRows = [["日期", "帳戶", "項目", "金額", "來源", "操作人", "說明"], ...r.incomeEntries.map((e) => [e.date, e.account === "BANK" ? "銀行" : "現金", e.category, e.amount, e.source === "PAYMENT" ? "活動收款" : "一般收入", e.operator ?? "", e.description ?? ""])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(incomeRows), "收入");

  const expenseRows = [["日期", "帳戶", "項目", "金額", "指定活動", "操作人", "說明"], ...r.expenseEntries.map((e) => [e.date, e.account === "BANK" ? "銀行" : "現金", e.category, e.amount, e.activityLabel ?? "", e.operator ?? "", e.description ?? ""])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expenseRows), "支出");

  const actRows = [["活動", "收入", "支出", "淨額"], ...r.activityBreakdown.map((a) => [a.activityLabel, a.income, a.expense, a.net])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(actRows), "活動收支");

  const ledgerRows = [
    ["日期", "類別", "帳戶", "方向", "金額", "項目", "指定活動", "操作人", "狀態", "備查", "說明"],
    ...r.ledger.map((e) => [e.date, KIND_LABEL[e.entryKind] ?? e.entryKind, e.account === "BANK" ? "銀行" : "現金", e.direction === "IN" ? "進" : "出", e.amount, e.category, e.activityLabel ?? "", e.operator ?? "", e.status, e.isHistorical ? "歷史" : "", e.description ?? ""]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ledgerRows), "流水帳");

  const moveRows = [
    ["帳戶", "流入", "流出", "淨額"],
    ["銀行", r.bankMovement.inflow, r.bankMovement.outflow, r.bankMovement.net],
    ["現金", r.cashMovement.inflow, r.cashMovement.outflow, r.cashMovement.net],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(moveRows), "銀行現金異動");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const filename = `finance_${r.range.from}_${r.range.to}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
