import { TABLET_FONT_FAMILY, A4_PAGE } from "./shared";
import type { PetitionData } from "@/lib/lanternPrint";

/**
 * V13.1 指令十一／十二：疏文列印模板。
 *
 * ⚠️ 同燈牌模板：這支**只排版、不轉換**。所有數字都已在
 * src/lib/lanternPrint.ts 由 printChinese 轉成國字。
 *
 * 疏文是一整份文書（不是一張一張的牌位），所以用 A4 直式整頁排版，
 * 不套用 8／12／16 張的格線。
 *
 * 之後三玄宮提供正式疏文格式時，只需替換這支檔案的 JSX／CSS。
 */
export default function PetitionSheet({ data }: { data: PetitionData }) {
  return (
    <div
      className="print-sheet mx-auto bg-white text-ink"
      style={{
        width: `${A4_PAGE.widthMm}mm`,
        minHeight: `${A4_PAGE.heightMm}mm`,
        padding: `${A4_PAGE.marginMm}mm`,
        fontFamily: TABLET_FONT_FAMILY,
        breakInside: "avoid",
      }}
    >
      <header className="mb-8 text-center">
        <h1 className="text-2xl leading-loose tracking-widest">
          台北三玄宮 {data.activityTypeLabel} 疏文
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          {data.yearText}　{data.sexagenaryText}
          {data.lunarDateText && `　農曆${data.lunarDateText}`}
        </p>
        {data.activityName && (
          <p className="mt-1 text-sm text-ink-faint">{data.activityName}</p>
        )}
      </header>

      <section className="space-y-2 text-sm leading-loose">
        <p className="mb-4 indent-8 leading-loose">
          伏以　信士弟子等　誠心叩首　敬備香花茶果　恭請諸天神聖降臨受供
          　祈求闔家平安　諸事順遂　謹將弟子姓名開列於後：
        </p>

        <ol className="space-y-1">
          {data.entries.map((e, i) => (
            <li key={`${e.name}-${i}`} className="flex flex-wrap gap-x-3 leading-loose">
              <span className="min-w-24">{e.name}</span>
              {e.nominalAgeText && <span>{e.nominalAgeText}</span>}
              {e.zodiacText && <span>{`${e.zodiacText}相`}</span>}
              {e.jishiText && <span>{e.jishiText}</span>}
              {e.taisuiText && <span>{e.taisuiText}</span>}
              {e.addressText && <span className="text-ink-soft">{e.addressText}</span>}
            </li>
          ))}
        </ol>
      </section>

      {/*
        資料不完整而未列入疏文的信眾。刻意印在疏文**之後**並標示為
        「待處理」——指令十一要求資料不完整者不得列印，但也不能讓行政人員
        不知道有人被漏掉。這一區塊在正式張貼前應撕除或另外處理。
      */}
      {data.excluded.length > 0 && (
        <section className="mt-10 border-t border-dashed border-ink-faint pt-4 print:break-before-page">
          <h2 className="mb-2 text-sm font-medium text-ink-soft">
            以下 {data.excluded.length} 位資料不完整，未列入本份疏文，請補齊後重新列印
          </h2>
          <ul className="space-y-1 text-xs text-ink-faint">
            {data.excluded.map((e, i) => (
              <li key={`${e.name}-${i}`}>
                {e.name}：{e.issues.join("、")}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
