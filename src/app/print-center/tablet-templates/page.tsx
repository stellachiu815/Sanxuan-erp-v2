"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { fetchRegistration } from "@/lib/registrationFetch";
import { UniversalSalvationTabletSheet, type PrintTabletEntry, type TabletDocumentType } from "@/components/ritual/tablets";
import {
  TEMPLATE_DOC_TYPES,
  defaultTemplateSetting,
  type TabletTemplateSetting,
  type TabletTemplateDocType,
} from "@/lib/tabletTemplateSettingsShape";

/**
 * V32 §4 列印管理 → 列印模板管理（正式可操作 UI）。
 * 每一 documentType 可調 X/Y Offset、字型、字重、字距、行距、模板預設主文、
 * 顯示/隱藏 校正框·裁切線·作業號碼、最高密度排版；即時預覽、儲存、恢復系統預設。
 * 儲存後正式預覽與正式列印皆生效（同一份設定）；不破壞 Safe Area／裁切／報名分類／收款。
 *
 * 本頁為**獨立全域設定頁**：無任何 route param（不需 Household/Member/TempleEvent ID），
 * 直接開 /print-center/tablet-templates 即可進入；設定由頁內 fetch GET/POST API 取得與儲存。
 * force-dynamic：不做建置期靜態預渲染，避免建置期預渲染造成部署失敗。
 */
export const dynamic = "force-dynamic";

export default function TabletTemplateAdminPage() {
  return (
    <OperatorProvider>
      <div className="min-h-screen">
        <OperatorBar />
        <Inner />
      </div>
    </OperatorProvider>
  );
}

const FONT_FAMILY_OPTIONS = [
  { value: "", label: "系統預設牌位字型" },
  { value: '"Noto Serif TC", serif', label: "思源宋體" },
  { value: '"Noto Sans TC", sans-serif', label: "思源黑體" },
  { value: '"DFKai-SB", "標楷體", "標楷體-繁", "標楷體-港澳", "BiauKai", "KaiTi", "Kaiti TC", "STKaiti", "華文楷體", "楷體-繁", "Kaiti SC", "Noto Serif TC", "PMingLiU", serif', label: "標楷體" },
];
const FONT_WEIGHT_OPTIONS = [
  { value: "", label: "預設" },
  { value: "400", label: "標準 400" },
  { value: "500", label: "中 500" },
  { value: "700", label: "粗 700" },
];

/** 各 documentType 的預覽樣本（含長地址/長主文/多陽上，便於檢查字級與版面）。 */
function sampleRecords(docType: TabletTemplateDocType): PrintTabletEntry[] {
  const mk = (displayName: string, location: string, ys: string[], workNumber: number | null): PrintTabletEntry => ({
    displayName, yangshangName: ys[0] ?? null, yangshangNames: ys, location, notes: null, workNumber,
  });
  if (docType === "DEBT_CREDITOR") {
    return Array.from({ length: 12 }, (_, i) => mk("累世冤親債主", "台北市中正區忠孝東路一段一號", [`報名者${i + 1}`], i === 11 ? null : i + 1));
  }
  if (docType === "POCKET") {
    return [
      mk("周府歷代祖先", "台北市中正區忠孝東路", ["周大明"], 1),
      mk("指定名稱：陳先生代印", "新北市三重區重新路五段六八八巷九九弄", ["陳一", "陳二"], 2),
      mk("陳林黃張李吳王府歷代祖先之蓮座", "新北市板橋區文化路一段", ["王小明"], 100),
      mk("基本寶袋", "北市", ["李大同"], null),
    ];
  }
  const main = docType === "UNBORN_CHILD" ? "無緣子女" : docType === "INDIVIDUAL_SOUL" ? "王大明 乙位正魂" : "王府歷代祖先";
  return [
    mk(main, "北市", ["王小明"], 1),
    mk(main, "台北市中正區忠孝東路一段一二三號五樓之三", ["王小明", "王大華", "王美麗"], 99),
    mk("陳林黃張李吳王劉蔡楊府歷代祖先之蓮座", "新北市三重區重新路五段六八八巷九九弄一二三四號十二樓之五", ["王小明"], 100),
    mk(main, "台北市中正區忠孝東路一段一號", ["王小明"], 1000),
    mk(docType === "UNBORN_CHILD" ? "本宅地基主" : main, "北市", ["王小明"], null),
  ];
}

