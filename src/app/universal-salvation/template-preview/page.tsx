"use client";

import { useState } from "react";
import { UniversalSalvationTabletSheet, type PrintTabletEntry } from "@/components/ritual/tablets";

/**
 * V31 §12 正式列印模板「測試頁」——**不寫 DB、不讀正式資料**，用固定測試字串一次看完各種版面極端情況
 * （短／一行／兩行／第二行很短／超長地址、短／超長牌位名、單／多陽上人、No.001~1000、NULL）。
 * 走既有 UniversalSalvationTabletSheet（同一 mm 引擎），不建第二套。
 *   /universal-salvation/template-preview
 */

const ADDR = {
  short: "北市",
  oneLine: "台北市中正區忠孝東路",
  twoLine: "台北市中正區忠孝東路一段一二三號五樓之三",
  shortSecond: "台北市中正區忠孝東路一段一號",
  long: "新北市三重區重新路五段六百八十八巷九十九弄一二三四號十二樓之五六七八九十",
};
const NAME = {
  short: "王府歷代祖先",
  long: "陳林黃張李吳王劉蔡楊許鄭謝郭洪曾廖賴徐周葉蘇府歷代祖先之蓮座",
};
const Y1 = ["王小明"];
const YN = ["王小明", "王大華", "王美麗", "王志豪", "王淑芬", "王建國"];

function tablet(main: string, addr: string, yang: string[], workNumber: number | null): PrintTabletEntry {
  return { displayName: main, yangshangName: yang[0] ?? null, yangshangNames: yang, location: addr, notes: null, workNumber };
}

const ANCESTOR: PrintTabletEntry[] = [
  tablet(NAME.short, ADDR.short, Y1, 1),
  tablet(NAME.short, ADDR.oneLine, Y1, 99),
  tablet(NAME.short, ADDR.twoLine, YN, 100),
  tablet(NAME.long, ADDR.shortSecond, Y1, 999),
  tablet(NAME.long, ADDR.long, YN, 1000),
  tablet("無緣子女", ADDR.short, Y1, null), // 第 6 筆 → 分頁 5+1；無緣主文短，應維持祖先基準字級不放大
];
const DEBT: PrintTabletEntry[] = Array.from({ length: 12 }, (_, i) =>
  tablet("累世冤親債主", i % 2 ? ADDR.twoLine : ADDR.oneLine, [`報名者${i + 1}`], i === 11 ? null : i + 1)
);
const POCKET: PrintTabletEntry[] = [
  tablet("周府歷代祖先", ADDR.oneLine, Y1, 1),
  tablet("指定名稱：陳先生代印", ADDR.twoLine, YN, 2),
  tablet(NAME.long, ADDR.long, Y1, 100),
  tablet("基本寶袋", ADDR.short, Y1, 1000),
  tablet("第五筆寶袋", ADDR.oneLine, Y1, null), // 5 筆 → 4+1
];

export default function TemplatePreviewPage() {
  const [workno, setWorkno] = useState(true);
  const [density, setDensity] = useState<"standard" | "economy">("standard");
  // V33：預覽＝正式列印效果（mode=print，無任何 Debug/框線/slot）。
  const Section = ({ title, dt, records }: { title: string; dt: string; records: PrintTabletEntry[] }) => (
    <section className="mb-10">
      <h2 className="mb-2 text-base text-ink">{title}（{records.length} 筆）</h2>
      <div className="overflow-x-auto bg-white/60 p-4">
        <UniversalSalvationTabletSheet documentType={dt as never} records={records} mode="print" showWorkNumber={workno} density={density} />
      </div>
    </section>
  );
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg text-ink">中元普渡列印模板測試頁（不寫 DB，正式列印效果）</h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={workno} onChange={(e) => setWorkno(e.target.checked)} /> 顯示作業號碼 No.xxx
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            密度
            <select className="rounded border border-cream-200 bg-white px-2 py-1" value={density} onChange={(e) => setDensity(e.target.value === "economy" ? "economy" : "standard")}>
              <option value="standard">標準（附件一）</option>
              <option value="economy">省紙</option>
            </select>
          </label>
        </div>
      </div>
      <p className="mb-4 text-xs text-ink-faint">此即正式列印版面（橫式 A4 直書、群組排列），無任何框線／slot／Debug。含短/長地址、短/長主文、單/多陽上人、No.001~1000 與 NULL。</p>
      <Section title="超拔祖先／乙位正魂" dt="ANCESTOR_LINE" records={ANCESTOR} />
      <Section title="累世冤親債主" dt="DEBT_CREDITOR" records={DEBT} />
      <Section title="無緣子女" dt="UNBORN_CHILD" records={ANCESTOR} />
      <Section title="寶袋（維持既有直式）" dt="POCKET" records={POCKET} />
    </main>
  );
}
