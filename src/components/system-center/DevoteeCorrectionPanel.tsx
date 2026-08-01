"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CORRECTABLE_FIELD_LABELS,
  computeFieldDiffs,
  type FieldDiff,
  type CorrectableField,
  type CorrectionMode,
  type ExcelSideValues,
  type DbSideValues,
} from "@/lib/devoteeImportFieldDiff";
import { formatIsoDateToMinguoLong, formatLunarDateToMinguoArabic } from "@/lib/minguoDate";

/**
 * V29：生日一律用民國格式顯示（不顯示西元裸格式；沿用既有 minguoDate 工具）。
 *   國曆（yyyy-MM-dd）→ 民國49年10月24日
 *   農曆（computeFieldDiffs 產生的「y-m-d」或「y-m-d(閏)」）→ 民國49年農曆9月5日／…農曆閏9月5日
 * Excel 值與 DB 現值兩側都走這支，確保同一套格式。非生日欄位原樣顯示。
 */
function formatDiffValue(field: CorrectableField, value: string | null): string | null {
  if (value == null) return value;
  if (field === "solarBirthDate") return formatIsoDateToMinguoLong(value) || value;
  if (field === "lunarBirth") {
    const leap = /\(閏\)/.test(value);
    const m = /^(\d+)-(\d+)-(\d+)/.exec(value);
    if (!m) return value;
    return (
      formatLunarDateToMinguoArabic({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), isLeapMonth: leap }) ||
      value
    );
  }
  return value;
}

/** 農曆西元年月日 → 民國顯示（候選卡片用；資料不足回「—」）。 */
function fmtLunarMinguo(y: number | null, mo: number | null, d: number | null, leap: boolean): string {
  return formatLunarDateToMinguoArabic({ year: y, month: mo, day: d, isLeapMonth: leap }) || "—";
}
/** 國曆 ISO → 民國顯示（候選卡片用；空值回「—」）。 */
function fmtSolarMinguo(iso: string | null): string {
  return (iso && formatIsoDateToMinguoLong(iso)) || "—";
}

/**
 * V29 C：信眾資料匯入預檢中心「成員逐欄差異＋安全校正」面板（沿用既有預檢中心，不建第二套）。
 *
 * 配對一律以**姓名為主、不依賴家戶**（家戶名稱僅供辨識參考）：
 *   - DB 同名唯一 → 可安全更新（仍需逐欄勾選才寫入）。
 *   - DB 同名多位 → 待確認：列出每位候選（Member ID／農曆／國曆／聯絡電話／通訊地址／所屬家戶），
 *     由使用者**手動挑選**正確的人後，才顯示該候選的逐欄差異供勾選；系統不自動代選。
 *   - Excel 有、DB 無 → 只顯示、不新增。
 * 模式預設「只補空白」；「以 Excel 校正錯值」才會覆蓋既有非空值；Excel 空白永不覆蓋、相同值不寫入。
 */

/** 同名多人候選（唯讀顯示欄位＋精簡 DB 純量；挑選後才即時算差異，不預存 fieldDiffs）。 */
export type CandidateInfo = {
  memberId: string;
  name: string;
  lunarBirthLabel: string | null;
  solarBirthLabel: string | null;
  mobile: string | null;
  address: string | null;
  householdName: string | null;
  dbValues: DbSideValues;
};

export type CorrMember = {
  name: string;
  action: "CREATE" | "UPDATE" | "REVIEW" | "SKIP";
  confidence?: string | null;
  reason?: string;
  matchedMemberId?: string | null;
  rowCategory?: "IDENTICAL" | "SAFE_UPDATE" | "NEEDS_REVIEW";
  fieldDiffs?: FieldDiff[];
  matchedFields?: string[];
  /** 同名多人時的候選清單（供手動挑選）。 */
  reviewCandidates?: CandidateInfo[];
  /** 同名多人時，這一列 Excel 端逐欄值（挑選候選後即時比對用）。 */
  reviewExcelSide?: ExcelSideValues;
};
export type CorrRow = { id: string; householdCode: string; householdName: string; members: CorrMember[] };

