"use client";

import { useMemo, useState } from "react";
import {
  CORRECTABLE_FIELD_LABELS,
  type FieldDiff,
  type CorrectableField,
  type CorrectionMode,
} from "@/lib/devoteeImportFieldDiff";

/**
 * V29 C：信眾資料匯入預檢中心「成員逐欄差異＋安全校正」面板（沿用既有預檢中心，不建第二套）。
 *
 * 顯示五類統計、可依分類/欄位篩選、Excel 值 vs DB 值並排、配對依據＋信心、單筆/同欄批次/全部安全
 * 更新勾選；待確認不可勾選、不可批次。模式預設「只補空白」。勾選結果以 corrections 往上傳，於
 * 「確認匯入」時一併送出。
 */

export type CorrMember = {
  name: string;
  action: "CREATE" | "UPDATE" | "REVIEW" | "SKIP";
  confidence?: string | null;
  reason?: string;
  matchedMemberId?: string | null;
  rowCategory?: "IDENTICAL" | "SAFE_UPDATE" | "NEEDS_REVIEW";
  fieldDiffs?: FieldDiff[];
  matchedFields?: string[];
};
export type CorrRow = { id: string; householdCode: string; householdName: string; members: CorrMember[] };

export type CorrectionSelection = {
  rowId: string;
  memberName: string;
  correctionMode: CorrectionMode;
  selectedFields: CorrectableField[];
};

type FlatMember = { row: CorrRow; member: CorrMember };

const CAT_LABEL: Record<string, string> = {
  IDENTICAL: "完全一致",
  SAFE_UPDATE: "可安全更新",
  NEEDS_REVIEW: "待確認",
  EXCEL_ONLY: "Excel 有、DB 無",
  DB_ONLY: "DB 有、Excel 無",
};