/** documentType → 預覽用 sheet documentType（皆一致）。 */
const previewDocType: Record<TabletTemplateDocType, TabletDocumentType> = {
  ANCESTOR_LINE: "ANCESTOR_LINE",
  INDIVIDUAL_SOUL: "INDIVIDUAL_SOUL",
  DEBT_CREDITOR: "DEBT_CREDITOR",
  UNBORN_CHILD: "UNBORN_CHILD",
  POCKET: "POCKET",
};

function Inner() {
  const [docType, setDocType] = useState<TabletTemplateDocType>("ANCESTOR_LINE");
  const [all, setAll] = useState<Record<string, TabletTemplateSetting>>({});
  const [form, setForm] = useState<TabletTemplateSetting>(defaultTemplateSetting("ANCESTOR_LINE"));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetchRegistration("/api/print-center/tablet-templates");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "載入失敗");
      const map: Record<string, TabletTemplateSetting> = {};
      for (const s of data.settings as TabletTemplateSetting[]) map[s.documentType] = s;
      setAll(map);
      setForm(map[docType] ?? defaultTemplateSetting(docType));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "操作失敗");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);
  // 切換 documentType → 以已載入設定回填（重新整理後仍存在）。
  useEffect(() => { setForm(all[docType] ?? defaultTemplateSetting(docType)); setMsg(null); setErr(null); }, [docType, all]);

  const set = <K extends keyof TabletTemplateSetting>(k: K, v: TabletTemplateSetting[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function save(action: "save" | "reset") {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const body = action === "reset" ? { documentType: docType, action: "reset" } : { ...form, documentType: docType, action: "save" };
      const res = await fetchRegistration("/api/print-center/tablet-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "儲存失敗");
      const saved = data.setting as TabletTemplateSetting;
      setAll((m) => ({ ...m, [docType]: saved }));
      setForm(saved);
      setMsg(action === "reset" ? "已恢復系統預設。" : "已儲存，正式預覽與正式列印皆已套用此設定。");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "操作失敗");
    } finally {
      setSaving(false);
    }
  }

  const template = useMemo(
    () => ({
      fontFamily: form.fontFamily,
      fontWeight: form.fontWeight,
      letterSpacingPx: form.letterSpacingPx,
      lineHeight: form.lineHeight,
      showCalibrationBox: form.showCalibrationBox,
      showCropMarks: form.showCropMarks,
      defaultMainText: form.defaultMainText,
    }),
    [form]
  );
  const records = useMemo(() => sampleRecords(docType), [docType]);

  const field = "w-full rounded-lg border border-cream-200 bg-white px-3 py-2 text-sm text-ink";
  const labelCls = "text-xs text-ink-soft";

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg text-ink">列印模板管理</h1>
        <Link href="/print-center" className="text-sm text-yolk-700 underline">← 返回列印管理</Link>
      </div>
      <p className="mb-4 text-xs text-ink-faint">
        調整各牌位／寶袋的位移與字體樣式，儲存後正式預覽與正式列印皆生效；「恢復系統預設」清除本模板設定。
        Offset 超出 3mm 安全邊界會被拒絕以保護裁切。單筆自訂列印主文優先於此處的「模板預設主文」。
      </p>

      {/* 模板選擇 */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TEMPLATE_DOC_TYPES.map((t) => (
          <button
            key={t.docType}
            onClick={() => setDocType(t.docType)}
            className={`rounded-full px-4 py-2 text-sm ${docType === t.docType ? "bg-ink-soft text-cream-50" : "bg-cream-100 text-ink-soft"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-ink-faint">載入中…</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* 設定表單 */}
          <div className="flex flex-col gap-3 rounded-2xl bg-white/70 p-4 shadow-card">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1"><span className={labelCls}>密度（橫式）</span>
                <select className={field} value={form.density} onChange={(e) => set("density", e.target.value === "economy" ? "economy" : "standard")}>
                  <option value="standard">標準密度（附件一）</option>
                  <option value="economy">省紙密度</option>
                </select></label>
              <div />
              <label className="flex flex-col gap-1"><span className={labelCls}>X Offset（mm）</span>
                <input type="number" step="0.5" className={field} value={form.offsetXmm} onChange={(e) => set("offsetXmm", Number(e.target.value))} /></label>
              <label className="flex flex-col gap-1"><span className={labelCls}>Y Offset（mm）</span>
                <input type="number" step="0.5" className={field} value={form.offsetYmm} onChange={(e) => set("offsetYmm", Number(e.target.value))} /></label>
              <label className="flex flex-col gap-1"><span className={labelCls}>字型</span>
                <select className={field} value={form.fontFamily ?? ""} onChange={(e) => set("fontFamily", e.target.value || null)}>
                  {FONT_FAMILY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select></label>
              <label className="flex flex-col gap-1"><span className={labelCls}>字重</span>
                <select className={field} value={form.fontWeight ?? ""} onChange={(e) => set("fontWeight", e.target.value || null)}>
                  {FONT_WEIGHT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select></label>
              <label className="flex flex-col gap-1"><span className={labelCls}>字距（px）</span>
                <input type="number" step="0.5" className={field} value={form.letterSpacingPx} onChange={(e) => set("letterSpacingPx", Number(e.target.value))} /></label>
              <label className="flex flex-col gap-1"><span className={labelCls}>行距（倍）</span>
                <input type="number" step="0.05" className={field} value={form.lineHeight} onChange={(e) => set("lineHeight", Number(e.target.value))} /></label>
            </div>
            <label className="flex flex-col gap-1"><span className={labelCls}>模板預設主文（單筆 printMainText 優先）</span>
              <input className={field} value={form.defaultMainText ?? ""} onChange={(e) => set("defaultMainText", e.target.value || null)} placeholder="空白＝用系統預設主文" /></label>
            <div className="grid grid-cols-2 gap-2 text-sm text-ink">
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.showCalibrationBox} onChange={(e) => set("showCalibrationBox", e.target.checked)} /> 顯示校正框</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.showCropMarks} onChange={(e) => set("showCropMarks", e.target.checked)} /> 顯示裁切線</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.showWorkNumber} onChange={(e) => set("showWorkNumber", e.target.checked)} /> 顯示作業號碼</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.maximize} onChange={(e) => set("maximize", e.target.checked)} /> 最高密度排版</label>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => save("save")} disabled={saving} className="rounded-full bg-sage-200 px-5 py-2 text-sm text-ink disabled:opacity-50">{saving ? "儲存中…" : "儲存"}</button>
              <button onClick={() => save("reset")} disabled={saving} className="rounded-full bg-cream-200 px-5 py-2 text-sm text-ink-soft disabled:opacity-50">恢復系統預設</button>
              <button onClick={load} disabled={saving} className="rounded-full bg-cream-100 px-5 py-2 text-sm text-ink-soft disabled:opacity-50">重新載入</button>
            </div>
            {msg && <p className="text-xs text-sage-600">{msg}</p>}
            {err && <p className="text-xs text-blossom-600">⚠️ {err}</p>}
          </div>

          {/* 即時預覽（與正式列印相同的 sheet；套用目前表單設定） */}
          <div className="rounded-2xl bg-white/70 p-4 shadow-card">
            <p className="mb-2 text-xs text-ink-soft">即時預覽（與正式列印相同版面引擎；顯示目前設定，儲存後正式列印一致）</p>
            <div className="overflow-auto" style={{ maxHeight: 640 }}>
              <div style={{ transform: "scale(0.55)", transformOrigin: "top left", width: "182%" }}>
                <UniversalSalvationTabletSheet
                  documentType={previewDocType[docType]}
                  records={records}
                  mode="print"
                  offset={{ offsetXmm: form.offsetXmm, offsetYmm: form.offsetYmm }}
                  showWorkNumber={form.showWorkNumber}
                  density={form.density}
                  maximize={form.maximize}
                  template={template}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