export type CorrectionSelection = {
  rowId: string;
  memberName: string;
  correctionMode: CorrectionMode;
  selectedFields: CorrectableField[];
  /** 同名多人：使用者手動挑選的候選 memberId（唯一配對時省略）。 */
  selectedMemberId?: string | null;
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
  excelTotalCount,
}: {
  rows: CorrRow[];
  onChange: (corrections: CorrectionSelection[]) => void;
  /** Excel 總筆數（供最上方配對統計；未提供時以列數估算）。 */
  excelTotalCount?: number;
}) {
  const [mode, setMode] = useState<CorrectionMode>("FILL_BLANK_ONLY");
  // key = `${rowId}::${memberName}` → set of selected fields
  const [selections, setSelections] = useState<Record<string, Set<CorrectableField>>>({});
  // key = `${rowId}::${memberName}` → 手動挑選的候選 memberId（同名多人）
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [catFilter, setCatFilter] = useState<string>("ALL");
  const [fieldFilter, setFieldFilter] = useState<string>("ALL");

  const flat: FlatMember[] = useMemo(
    () => rows.flatMap((row) => row.members.map((member) => ({ row, member }))),
    [rows]
  );

  const isReviewMember = (m: CorrMember) => m.rowCategory === "NEEDS_REVIEW" || m.action === "REVIEW";

  // 預覽頁最上方配對統計（整批一目了然）。
  const matchStats = useMemo(() => {
    let uniqueMatched = 0; // 唯一姓名配對成功（action UPDATE：含完全一致／可安全更新）
    let review = 0; // 同名待確認（action REVIEW）
    let excelOnly = 0; // Excel 有、DB 無（action CREATE）
    for (const { member } of flat) {
      if (member.action === "CREATE") excelOnly++;
      else if (isReviewMember(member)) review++;
      else if (member.action === "UPDATE") uniqueMatched++;
    }
    const excelTotal = excelTotalCount ?? flat.length;
    // 略過（資料不足）：Excel 有筆數但未能解析成一位可比對信眾（多為缺姓名／空白列）。
    const skipped = Math.max(0, excelTotal - (uniqueMatched + review + excelOnly));
    return { excelTotal, uniqueMatched, review, excelOnly, skipped };
  }, [flat, excelTotalCount]);

  const counts = useMemo(() => {
    const c = { IDENTICAL: 0, SAFE_UPDATE: 0, NEEDS_REVIEW: 0, EXCEL_ONLY: 0, DB_ONLY: 0 };
    for (const { member } of flat) {
      if (member.action === "CREATE") c.EXCEL_ONLY++;
      else if (isReviewMember(member)) c.NEEDS_REVIEW++;
      else if (member.rowCategory === "IDENTICAL") c.IDENTICAL++;
      else if (member.rowCategory === "SAFE_UPDATE") c.SAFE_UPDATE++;
    }
    return c;
  }, [flat]);

  // 某位成員「目前生效」的逐欄差異：待確認 → 對「已挑選候選」以 Excel×該候選 DB 即時計算；其餘取自身差異。
  function effectiveDiffs(row: CorrRow, member: CorrMember): FieldDiff[] {
    if (isReviewMember(member)) {
      const key = `${row.id}::${member.name}`;
      const pickedId = picks[key];
      const c = member.reviewCandidates?.find((x) => x.memberId === pickedId);
      if (!c || !member.reviewExcelSide) return [];
      // 記憶體優化③：候選不預存 fieldDiffs，挑選後才即時算（computeFieldDiffs 為純函式，前端可跑）。
      return computeFieldDiffs(member.reviewExcelSide, c.dbValues);
    }
    return member.fieldDiffs ?? [];
  }

  function emit(
    nextSel: Record<string, Set<CorrectableField>>,
    nextPicks: Record<string, string>,
    m: CorrectionMode
  ) {
    const out: CorrectionSelection[] = [];
    for (const { row, member } of flat) {
      const key = `${row.id}::${member.name}`;
      const set = nextSel[key];
      if (set && set.size > 0) {
        out.push({
          rowId: row.id,
          memberName: member.name,
          correctionMode: m,
          selectedFields: [...set],
          ...(isReviewMember(member) ? { selectedMemberId: nextPicks[key] ?? null } : {}),
        });
      }
    }
    onChange(out);
  }

  /** 一位成員「可補空白（FILL_BLANK）」的欄位集合（DB 空、Excel 有值）。 */
  function fillBlankFields(diffs: FieldDiff[]): Set<CorrectableField> {
    const s = new Set<CorrectableField>();
    for (const d of diffs) if (d.status === "FILL_BLANK") s.add(d.field);
    return s;
  }

  // 依 rows 內容產生穩定簽章：父層每次 render 都會重建 rows 陣列，若用 rows 參考當依賴會每次重跑、
  // 抹掉使用者的手動取消。改用 row id 串成的字串（primitive）當依賴，只有「新一批分析」才會變。
  const rowsSig = rows.map((r) => r.id).join("|");

  /**
   * V29 進入預覽頁時自動完成「安全勾選」：DB 空白、Excel 有值（FILL_BLANK）的欄位預設勾選，
   * 涵蓋 國曆生日／農曆生日／性別／身份／聯絡電話／通訊地址。**不含** DIFF（DB 有值且不同，
   * 保持未勾選由使用者決定）、SAME、DB_ONLY、Excel有DB無、同名待確認（待選定候選後另行預設）。
   * 使用者仍可手動取消任何預設。只有換一批分析（rowsSig 變）才重設。
   */
  useEffect(() => {
    const next: Record<string, Set<CorrectableField>> = {};
    for (const { row, member } of flat) {
      if (member.action === "SKIP" || member.action === "CREATE") continue; // 略過 / Excel有DB無：不勾
      if (isReviewMember(member)) continue; // 同名多人：待使用者選定候選後再預設
      const set = fillBlankFields(member.fieldDiffs ?? []);
      if (set.size > 0) next[`${row.id}::${member.name}`] = set;
    }
    setSelections(next);
    setPicks({});
    emit(next, {}, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsSig]);

  function toggleField(key: string, field: CorrectableField) {
    setSelections((prev) => {
      const next = { ...prev };
      const set = new Set(next[key] ?? []);
      if (set.has(field)) set.delete(field);
      else set.add(field);
      next[key] = set;
      emit(next, picks, mode);
      return next;
    });
  }

  // 挑選同名候選：選定後，對「該候選」自動預設勾選其「可補空白」欄位（DIFF 保持未勾）。
  // 改選其他候選時會以新候選重算預設，不會殘留前一位候選的勾選。
  function pickCandidate(key: string, memberId: string) {
    setPicks((prevPicks) => {
      const nextPicks = { ...prevPicks, [key]: memberId };
      const fm = flat.find(({ row, member }) => `${row.id}::${member.name}` === key);
      const cand = fm?.member.reviewCandidates?.find((c) => c.memberId === memberId);
      const defaults =
        fm?.member.reviewExcelSide && cand
          ? fillBlankFields(computeFieldDiffs(fm.member.reviewExcelSide, cand.dbValues))
          : new Set<CorrectableField>();
      setSelections((prevSel) => {
        const nextSel = { ...prevSel, [key]: defaults };
        emit(nextSel, nextPicks, mode);
        return nextSel;
      });
      return nextPicks;
    });
  }

  function selectAllSafe() {
    setSelections((prev) => {
      const next = { ...prev };
      for (const { row, member } of flat) {
        if (member.rowCategory !== "SAFE_UPDATE" || isReviewMember(member)) continue; // 待確認不可批次
        const key = `${row.id}::${member.name}`;
        // V29 規則六：「全部安全更新」只勾選 FILL_BLANK（可補空白），**絕不**勾選 DIFF（錯值覆蓋）。
        const set = new Set(next[key] ?? []);
        for (const d of member.fieldDiffs ?? []) {
          if (d.status === "FILL_BLANK") set.add(d.field);
        }
        next[key] = set;
      }
      emit(next, picks, mode);
      return next;
    });
  }

  function clearAll() {
    setSelections({});
    onChange([]);
  }

  function changeMode(m: CorrectionMode) {
    setMode(m);
    emit(selections, picks, m);
  }

  const totalSelectedFields = Object.values(selections).reduce((s, set) => s + set.size, 0);
  const totalSelectedMembers = Object.values(selections).filter((set) => set.size > 0).length;

  const visible = flat.filter(({ row, member }) => {
    if (member.action === "SKIP") return false;
    if (catFilter !== "ALL") {
      const cat = member.action === "CREATE" ? "EXCEL_ONLY" : isReviewMember(member) ? "NEEDS_REVIEW" : member.rowCategory ?? "IDENTICAL";
      if (cat !== catFilter) return false;
    }
    if (fieldFilter !== "ALL") {
      const has = effectiveDiffs(row, member).some((d) => d.field === fieldFilter && (d.status === "DIFF" || d.status === "FILL_BLANK"));
      if (!has) return false;
    }
    return true;
  });

  return (
    <section className="rounded-2xl border border-cream-200 bg-white/70 p-4">
      {/* 預覽頁最上方：整批配對統計 */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: "Excel 總筆數", value: matchStats.excelTotal, cls: "bg-cream-100 text-ink" },
          { label: "唯一姓名配對成功", value: matchStats.uniqueMatched, cls: "bg-sage-100 text-ink" },
          { label: "同名待確認", value: matchStats.review, cls: "bg-yolk-100 text-ink" },
          { label: "Excel 有、DB 無", value: matchStats.excelOnly, cls: "bg-blossom-100 text-ink" },
          { label: "略過（資料不足）", value: matchStats.skipped, cls: "bg-mist-100 text-ink" },
        ].map((s) => (
          <div key={s.label} className={"rounded-xl px-3 py-2 " + s.cls}>
            <div className="text-lg font-semibold leading-none">{s.value}</div>
            <div className="mt-1 text-[11px] text-ink-soft">{s.label}</div>
          </div>
        ))}
      </div>

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
          const isReview = isReviewMember(member);
          const isCreate = member.action === "CREATE";
          const set = selections[key] ?? new Set<CorrectableField>();
          const pickedId = picks[key];
          const hasPick = isReview && !!pickedId;
          const diffs = effectiveDiffs(row, member).filter((d) => (fieldFilter === "ALL" ? true : d.field === fieldFilter));
          return (
            <div key={key} className={"rounded-xl border p-2 " + (isReview ? "border-yolk-300 bg-yolk-50/40" : "border-cream-200")}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <b className="text-ink">{member.name}</b>
                {!isReview && member.matchedMemberId && <span className="text-ink-faint">Member ID {member.matchedMemberId}</span>}
                {member.matchedFields && member.matchedFields.length > 0 && (
                  <span className="text-ink-faint">配對依據 {member.matchedFields.join("＋")}</span>
                )}
                <span className={"ml-auto rounded-full px-2 py-0.5 " + (isReview ? "bg-yolk-200 text-ink" : isCreate ? "bg-blossom-100" : "bg-sage-100")}>
                  {isCreate ? "Excel 有、DB 無（不新增）" : isReview ? "待確認（同名多人，請挑選）" : CAT_LABEL[member.rowCategory ?? "IDENTICAL"]}
                </span>
              </div>

              {/* 同名多人：候選清單，手動挑選 */}
              {isReview && (member.reviewCandidates?.length ?? 0) > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-ink-faint">資料庫有 {member.reviewCandidates!.length} 位同名信眾，請挑選正確的人（系統不自動配對）：</p>
                  {member.reviewCandidates!.map((c) => (
                    <label
                      key={c.memberId}
                      className={"flex cursor-pointer flex-wrap items-center gap-2 rounded-lg border px-2 py-1 text-xs " + (pickedId === c.memberId ? "border-sage-400 bg-sage-50" : "border-cream-200")}
                    >
                      <input type="radio" name={`pick-${key}`} checked={pickedId === c.memberId} onChange={() => pickCandidate(key, c.memberId)} />
                      <span className="font-medium text-ink">{c.name}</span>
                      <span className="text-ink-faint">ID {c.memberId}</span>
                      <span className="text-ink-faint">農曆 {fmtLunarMinguo(c.dbValues.lunarBirthYear, c.dbValues.lunarBirthMonth, c.dbValues.lunarBirthDay, c.dbValues.lunarIsLeapMonth)}</span>
                      <span className="text-ink-faint">國曆 {fmtSolarMinguo(c.dbValues.solarBirthDate)}</span>
                      <span className="text-ink-faint">電話 {c.mobile ?? "—"}</span>
                      <span className="text-ink-faint">地址 {c.address ?? "—"}</span>
                      <span className="text-ink-faint">家戶 {c.householdName ?? "—"}（僅供辨識）</span>
                    </label>
                  ))}
                </div>
              )}

              {/* 逐欄差異表：一般配對永遠顯示；待確認需先挑選候選 */}
              {!isCreate && (!isReview || hasPick) && diffs.length > 0 && (
                <table className="mt-1 w-full text-left text-xs">
                  <thead className="text-ink-faint">
                    <tr><th className="px-1 py-0.5 w-8"></th><th className="px-1 py-0.5">欄位</th><th className="px-1 py-0.5">Excel 值</th><th className="px-1 py-0.5">DB 現值</th><th className="px-1 py-0.5">狀態</th></tr>
                  </thead>
                  <tbody>
                    {diffs.map((d) => {
                      const selectable = d.status === "FILL_BLANK" || (d.status === "DIFF" && mode === "CORRECT_WITH_EXCEL");
                      return (
                        <tr key={d.field} className="border-t border-cream-100">
                          <td className="px-1 py-0.5">
                            <input type="checkbox" disabled={!selectable} checked={set.has(d.field)} onChange={() => toggleField(key, d.field)} />
                          </td>
                          <td className="px-1 py-0.5">{d.label}</td>
                          <td className="px-1 py-0.5">{formatDiffValue(d.field, d.excel) ?? <span className="text-ink-faint">（空白）</span>}</td>
                          <td className="px-1 py-0.5">{formatDiffValue(d.field, d.db) ?? <span className="text-ink-faint">（空白）</span>}</td>
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
              {isReview && !hasPick && (member.reviewCandidates?.length ?? 0) > 0 && (
                <p className="mt-1 text-xs text-ink-faint">挑選候選後才會顯示逐欄差異與可勾選欄位。</p>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-ink-faint">
        確認匯入前會再顯示總筆數／欄位數；待確認成員需先手動挑選正確的人、勾選欄位後才會更新。「以 Excel 校正錯值」才會覆蓋既有非空值；Excel 空白永不覆蓋、相同值不寫入；通訊地址只寫該信眾個人資料，不動家戶。
      </p>
    </section>
  );
}