export default function DevoteeCorrectionPanel({
  rows,
  onChange,
}: {
  rows: CorrRow[];
  onChange: (corrections: CorrectionSelection[]) => void;
}) {
  const [mode, setMode] = useState<CorrectionMode>("FILL_BLANK_ONLY");
  // key = `${rowId}::${memberName}` → set of selected fields
  const [selections, setSelections] = useState<Record<string, Set<CorrectableField>>>({});
  const [catFilter, setCatFilter] = useState<string>("ALL");
  const [fieldFilter, setFieldFilter] = useState<string>("ALL");

  const flat: FlatMember[] = useMemo(
    () => rows.flatMap((row) => row.members.map((member) => ({ row, member }))),
    [rows]
  );

  const counts = useMemo(() => {
    const c = { IDENTICAL: 0, SAFE_UPDATE: 0, NEEDS_REVIEW: 0, EXCEL_ONLY: 0, DB_ONLY: 0 };
    for (const { member } of flat) {
      if (member.action === "CREATE") c.EXCEL_ONLY++;
      else if (member.rowCategory === "IDENTICAL") c.IDENTICAL++;
      else if (member.rowCategory === "SAFE_UPDATE") c.SAFE_UPDATE++;
      else if (member.rowCategory === "NEEDS_REVIEW" || member.action === "REVIEW") c.NEEDS_REVIEW++;
    }
    return c;
  }, [flat]);

  function emit(next: Record<string, Set<CorrectableField>>, m: CorrectionMode) {
    const out: CorrectionSelection[] = [];
    for (const { row, member } of flat) {
      const key = `${row.id}::${member.name}`;
      const set = next[key];
      if (set && set.size > 0) {
        out.push({ rowId: row.id, memberName: member.name, correctionMode: m, selectedFields: [...set] });
      }
    }
    onChange(out);
  }

  function toggleField(key: string, field: CorrectableField) {
    setSelections((prev) => {
      const next = { ...prev };
      const set = new Set(next[key] ?? []);
      if (set.has(field)) set.delete(field);
      else set.add(field);
      next[key] = set;
      emit(next, mode);
      return next;
    });
  }

  function selectAllSafe() {
    setSelections((prev) => {
      const next = { ...prev };
      for (const { row, member } of flat) {
        if (member.rowCategory !== "SAFE_UPDATE") continue; // 待確認不可批次
        const key = `${row.id}::${member.name}`;
        const set = new Set(next[key] ?? []);
        for (const d of member.fieldDiffs ?? []) {
          if (d.status === "FILL_BLANK") set.add(d.field); // 只自動選「補空白」的安全欄
          if (d.status === "DIFF" && mode === "CORRECT_WITH_EXCEL") set.add(d.field);
        }
        next[key] = set;
      }
      emit(next, mode);
      return next;
    });
  }

  function clearAll() {
    setSelections({});
    onChange([]);
  }

  function changeMode(m: CorrectionMode) {
    setMode(m);
    emit(selections, m);
  }

  const totalSelectedFields = Object.values(selections).reduce((s, set) => s + set.size, 0);
  const totalSelectedMembers = Object.values(selections).filter((set) => set.size > 0).length;

  const visible = flat.filter(({ member }) => {
    if (member.action === "SKIP") return false;
    if (catFilter !== "ALL") {
      const cat = member.action === "CREATE" ? "EXCEL_ONLY" : member.rowCategory ?? (member.action === "REVIEW" ? "NEEDS_REVIEW" : "IDENTICAL");
      if (cat !== catFilter) return false;
    }
    if (fieldFilter !== "ALL") {
      const has = (member.fieldDiffs ?? []).some((d) => d.field === fieldFilter && (d.status === "DIFF" || d.status === "FILL_BLANK"));
      if (!has) return false;
    }
    return true;
  });

  return (
    <section className="rounded-2xl border border-cream-200 bg-white/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-sm font-medium text-ink">成員逐欄差異與安全校正</h4>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-ink-faint">模式：</span>
          {(["FILL_BLANK_ONLY", "CORRECT_WITH_EXCEL"] as CorrectionMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => changeMode(m)}
              className={"rounded-full px-3 py-1 " + (mode === m ? "bg-ink-soft text-cream-50" : "bg-cream-100 text-ink-soft")}
            >
              {m === "FILL_BLANK_ONLY" ? "只補空白（預設）" : "以 Excel 校正錯值"}
            </button>
          ))}
        </div>
      </div>

      {/* 五類統計卡 */}
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {(["IDENTICAL", "SAFE_UPDATE", "NEEDS_REVIEW", "EXCEL_ONLY", "DB_ONLY"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setCatFilter(catFilter === k ? "ALL" : k)}
            className={"rounded-full px-3 py-1 " + (catFilter === k ? "bg-mist-200 text-ink" : "bg-cream-100 text-ink-soft")}
          >
            {CAT_LABEL[k]} {counts[k]}
          </button>
        ))}
        {catFilter !== "ALL" && (
          <button type="button" onClick={() => setCatFilter("ALL")} className="rounded-full px-3 py-1 text-ink-faint underline">清除分類篩選</button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-ink-faint">欄位篩選：</span>
        <select className="rounded border border-cream-300 px-2 py-1" value={fieldFilter} onChange={(e) => setFieldFilter(e.target.value)}>
          <option value="ALL">（全部欄位）</option>
          {(Object.keys(CORRECTABLE_FIELD_LABELS) as CorrectableField[]).map((f) => (
            <option key={f} value={f}>{CORRECTABLE_FIELD_LABELS[f]}</option>
          ))}
        </select>
        <button type="button" onClick={selectAllSafe} className="rounded-full bg-sage-100 px-3 py-1 text-ink-soft">全部安全更新（可安全更新的補空白）</button>
        <button type="button" onClick={clearAll} className="rounded-full bg-cream-100 px-3 py-1 text-ink-soft">清除勾選</button>
        <span className="ml-auto text-ink-faint">已勾選 {totalSelectedMembers} 位／{totalSelectedFields} 欄</span>
      </div>

      {/* 逐位差異 */}
      <div className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto">
        {visible.length === 0 && <p className="p-3 text-center text-xs text-ink-faint">沒有符合篩選的成員。</p>}
        {visible.map(({ row, member }) => {
          const key = `${row.id}::${member.name}`;
          const isReview = member.rowCategory === "NEEDS_REVIEW" || member.action === "REVIEW";
          const isCreate = member.action === "CREATE";
          const set = selections[key] ?? new Set<CorrectableField>();
          const diffs = (member.fieldDiffs ?? []).filter((d) =>
            fieldFilter === "ALL" ? true : d.field === fieldFilter
          );
          return (
            <div key={key} className={"rounded-xl border p-2 " + (isReview ? "border-yolk-300 bg-yolk-50/40" : "border-cream-200")}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <b className="text-ink">{member.name}</b>
                <span className="text-ink-faint">家戶 {row.householdName}（{row.householdCode}）</span>
                {member.matchedMemberId && <span className="text-ink-faint">Member ID {member.matchedMemberId}</span>}
                {member.confidence && <span className="rounded-full bg-mist-100 px-2 py-0.5">信心 {member.confidence}</span>}
                {member.matchedFields && member.matchedFields.length > 0 && (
                  <span className="text-ink-faint">配對依據 {member.matchedFields.join("＋")}</span>
                )}
                <span className={"ml-auto rounded-full px-2 py-0.5 " + (isReview ? "bg-yolk-200 text-ink" : isCreate ? "bg-blossom-100" : "bg-sage-100")}>
                  {isCreate ? "Excel 有、DB 無（新增）" : isReview ? "待確認（不可勾選）" : CAT_LABEL[member.rowCategory ?? "IDENTICAL"]}
                </span>
              </div>
              {!isCreate && diffs.length > 0 && (
                <table className="mt-1 w-full text-left text-xs">
                  <thead className="text-ink-faint">
                    <tr><th className="px-1 py-0.5 w-8"></th><th className="px-1 py-0.5">欄位</th><th className="px-1 py-0.5">Excel 值</th><th className="px-1 py-0.5">DB 現值</th><th className="px-1 py-0.5">狀態</th></tr>
                  </thead>
                  <tbody>
                    {diffs.map((d) => {
                      const selectable = !isReview && (d.status === "FILL_BLANK" || (d.status === "DIFF" && mode === "CORRECT_WITH_EXCEL"));
                      return (
                        <tr key={d.field} className="border-t border-cream-100">
                          <td className="px-1 py-0.5">
                            <input type="checkbox" disabled={!selectable} checked={set.has(d.field)} onChange={() => toggleField(key, d.field)} />
                          </td>
                          <td className="px-1 py-0.5">{d.label}</td>
                          <td className="px-1 py-0.5">{d.excel ?? <span className="text-ink-faint">（空白）</span>}</td>
                          <td className="px-1 py-0.5">{d.db ?? <span className="text-ink-faint">（空白）</span>}</td>
                          <td className="px-1 py-0.5">
                            {d.status === "SAME" && "一致"}
                            {d.status === "FILL_BLANK" && "可補空白"}
                            {d.status === "DIFF" && (mode === "CORRECT_WITH_EXCEL" ? "不同→可校正" : "不同（需切校正模式）")}
                            {d.status === "DB_ONLY" && "DB 有、Excel 無（不動）"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-ink-faint">
        確認匯入前會再顯示總筆數／欄位數；待確認成員不會被自動更新。「以 Excel 校正錯值」才會覆蓋既有非空值；Excel 空白永不覆蓋、相同值不寫入。
      </p>
    </section>
  );
}
